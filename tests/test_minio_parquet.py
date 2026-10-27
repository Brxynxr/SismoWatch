"""
Tests: MinIO Data Lakehouse & Apache Parquet Storage.
Verifies Medallion partitioning, Snappy compression, deduplication, and resilient fallback.
"""
import io
import os
import sys
import json
from datetime import datetime, timezone
import pytest
import pyarrow.parquet as pq
import pandas as pd
from unittest.mock import patch

AIRFLOW_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "airflow"))
if AIRFLOW_DIR not in sys.path:
    sys.path.insert(0, AIRFLOW_DIR)

from include.minio_exporter import (
    get_s3_client,
    ensure_bucket_exists,
    export_bronze_parquet,
    export_silver_parquet,
    export_gold_parquet,
    BUCKET_NAME
)


@pytest.fixture(scope="module")
def s3_client():
    client = get_s3_client()
    ensure_bucket_exists(client, BUCKET_NAME)
    return client


def test_minio_bucket_exists(s3_client):
    """Verifies that the target MinIO bucket exists and is accessible."""
    response = s3_client.head_bucket(Bucket=BUCKET_NAME)
    assert response["ResponseMetadata"]["HTTPStatusCode"] == 200


def test_export_bronze_parquet_and_snappy_compression(s3_client):
    """
    Tests export of raw GeoJSON events to Bronze Parquet partition
    bronze/year=YYYY/month=MM/day=DD/raw_events.parquet with Snappy compression.
    """
    fixed_ts = datetime(2026, 10, 27, 12, 0, 0, tzinfo=timezone.utc)
    raw_sample = [
        {
            "type": "Feature",
            "id": "us7000test_bronze_1",
            "properties": {
                "mag": 5.2,
                "place": "12km SSW of Ovalle, Chile",
                "time": 1700000000000,
                "title": "M 5.2 - 12km SSW of Ovalle, Chile"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [-71.25, -30.65, 45.0]
            }
        }
    ]

    key = export_bronze_parquet(raw_sample, source_feed="test_feed.geojson", timestamp=fixed_ts)
    assert key == "bronze/year=2026/month=10/day=27/raw_events.parquet"

    # Read back object from MinIO and inspect Parquet metadata
    obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
    buf = io.BytesIO(obj["Body"].read())
    table = pq.read_table(buf)
    meta = pq.read_metadata(buf)

    assert table.num_rows >= 1
    assert "event_id" in table.column_names
    assert "payload" in table.column_names
    assert "payload_hash" in table.column_names
    # Verify Snappy columnar compression
    assert meta.row_group(0).column(0).compression == "SNAPPY"


def test_export_silver_parquet(s3_client):
    """
    Tests export of clean and quarantined records to Silver Parquet partitions:
    silver/valid/year=YYYY/month=MM/events_clean.parquet
    silver/quarantine/year=YYYY/month=MM/quarantined.parquet
    """
    fixed_ts = datetime(2026, 10, 27, 12, 0, 0, tzinfo=timezone.utc)
    valid_sample = [
        {
            "event_id": "us7000test_silver_valid",
            "magnitude": 4.8,
            "place": "Central Mid-Atlantic Ridge",
            "time": datetime(2026, 10, 27, 10, 0, 0),
            "region": "Mid-Atlantic Ridge",
            "magnitude_class": "Moderado"
        }
    ]
    quar_sample = [
        {
            "event_id": "us7000test_silver_quar",
            "failed_rules": "['mag_out_of_bounds']",
            "rejection_reason": "Magnitude exceeds valid terrestrial bounds",
            "quarantined_at": datetime(2026, 10, 27, 10, 0, 0)
        }
    ]

    res = export_silver_parquet(valid_sample, quar_sample, timestamp=fixed_ts)
    assert res["valid"] == "silver/valid/year=2026/month=10/events_clean.parquet"
    assert res["quarantine"] == "silver/quarantine/year=2026/month=10/quarantined.parquet"

    # Verify both partitions exist in MinIO
    obj_valid = s3_client.get_object(Bucket=BUCKET_NAME, Key=res["valid"])
    table_valid = pq.read_table(io.BytesIO(obj_valid["Body"].read()))
    assert table_valid.num_rows >= 1

    obj_quar = s3_client.get_object(Bucket=BUCKET_NAME, Key=res["quarantine"])
    table_quar = pq.read_table(io.BytesIO(obj_quar["Body"].read()))
    assert table_quar.num_rows >= 1


def test_export_gold_parquet_and_deduplication(s3_client):
    """
    Tests export of curated records to Gold Parquet partition
    gold/year=YYYY/month=MM/earthquakes_curated.parquet and verifies deduplication.
    """
    fixed_ts = datetime(2026, 10, 27, 12, 0, 0, tzinfo=timezone.utc)
    gold_record = [
        {
            "event_id": "us7000test_gold_dedup",
            "magnitude": 6.1,
            "place": "Off coast of Maule, Chile",
            "region": "Chile",
            "magnitude_class": "Fuerte",
            "impact_radius_km": 150.0
        }
    ]

    key = export_gold_parquet(gold_record, timestamp=fixed_ts)
    assert key == "gold/year=2026/month=10/earthquakes_curated.parquet"

    # Export again with the same event_id (updated magnitude)
    updated_gold = [
        {
            "event_id": "us7000test_gold_dedup",
            "magnitude": 6.2,
            "place": "Off coast of Maule, Chile",
            "region": "Chile",
            "magnitude_class": "Fuerte",
            "impact_radius_km": 160.0
        }
    ]
    export_gold_parquet(updated_gold, timestamp=fixed_ts)

    # Read back and confirm deduplication
    obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
    table = pq.read_table(io.BytesIO(obj["Body"].read()))
    df = table.to_pandas()
    matching_rows = df[df["event_id"] == "us7000test_gold_dedup"]
    assert len(matching_rows) == 1
    assert matching_rows.iloc[0]["magnitude"] == 6.2


def test_minio_resilience_on_connection_error():
    """
    Verifies that if MinIO is unreachable or throws an exception,
    the exporter catches the exception and returns None/empty without raising.
    """
    with patch("include.minio_exporter.get_s3_client") as mock_client:
        mock_client.side_effect = ConnectionError("MinIO network unreachable simulation")

        res_bronze = export_bronze_parquet([{"id": "e1"}])
        assert res_bronze is None

        res_silver = export_silver_parquet([{"event_id": "e1"}], [])
        assert res_silver["valid"] is None

        res_gold = export_gold_parquet([{"event_id": "e1"}])
        assert res_gold is None
