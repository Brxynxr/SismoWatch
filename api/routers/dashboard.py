from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg2.extras import RealDictCursor
from auth import get_current_user, UserPayload
from db import get_api_reader_conn

router = APIRouter(prefix="/api", tags=["Dashboard & KPIs"])

INTERVAL_MAP = {
    "24h": "24 hours",
    "7d": "7 days",
    "30d": "30 days",
    "1y": "365 days"
}

@router.get("/kpis", response_model=Dict[str, Any])
def get_kpis(
    range: str = Query("24h", pattern="^(24h|7d|30d|1y)$", description="Rango de tiempo"),
    current_user: UserPayload = Depends(get_current_user)
):
    """Returns summary KPIs filtered consistently by the requested time range."""
    interval_val = INTERVAL_MAP.get(range, "24 hours")
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    COUNT(*)::int AS total_events_24h,
                    COALESCE(MAX(magnitude), 0.0)::float AS max_magnitude_24h,
                    COALESCE(ROUND(AVG(magnitude), 2), 0.0)::float AS avg_magnitude_24h,
                    COUNT(*) FILTER (WHERE tsunami_alert = true)::int AS tsunami_alerts_24h,
                    MAX(event_time) AS latest_event_time,
                    COUNT(*) FILTER (WHERE status = 'reviewed')::int AS reviewed_events_24h
                FROM curated.earthquakes
                WHERE event_time >= NOW() - (%s)::interval;
            """, (interval_val,))
            row = cur.fetchone()
            if not row or row["total_events_24h"] == 0:
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
def get_hourly_stats(
    range: str = Query("24h", pattern="^(24h|7d|30d|1y)$"),
    current_user: UserPayload = Depends(get_current_user)
):
    """Returns event count over time for the requested time range."""
    interval_val = INTERVAL_MAP.get(range, "24 hours")
    if range == "1y":
        date_trunc = "month"
    elif range == "30d":
        date_trunc = "week"
    elif range == "7d":
        date_trunc = "day"
    else:
        date_trunc = "hour"
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    date_trunc(%s, event_time) AS hour_bucket,
                    COUNT(*)::int AS event_count,
                    COALESCE(MAX(magnitude), 0.0)::float AS max_magnitude
                FROM curated.earthquakes
                WHERE event_time >= NOW() - (%s)::interval
                GROUP BY 1
                ORDER BY 1 ASC;
            """, (date_trunc, interval_val))
            rows = cur.fetchall()
            return [dict(r) for r in rows]

@router.get("/stats/regions", response_model=List[Dict[str, Any]])
def get_region_stats(
    range: str = Query("24h", pattern="^(24h|7d|30d|1y)$"),
    current_user: UserPayload = Depends(get_current_user)
):
    """Returns top active regions for the requested time range."""
    interval_val = INTERVAL_MAP.get(range, "24 hours")
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    COALESCE(region, 'Desconocida') AS region,
                    COUNT(*)::int AS event_count,
                    COALESCE(MAX(magnitude), 0.0)::float AS max_magnitude,
                    COALESCE(ROUND(AVG(magnitude), 2), 0.0)::float AS avg_magnitude
                FROM curated.earthquakes
                WHERE event_time >= NOW() - (%s)::interval
                GROUP BY 1
                ORDER BY event_count DESC
                LIMIT 10;
            """, (interval_val,))
            rows = cur.fetchall()
            return [dict(r) for r in rows]

@router.get("/stats/magnitudes", response_model=List[Dict[str, Any]])
def get_magnitude_distribution(
    range: str = Query("24h", pattern="^(24h|7d|30d|1y)$"),
    current_user: UserPayload = Depends(get_current_user)
):
    """Returns distribution of events by magnitude class for the requested time range."""
    interval_val = INTERVAL_MAP.get(range, "24 hours")
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                WITH totals AS (
                    SELECT COUNT(*) AS total
                    FROM curated.earthquakes
                    WHERE event_time >= NOW() - (%s)::interval
                )
                SELECT 
                    magnitude_class,
                    COUNT(*)::int AS event_count,
                    ROUND((COUNT(*)::numeric / NULLIF((SELECT total FROM totals), 0)) * 100, 2)::float AS percentage
                FROM curated.earthquakes
                WHERE event_time >= NOW() - (%s)::interval
                GROUP BY magnitude_class
                ORDER BY event_count DESC;
            """, (interval_val, interval_val))
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
