import csv
import io
from typing import Optional, Dict, Any, List
from datetime import datetime
from fastapi import APIRouter, Depends, Query, HTTPException, status
from fastapi.responses import Response
from psycopg2.extras import RealDictCursor
from auth import get_current_user, UserPayload
from db import get_api_reader_conn

router = APIRouter(prefix="/api/reports", tags=["Reportes e IA"])

@router.get("", response_model=List[Dict[str, Any]])
def list_reports(
    limit: int = Query(20, ge=1, le=100),
    current_user: UserPayload = Depends(get_current_user)
):
    """Lista reportes ejecutivos generados por el agente IA."""
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT report_id, report_date, title, summary, total_events, 
                       max_magnitude, regions_affected, generated_at
                FROM curated.ai_reports
                ORDER BY report_date DESC, generated_at DESC
                LIMIT %s;
            """, (limit,))
            return [dict(r) for r in cur.fetchall()]

@router.get("/latest", response_model=Dict[str, Any])
def get_latest_report(current_user: UserPayload = Depends(get_current_user)):
    """Obtiene el reporte ejecutivo más reciente."""
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT report_id, report_date, title, summary, key_findings,
                       recommendations, total_events, max_magnitude, regions_affected,
                       model_used, execution_seconds, generated_at
                FROM curated.ai_reports
                ORDER BY generated_at DESC
                LIMIT 1;
            """)
            row = cur.fetchone()
            if not row:
                return {
                    "report_id": 0,
                    "report_date": datetime.utcnow().strftime("%Y-%m-%d"),
                    "title": "Sin reportes generados aún",
                    "summary": "El pipeline de reportes diarios generará el primer informe automáticamente a las 06:00 UTC o bajo demanda desde el panel de administración.",
                    "key_findings": ["Esperando primera ejecución programada"],
                    "recommendations": ["Monitorear el feed en tiempo real"],
                    "total_events": 0,
                    "max_magnitude": 0.0,
                    "regions_affected": [],
                    "model_used": "qwen2.5-coder:1.5b",
                    "execution_seconds": 0.0,
                    "generated_at": datetime.utcnow().isoformat()
                }
            return dict(row)

@router.get("/export")
def export_events_csv(
    min_magnitude: Optional[float] = Query(None),
    region: Optional[str] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
    current_user: UserPayload = Depends(get_current_user)
):
    """Exporta eventos sísmicos en formato CSV para análisis externo."""
    conditions = ["1=1"]
    params = []
    if min_magnitude is not None:
        conditions.append("magnitude >= %s")
        params.append(min_magnitude)
    if region:
        conditions.append("region ILIKE %s")
        params.append(f"%{region}%")

    where_clause = " AND ".join(conditions)

    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT event_id, event_time, magnitude, magnitude_class, region, place, 
                       latitude, longitude, depth_km, impact_radius_km, tsunami_alert, status
                FROM curated.earthquakes
                WHERE {where_clause}
                ORDER BY event_time DESC
                LIMIT %s;
            """, params + [limit])
            rows = cur.fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "event_id", "event_time", "magnitude", "magnitude_class", "region",
        "place", "latitude", "longitude", "depth_km", "impact_radius_km", "tsunami_alert", "status"
    ])
    for r in rows:
        writer.writerow([
            r["event_id"],
            r["event_time"].isoformat() if r["event_time"] else "",
            r["magnitude"],
            r["magnitude_class"],
            r["region"],
            r["place"],
            r["latitude"],
            r["longitude"],
            r["depth_km"],
            r["impact_radius_km"],
            r["tsunami_alert"],
            r["status"]
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=sismowatch_events_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
        }
    )
