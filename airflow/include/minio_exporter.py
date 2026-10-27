"""
Module: minio_exporter.py
Description: Data Lakehouse exporter for SismoWatch Medallion Architecture.
Exports historical events to MinIO Object Storage in Apache Parquet format with snappy compression.
Resilient design: Errors log warnings and do not break PostgreSQL hot-tier pipeline.
"""
import io
import os
import json
import hashlib
import socket
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Union
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import boto3
from botocore.config import Config

logger = logging.getLogger("sismowatch.minio_exporter")

BUCKET_NAME = os.getenv("MINIO_BUCKET", "sismowatch-lake")


def get_minio_endpoint_url() -> str:
    """
    Resolves MinIO endpoint URL intelligently across Docker containers and host environments.
    """
    raw_endpoint = os.getenv("MINIO_ENDPOINT", "minio:9000")
    if raw_endpoint.startswith("http://") or raw_endpoint.startswith("https://"):
        cleaned = raw_endpoint.split("://")[1]
    else:
        cleaned = raw_endpoint

    host_part = cleaned.split(":")[0]
    port_part = cleaned.split(":")[1] if ":" in cleaned else "9000"

    try:
        socket.gethostbyname(host_part)
        target_host = host_part
    except (socket.gaierror, socket.herror):
        target_host = "localhost"

    return f"http://{target_host}:{port_part}"


def get_s3_client():
    """
    Initializes and returns a configured S3 client for MinIO.
    """
    endpoint_url = get_minio_endpoint_url()
    user = os.getenv("MINIO_ROOT_USER", "sismowatch_minio_admin")
    password = os.getenv("MINIO_ROOT_PASSWORD", "minio_sismowatch_2026_pwd")

    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=user,
        aws_secret_access_key=password,
        config=Config(
            signature_version="s3v4",
            connect_timeout=3,
            read_timeout=5,
            retries={"max_attempts": 2}
        )
    )


def ensure_bucket_exists(s3_client=None, bucket_name: str = BUCKET_NAME) -> bool:
    """
    Verifies that the target MinIO bucket exists, creating it if needed.
    """
    client = s3_client or get_s3_client()
    try:
        client.head_bucket(Bucket=bucket_name)
        return True
    except Exception:
        try:
            client.create_bucket(Bucket=bucket_name)
            logger.info("Created MinIO bucket '%s'", bucket_name)
            return True
        except Exception as err:
            logger.warning("Could not verify or create MinIO bucket '%s': %s", bucket_name, err)
            return False


def _write_or_append_parquet(
    s3_client,
    df: pd.DataFrame,
    s3_key: str,
    dedup_subset: Optional[List[str]] = None,
    bucket_name: str = BUCKET_NAME
) -> bool:
    """
    Appends new DataFrame records to existing Parquet file in S3/MinIO (if present),
    deduplicates, and saves back with snappy compression.
    """
    if df.empty:
        logger.info("Empty DataFrame, skipping Parquet export to %s", s3_key)
        return False

    combined_df = df
    try:
        # Check if file exists in S3 to merge & deduplicate
        existing_obj = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
        existing_buf = io.BytesIO(existing_obj["Body"].read())
        existing_table = pq.read_table(existing_buf)
        existing_df = existing_table.to_pandas()
        
        # Concat and dedup
        combined_df = pd.concat([existing_df, df], ignore_index=True)
        if dedup_subset:
            subset_cols = [c for c in dedup_subset if c in combined_df.columns]
            if subset_cols:
                combined_df = combined_df.drop_duplicates(subset=subset_cols, keep="last")
    except Exception:
        # File doesn't exist yet or cannot be read - write fresh
        pass

    # Ensure all object/complex columns are serializable to PyArrow
    for col in combined_df.columns:
        if combined_df[col].dtype == "object":
            combined_df[col] = combined_df[col].apply(
                lambda val: json.dumps(val) if isinstance(val, (dict, list)) else (str(val) if pd.notnull(val) else None)
            )

    # Convert to PyArrow Table and write Snappy Parquet
    table = pa.Table.from_pandas(combined_df, preserve_index=False)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    buf.seek(0)

    s3_client.put_object(
        Bucket=bucket_name,
        Key=s3_key,
        Body=buf.getvalue(),
        ContentType="application/x-parquet"
    )
    logger.info("Successfully exported %d records to Parquet at s3://%s/%s (snappy)",
                len(combined_df), bucket_name, s3_key)
    return True


