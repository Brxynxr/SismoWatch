from typing import Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException
from psycopg2.extras import RealDictCursor
from auth import get_current_user, UserPayload
from db import get_api_reader_conn

router = APIRouter(prefix="/api", tags=["Dashboard & KPIs"])

@router.get("/kpis", response_model=Dict[str, Any])
def get_kpis(current_user: UserPayload = Depends(get_current_user)):
    """Returns 24h summary KPIs from curated.v_kpis_24h."""
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM curated.v_kpis_24h LIMIT 1;")
            row = cur.fetchone()
            if not row:
                return {
                    "total_events_24h": 0,
                    "max_magnitude_24h": 0.0,
                    "avg_magnitude_24h": 0.0,
                    "tsunami_alerts_24h": 0,
                    "latest_event_time": None,
                    "reviewed_events_24h": 0
                }
            return dict(row)

@router.get("/stats/hourly", response_model=List[Dict[str, Any]])
def get_hourly_stats(current_user: UserPayload = Depends(get_current_user)):
    """Returns event count by hour from curated.v_hourly_counts."""
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT hour_bucket, event_count, max_magnitude FROM curated.v_hourly_counts ORDER BY hour_bucket ASC;")
            rows = cur.fetchall()
            return [dict(r) for r in rows]

@router.get("/stats/regions", response_model=List[Dict[str, Any]])
def get_region_stats(current_user: UserPayload = Depends(get_current_user)):
    """Returns top active regions from curated.v_region_activity."""
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT region_name AS region, total_events AS event_count, max_magnitude, avg_magnitude FROM curated.v_region_activity ORDER BY total_events DESC LIMIT 10;")
            rows = cur.fetchall()
            return [dict(r) for r in rows]

@router.get("/stats/magnitudes", response_model=List[Dict[str, Any]])
def get_magnitude_distribution(current_user: UserPayload = Depends(get_current_user)):
    """Returns distribution of events by magnitude class from curated.v_magnitude_distribution."""
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT magnitude_class, event_count, percentage FROM curated.v_magnitude_distribution ORDER BY event_count DESC;")
            rows = cur.fetchall()
            return [dict(r) for r in rows]

@router.get("/pipeline/status", response_model=Dict[str, Any])
def get_pipeline_status(current_user: UserPayload = Depends(get_current_user)):
    """Returns data quality health and freshness status from curated.quality_runs."""
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT run_id, dag_id, evaluated_rules, passed_rules, failed_rules, 
                       quality_score, freshness_minutes, executed_at
                FROM curated.quality_runs 
                ORDER BY executed_at DESC 
                LIMIT 5;
            """)
            recent_runs = [dict(r) for r in cur.fetchall()]

            # Quarantine count summary via curated.v_quarantine count (or 0 if empty)
            cur.execute("SELECT count(*) as total_quarantined FROM curated.v_quarantine;")
            q_row = cur.fetchone()
            total_quarantined = q_row["total_quarantined"] if q_row else 0

            latest_run = recent_runs[0] if recent_runs else None
            quality_score = float(latest_run["quality_score"]) if latest_run and latest_run.get("quality_score") is not None else 100.0
            freshness_min = float(latest_run["freshness_minutes"]) if latest_run and latest_run.get("freshness_minutes") is not None else 0.0

            return {
                "status": "healthy" if quality_score >= 80.0 else "degraded",
                "latest_quality_score": quality_score,
                "latest_freshness_minutes": freshness_min,
                "total_quarantined_records": total_quarantined,
                "recent_quality_runs": recent_runs
            }
