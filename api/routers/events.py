from typing import Optional, Dict, Any, List
from datetime import datetime
from fastapi import APIRouter, Depends, Query, HTTPException, status
from psycopg2.extras import RealDictCursor
from auth import get_current_user, UserPayload
from db import get_api_reader_conn

router = APIRouter(prefix="/api/events", tags=["Eventos Sísmicos"])

@router.get("", response_model=Dict[str, Any])
def list_events(
    min_magnitude: Optional[float] = Query(None, description="Magnitud mínima"),
    max_magnitude: Optional[float] = Query(None, description="Magnitud máxima"),
    region: Optional[str] = Query(None, description="Filtro por nombre de región"),
    magnitude_class: Optional[str] = Query(None, description="Micro, Minor, Light, Moderate, Strong, Major, Great"),
    start_date: Optional[datetime] = Query(None, description="Fecha de inicio (ISO 8601)"),
    end_date: Optional[datetime] = Query(None, description="Fecha de fin (ISO 8601)"),
    time_range: Optional[str] = Query(None, pattern="^(24h|7d|30d|1y)$", description="Filtro rápido de tiempo (24h, 7d, 30d, 1y)"),
    page: int = Query(1, ge=1, description="Número de página"),
    page_size: int = Query(20, ge=1, le=500, description="Tamaño de página"),
    current_user: UserPayload = Depends(get_current_user)
):
    """
    Lista eventos sísmicos desde curated.earthquakes con filtros avanzados y paginación.
    Acceso concedido tanto a roles viewer como admin.
    """
    conditions = ["1=1"]
    params = []

    if min_magnitude is not None:
        conditions.append("magnitude >= %s")
        params.append(min_magnitude)

    if max_magnitude is not None:
        conditions.append("magnitude <= %s")
        params.append(max_magnitude)

    if region:
        conditions.append("region ILIKE %s")
        params.append(f"%{region}%")

    if magnitude_class:
        conditions.append("magnitude_class = %s")
        params.append(magnitude_class)

    if start_date:
        conditions.append("event_time >= %s")
        params.append(start_date)

    if end_date:
        conditions.append("event_time <= %s")
        params.append(end_date)

    if time_range:
        interval_map = {"24h": "24 hours", "7d": "7 days", "30d": "30 days", "1y": "365 days"}
        interval_val = interval_map.get(time_range, "24 hours")
        conditions.append(f"event_time >= NOW() - INTERVAL '{interval_val}'")

    where_clause = " AND ".join(conditions)
    offset = (page - 1) * page_size

    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Total count
            count_query = f"SELECT count(*) as total FROM curated.earthquakes WHERE {where_clause};"  # nosec B608
            cur.execute(count_query, params)
            total = cur.fetchone()["total"]

            # Paginated items
            data_query = (
                f"SELECT event_id, latitude, longitude, depth_km, magnitude, magnitude_class, "
                f"place, region, impact_radius_km, event_time, updated_time, tsunami_alert, "
                f"status, significance, mag_type, usgs_url "
                f"FROM curated.earthquakes WHERE {where_clause} "  # nosec B608
                f"ORDER BY event_time DESC LIMIT %s OFFSET %s;"
            )
            cur.execute(data_query, params + [page_size, offset])
            items = [dict(r) for r in cur.fetchall()]

            total_pages = (total + page_size - 1) // page_size if total > 0 else 1

            return {
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages
            }

@router.get("/{event_id}", response_model=Dict[str, Any])
def get_event_detail(event_id: str, current_user: UserPayload = Depends(get_current_user)):
    """Obtiene el detalle completo de un evento específico por su event_id."""
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM curated.earthquakes WHERE event_id = %s;", (event_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Evento sísmico con ID '{event_id}' no encontrado en Gold (curated.earthquakes)."
                )
            return dict(row)