def export_bronze_parquet(
    events: Union[List[Dict[str, Any]], pd.DataFrame],
    source_feed: str = "all_hour.geojson",
    timestamp: Optional[datetime] = None,
    bucket_name: str = BUCKET_NAME
) -> Optional[str]:
    """
    Exports raw USGS events to Bronze Parquet partition:
    Key: bronze/year=YYYY/month=MM/day=DD/raw_events.parquet
    Resilient: On failure, logs warning and returns None.
    """
    try:
        ts = timestamp or datetime.now(timezone.utc)
        year = ts.strftime("%Y")
        month = ts.strftime("%m")
        day = ts.strftime("%d")

        s3_key = f"bronze/year={year}/month={month}/day={day}/raw_events.parquet"

        # Transform raw features to tabular structure
        if isinstance(events, pd.DataFrame):
            df = events.copy()
        elif isinstance(events, list):
            rows = []
            for item in events:
                if not isinstance(item, dict):
                    continue
                # If item is raw GeoJSON feature
                if "properties" in item and "id" in item:
                    payload_json = json.dumps(item, sort_keys=True)
                    payload_hash = hashlib.sha256(payload_json.encode()).hexdigest()
                    rows.append({
                        "event_id": item["id"],
                        "payload": payload_json,
                        "payload_hash": payload_hash,
                        "source_feed": source_feed,
                        "fetched_at": ts.isoformat()
                    })
                # If item is already DB row
                elif "event_id" in item:
                    rows.append(item)
            df = pd.DataFrame(rows)
        else:
            logger.warning("Unsupported events format for Bronze Parquet: %s", type(events))
            return None

        if df.empty:
            return None

        client = get_s3_client()
        ensure_bucket_exists(client, bucket_name)
        _write_or_append_parquet(client, df, s3_key, dedup_subset=["event_id", "payload_hash"], bucket_name=bucket_name)
        return s3_key
    except Exception as err:
        logger.warning("MinIO Bronze Parquet export failed (non-blocking fallback): %s", err)
        return None


def export_silver_parquet(
    valid_records: Union[List[Dict[str, Any]], pd.DataFrame],
    quarantined_records: Union[List[Dict[str, Any]], pd.DataFrame],
    timestamp: Optional[datetime] = None,
    bucket_name: str = BUCKET_NAME
) -> Dict[str, Optional[str]]:
    """
    Exports clean and quarantined events to Silver Parquet partitions:
    Valid:       silver/valid/year=YYYY/month=MM/events_clean.parquet
    Quarantine:  silver/quarantine/year=YYYY/month=MM/quarantined.parquet
    """
    results: Dict[str, Optional[str]] = {"valid": None, "quarantine": None}
    try:
        ts = timestamp or datetime.now(timezone.utc)
        year = ts.strftime("%Y")
        month = ts.strftime("%m")

        client = get_s3_client()
        ensure_bucket_exists(client, bucket_name)

        # 1. Valid Events
        valid_df = valid_records if isinstance(valid_records, pd.DataFrame) else pd.DataFrame(valid_records)
        if not valid_df.empty:
            valid_key = f"silver/valid/year={year}/month={month}/events_clean.parquet"
            _write_or_append_parquet(client, valid_df, valid_key, dedup_subset=["event_id"], bucket_name=bucket_name)
            results["valid"] = valid_key

        # 2. Quarantined Events
        quar_df = quarantined_records if isinstance(quarantined_records, pd.DataFrame) else pd.DataFrame(quarantined_records)
        if not quar_df.empty:
            quar_key = f"silver/quarantine/year={year}/month={month}/quarantined.parquet"
            _write_or_append_parquet(client, quar_df, quar_key, dedup_subset=["event_id", "failed_rules"], bucket_name=bucket_name)
            results["quarantine"] = quar_key

        return results
    except Exception as err:
        logger.warning("MinIO Silver Parquet export failed (non-blocking fallback): %s", err)
        return results


def export_gold_parquet(
    curated_records: Union[List[Dict[str, Any]], pd.DataFrame],
    timestamp: Optional[datetime] = None,
    bucket_name: str = BUCKET_NAME
) -> Optional[str]:
    """
    Exports curated earthquake events to Gold Parquet partition:
    Key: gold/year=YYYY/month=MM/earthquakes_curated.parquet
    """
    try:
        ts = timestamp or datetime.now(timezone.utc)
        year = ts.strftime("%Y")
        month = ts.strftime("%m")
        s3_key = f"gold/year={year}/month={month}/earthquakes_curated.parquet"

        df = curated_records if isinstance(curated_records, pd.DataFrame) else pd.DataFrame(curated_records)
        if df.empty:
            return None

        client = get_s3_client()
        ensure_bucket_exists(client, bucket_name)
        _write_or_append_parquet(client, df, s3_key, dedup_subset=["event_id"], bucket_name=bucket_name)
        return s3_key
    except Exception as err:
        logger.warning("MinIO Gold Parquet export failed (non-blocking fallback): %s", err)
        return None
