"""
SismoWatch - Data Quality Engine (Pandera Two-Level Validation)
Level 1: Batch-Level Quality (Blocking: freshness, volume anomaly, structural schema).
Level 2: Row-Level Quality (Non-blocking quarantine: out-of-bounds coords, null IDs, invalid dates).
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Tuple
import pandas as pd
import pandera.pandas as pa
from pandera.errors import SchemaErrors

logger = logging.getLogger("airflow.task")

class BatchQualityError(Exception):
    """Raised when batch-level checks fail, halting data propagation to Gold."""
    pass

# Pandera DataFrame Schema for Row-Level Quality (Silver Layer)
EARTHQUAKE_ROW_SCHEMA = pa.DataFrameSchema(
    columns={
        "event_id": pa.Column(
            str,
            checks=[
                pa.Check(lambda s: s.str.strip().str.len() > 0, error="EMPTY_OR_NULL_EVENT_ID")
            ],
            nullable=False
        ),
        "latitude": pa.Column(
            float,
            checks=[
                pa.Check.in_range(-90.0, 90.0, error="LATITUDE_OUT_OF_BOUNDS")
            ],
            nullable=False
        ),
        "longitude": pa.Column(
            float,
            checks=[
                pa.Check.in_range(-180.0, 180.0, error="LONGITUDE_OUT_OF_BOUNDS")
            ],
            nullable=False
        ),
        "magnitude": pa.Column(
            float,
            checks=[
                pa.Check.in_range(-2.0, 10.0, error="MAGNITUDE_PLAUSIBILITY_OUT_OF_BOUNDS")
            ],
            nullable=True
        ),
        "depth_km": pa.Column(
            float,
            checks=[
                pa.Check.in_range(-5.0, 1000.0, error="DEPTH_OUT_OF_PLAUSIBLE_RANGE")
            ],
            nullable=False
        ),
        "event_time": pa.Column(
            pa.DateTime,
            checks=[
                pa.Check(lambda d: d.notnull(), error="NULL_EVENT_TIME"),
                pa.Check(lambda d: d <= datetime.now(timezone.utc) + timedelta(minutes=15), error="FUTURE_EVENT_TIME")
            ],
            nullable=False
        )
    },
    coerce=True,
    strict=False
)

def validate_batch_level(geojson_data: Dict[str, Any], max_freshness_minutes: int = 120) -> int:
    """
    Level 1: Batch Quality Validation (BLOCKING).
    Verifies:
      1. Structural GeoJSON format (type=FeatureCollection, features is a list).
      2. Volume anomaly (features list is not empty when feed returned HTTP 200).
      3. Freshness threshold (latest event is not older than max_freshness_minutes).
    Raises BatchQualityError if any check fails.
    """
    if not isinstance(geojson_data, dict):
        raise BatchQualityError("BATCH_SCHEMA_ERROR: Payload is not a valid JSON dictionary.")

    if geojson_data.get("type") != "FeatureCollection":
        raise BatchQualityError("BATCH_SCHEMA_ERROR: Expected GeoJSON FeatureCollection.")

    features = geojson_data.get("features")
    if not isinstance(features, list):
        raise BatchQualityError("BATCH_SCHEMA_ERROR: 'features' key is missing or not a list.")

    count = len(features)
    if count == 0:
        logger.warning("Batch volume is zero. If USGS feed is normally active, volume is abnormally empty.")
        return 0

    if count > 5000:
        raise BatchQualityError(f"BATCH_VOLUME_ANOMALY: Abnormally high event count ({count}) in single hour feed.")

    # Freshness check: check latest timestamp in metadata or features
    metadata = geojson_data.get("metadata") or {}
    gen_time_ms = metadata.get("generated")
    if gen_time_ms:
        gen_time = datetime.fromtimestamp(gen_time_ms / 1000.0, tz=timezone.utc)
        now_utc = datetime.now(timezone.utc)
        latency_sec = (now_utc - gen_time).total_seconds()
        if latency_sec > (max_freshness_minutes * 60):
            raise BatchQualityError(
                f"BATCH_FRESHNESS_VIOLATION: Data generation latency ({latency_sec/60:.1f} min) "
                f"exceeds tolerance of {max_freshness_minutes} min."
            )

    logger.info("Batch-level validation PASSED for %d events.", count)
    return count

def validate_rows_and_quarantine(
    records: List[Dict[str, Any]],
    raw_id_map: Dict[str, int] = None
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Level 2: Row-Level Quality Validation with Pandera (lazy=True).
    Separates valid rows from corrupted rows.
    Returns:
      (valid_records, quarantined_records, metrics_summary)
    """
    raw_id_map = raw_id_map or {}
    if not records:
        return [], [], {
            "total_evaluated": 0,
            "total_passed": 0,
            "total_quarantined": 0,
            "quality_score": 100.0,
            "freshness_latency_seconds": 0
        }

    df = pd.DataFrame(records)

    # Convert event_time to UTC datetime if needed
    if "event_time" in df.columns:
        df["event_time"] = pd.to_datetime(df["event_time"], utc=True)

    failed_indices = set()
    failure_reasons: Dict[int, List[str]] = {}

    try:
        EARTHQUAKE_ROW_SCHEMA.validate(df, lazy=True)
    except SchemaErrors as err:
        failure_cases = err.failure_cases
        for _, row in failure_cases.iterrows():
            idx = row["index"]
            check_name = str(row.get("check") or "SCHEMA_ERROR")
            col = str(row.get("column") or "RECORD")
            if pd.notnull(idx):
                idx = int(idx)
                failed_indices.add(idx)
                if idx not in failure_reasons:
                    failure_reasons[idx] = []
                failure_reasons[idx].append(f"{col}:{check_name}")

    # Check batch uniqueness of event_id
    duplicate_mask = df.duplicated(subset=["event_id"], keep="first")
    for idx in df[duplicate_mask].index:
        failed_indices.add(idx)
        if idx not in failure_reasons:
            failure_reasons[idx] = []
        failure_reasons[idx].append("DUPLICATE_EVENT_ID_IN_BATCH")

    valid_records = []
    quarantined_records = []

    for idx, rec in enumerate(records):
        if idx in failed_indices:
            rules = failure_reasons.get(idx, ["UNKNOWN_VALIDATION_ERROR"])
            quarantined_records.append({
                "raw_id": raw_id_map.get(rec.get("event_id")),
                "event_id": rec.get("event_id"),
                "failed_rules": rules,
                "rejection_reason": "; ".join(rules),
                "payload": rec
            })
        else:
            valid_records.append(rec)

    total_eval = len(records)
    total_pass = len(valid_records)
    total_quar = len(quarantined_records)
    score = round((total_pass / total_eval) * 100.0, 2) if total_eval > 0 else 100.0

    # Calculate freshness latency
    freshness_latency = 0
    if valid_records:
        latest_event = max(r["event_time"] for r in valid_records if r.get("event_time"))
        if latest_event:
            if isinstance(latest_event, pd.Timestamp):
                latest_event = latest_event.to_pydatetime()
            now_utc = datetime.now(timezone.utc)
            freshness_latency = max(0, int((now_utc - latest_event).total_seconds()))

    metrics = {
        "total_evaluated": total_eval,
        "total_passed": total_pass,
        "total_quarantined": total_quar,
        "quality_score": score,
        "freshness_latency_seconds": freshness_latency
    }

    logger.info("Row-level validation: %d evaluated, %d passed, %d quarantined. Score: %.1f%%",
                total_eval, total_pass, total_quar, score)
    return valid_records, quarantined_records, metrics
