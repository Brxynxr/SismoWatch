"""
SismoWatch - Database Operations Helper (POLP Enforcement)
Provides dedicated connection contexts and batch operations for Ingestion and Transformation roles.
"""
import os
import json
import logging
import psycopg2
from psycopg2.extras import execute_batch, Json
from typing import List, Dict, Any, Tuple

logger = logging.getLogger("airflow.task")

def get_db_connection(user_env_var: str, pwd_env_var: str, default_user: str, default_pwd: str):
    user = os.getenv(user_env_var, default_user)
    password = os.getenv(pwd_env_var, default_pwd)
    host = os.getenv("POSTGRES_HOST", "postgres")
    port = int(os.getenv("POSTGRES_PORT", "5432"))
    dbname = os.getenv("POSTGRES_DB", "sismowatch_db")

    return psycopg2.connect(
        host=host,
        port=port,
        dbname=dbname,
        user=user,
        password=password
    )

def get_ingestion_connection():
    return get_db_connection("DB_INGESTION_USER", "DB_INGESTION_PASSWORD", "user_ingestion", "ingestion_secret_pwd_2026")

def get_transformation_connection():
    return get_db_connection("DB_TRANSFORMATION_USER", "DB_TRANSFORMATION_PASSWORD", "user_transformation", "transformation_secret_pwd_2026")

def insert_raw_events(events: List[Dict[str, Any]], source_feed: str) -> int:
    """
    Inserts raw GeoJSON features into raw.usgs_events using role_ingestion.
    Idempotent: ON CONFLICT (event_id, payload_hash) DO NOTHING.
    Returns the count of newly inserted events.
    """
    if not events:
        return 0

    from include.transform import compute_payload_hash

    records_to_insert = []
    for f in events:
        event_id = str(f.get("id") or "").strip()
        if not event_id:
            continue
        p_hash = compute_payload_hash(f)
        records_to_insert.append((event_id, Json(f), p_hash, source_feed))

    sql = """
        INSERT INTO raw.usgs_events (event_id, payload, payload_hash, source_feed)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (event_id, payload_hash) DO NOTHING;
    """
    conn = get_ingestion_connection()
    try:
        cur = conn.cursor()
        execute_batch(cur, sql, records_to_insert, page_size=100)
        conn.commit()
        inserted_count = len(records_to_insert)
        cur.close()
        logger.info("Successfully ingested %d raw events to raw.usgs_events.", inserted_count)
        return inserted_count
    finally:
        conn.close()

def fetch_latest_raw_events(limit: int = 500) -> List[Dict[str, Any]]:
    """
    Fetches latest unprocessed or recently updated raw records using role_transformation.
    """
    sql = """
        SELECT id, event_id, payload
        FROM raw.usgs_events
        ORDER BY fetched_at DESC
        LIMIT %s;
    """
    conn = get_transformation_connection()
    try:
        cur = conn.cursor()
        cur.execute(sql, (limit,))
        rows = cur.fetchall()
        cur.close()
        return [{"raw_id": r[0], "event_id": r[1], "payload": r[2]} for r in rows]
    finally:
        conn.close()

def save_staging_and_curated(
    valid_records: List[Dict[str, Any]],
    quarantined_records: List[Dict[str, Any]],
    metrics: Dict[str, Any],
    execution_id: str
):
    """
    Saves clean records to staging.events, quarantined to staging.quarantine,
    and applies conditional upsert into curated.earthquakes using role_transformation.
    Also records metrics into curated.quality_runs.
    """
    conn = get_transformation_connection()
    try:
        cur = conn.cursor()

        # 1. Insert quarantined records
        if quarantined_records:
            sql_quar = """
                INSERT INTO staging.quarantine (raw_id, event_id, failed_rules, rejection_reason, payload)
                VALUES (%s, %s, %s, %s, %s);
            """
            quar_data = [
                (q["raw_id"], q["event_id"], q["failed_rules"], q["rejection_reason"], Json(q["payload"]))
                for q in quarantined_records
            ]
            execute_batch(cur, sql_quar, quar_data, page_size=100)

        # 2. Insert/Upsert into staging.events
        if valid_records:
            sql_stg = """
                INSERT INTO staging.events (
                    event_id, magnitude, mag_type, place, event_time, updated_time,
                    longitude, latitude, depth_km, tsunami_alert, significance,
                    status, event_type, usgs_url
                ) VALUES (
                    %(event_id)s, %(magnitude)s, %(mag_type)s, %(place)s, %(event_time)s, %(updated_time)s,
                    %(longitude)s, %(latitude)s, %(depth_km)s, %(tsunami_alert)s, %(significance)s,
                    %(status)s, %(event_type)s, %(usgs_url)s
                )
                ON CONFLICT (event_id) DO UPDATE SET
                    magnitude = EXCLUDED.magnitude,
                    updated_time = EXCLUDED.updated_time,
                    status = EXCLUDED.status,
                    staged_at = NOW();
            """
            execute_batch(cur, sql_stg, valid_records, page_size=100)

            # 3. Conditional Upsert into curated.earthquakes (Gold)
            # Only update if EXCLUDED.updated_time is newer than existing updated_time
            sql_curated = """
                INSERT INTO curated.earthquakes (
                    event_id, magnitude, magnitude_class, mag_type, place, region,
                    impact_radius_km, event_time, updated_time, longitude, latitude,
                    depth_km, tsunami_alert, significance, status, event_type, usgs_url
                ) VALUES (
                    %(event_id)s, %(magnitude)s, %(magnitude_class)s, %(mag_type)s, %(place)s, %(region)s,
                    %(impact_radius_km)s, %(event_time)s, %(updated_time)s, %(longitude)s, %(latitude)s,
                    %(depth_km)s, %(tsunami_alert)s, %(significance)s, %(status)s, %(event_type)s, %(usgs_url)s
                )
                ON CONFLICT (event_id) DO UPDATE SET
                    magnitude = EXCLUDED.magnitude,
                    magnitude_class = EXCLUDED.magnitude_class,
                    mag_type = EXCLUDED.mag_type,
                    place = EXCLUDED.place,
                    region = EXCLUDED.region,
                    impact_radius_km = EXCLUDED.impact_radius_km,
                    updated_time = EXCLUDED.updated_time,
                    status = EXCLUDED.status,
                    last_modified_at = NOW()
                WHERE EXCLUDED.updated_time > curated.earthquakes.updated_time;
            """
            execute_batch(cur, sql_curated, valid_records, page_size=100)

        # 4. Save metrics into curated.quality_runs
        sql_metrics = """
            INSERT INTO curated.quality_runs (
                execution_id, total_evaluated, total_passed, total_quarantined,
                quality_score, freshness_latency_seconds
            ) VALUES (%s, %s, %s, %s, %s, %s);
        """
        cur.execute(sql_metrics, (
            execution_id,
            metrics["total_evaluated"],
            metrics["total_passed"],
            metrics["total_quarantined"],
            metrics["quality_score"],
            metrics["freshness_latency_seconds"]
        ))

        conn.commit()
        cur.close()
        logger.info("Successfully committed staging, curated and quality runs for execution %s.", execution_id)
    finally:
        conn.close()
