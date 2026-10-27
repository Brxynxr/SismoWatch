"""
Unit Tests: Data Quality Engine (Pandera Two-Level Validation)
Tests batch-level blocking validation and row-level routing to quarantine.
"""
import pytest
from datetime import datetime, timezone, timedelta
from include.quality import (
    validate_batch_level,
    validate_rows_and_quarantine,
    BatchQualityError
)

def test_validate_batch_level_success():
    valid_batch = {
        "type": "FeatureCollection",
        "metadata": {"generated": int(datetime.now(timezone.utc).timestamp() * 1000)},
        "features": [{"id": "ev1"}, {"id": "ev2"}]
    }
    count = validate_batch_level(valid_batch)
    assert count == 2

def test_validate_batch_level_failure_schema():
    with pytest.raises(BatchQualityError) as exc_info:
        validate_batch_level({"invalid": "schema"})
    assert "BATCH_SCHEMA_ERROR" in str(exc_info.value)

def test_validate_batch_level_freshness_violation():
    old_time_ms = int((datetime.now(timezone.utc) - timedelta(hours=5)).timestamp() * 1000)
    stale_batch = {
        "type": "FeatureCollection",
        "metadata": {"generated": old_time_ms},
        "features": [{"id": "ev1"}]
    }
    with pytest.raises(BatchQualityError) as exc_info:
        validate_batch_level(stale_batch, max_freshness_minutes=60)
    assert "BATCH_FRESHNESS_VIOLATION" in str(exc_info.value)

def test_validate_rows_and_quarantine():
    now_utc = datetime.now(timezone.utc)
    test_records = [
        # Record 1: Valid
        {
            "event_id": "clean_1",
            "magnitude": 4.5,
            "latitude": 34.0,
            "longitude": -118.0,
            "depth_km": 10.0,
            "event_time": now_utc - timedelta(minutes=5)
        },
        # Record 2: Invalid Latitude (> 90) -> Should go to quarantine
        {
            "event_id": "corrupt_lat",
            "magnitude": 3.0,
            "latitude": 150.0,
            "longitude": -118.0,
            "depth_km": 10.0,
            "event_time": now_utc - timedelta(minutes=10)
        },
        # Record 3: Invalid Longitude (< -180) -> Should go to quarantine
        {
            "event_id": "corrupt_lon",
            "magnitude": 2.1,
            "latitude": 10.0,
            "longitude": -200.0,
            "depth_km": 5.0,
            "event_time": now_utc - timedelta(minutes=15)
        },
        # Record 4: Duplicate ID of Record 1 -> Should go to quarantine
        {
            "event_id": "clean_1",
            "magnitude": 4.5,
            "latitude": 34.0,
            "longitude": -118.0,
            "depth_km": 10.0,
            "event_time": now_utc - timedelta(minutes=5)
        }
    ]

    valid, quarantined, metrics = validate_rows_and_quarantine(test_records)

    assert len(valid) == 1
    assert valid[0]["event_id"] == "clean_1"
    assert len(quarantined) == 3

    quar_ids = [q["event_id"] for q in quarantined]
    assert "corrupt_lat" in quar_ids
    assert "corrupt_lon" in quar_ids
    assert "clean_1" in quar_ids

    # Verify metrics
    assert metrics["total_evaluated"] == 4
    assert metrics["total_passed"] == 1
    assert metrics["total_quarantined"] == 3
    assert metrics["quality_score"] == 25.0
