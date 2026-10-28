import asyncio
import json
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Query, HTTPException, status
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from psycopg2.extras import RealDictCursor
from config import settings
from db import get_api_reader_conn

logger = logging.getLogger("sismowatch.api.stream")
router = APIRouter(prefix="/api", tags=["Streaming en Tiempo Real"])

def _verify_sse_token(token: Optional[str]) -> str:
    """Validates token from query param or throws 401 Unauthorized."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de acceso requerido para el stream en tiempo real.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        role = payload.get("role")
        if not role:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token inválido: rol no especificado.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return role
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de acceso inválido o expirado.",
            headers={"WWW-Authenticate": "Bearer"},
        )

@router.get("/stream")
async def event_stream(token: Optional[str] = Query(None)):
    """
    Server-Sent Events (SSE) endpoint:
    Streams latest seismic metrics and recent events every 5 seconds.
    Enables instant dashboard updates without page reloads.
    """
    _verify_sse_token(token)

    async def generate_sse_events():
        last_event_id = None
        while True:
            try:
                with get_api_reader_conn() as conn:
                    with conn.cursor(cursor_factory=RealDictCursor) as cur:
                        # KPIs
                        cur.execute("SELECT * FROM curated.v_kpis_24h LIMIT 1;")
                        kpis = cur.fetchone() or {}

                        # Top 5 most recent events
                        cur.execute("""
                            SELECT event_id, latitude, longitude, depth_km, magnitude, magnitude_class,
                                   place, region, impact_radius_km, event_time, tsunami_alert, status
                            FROM curated.earthquakes
                            ORDER BY event_time DESC
                            LIMIT 5;
                        """)
                        recent_events = [dict(r) for r in cur.fetchall()]

                        from decimal import Decimal
                        def serialize_val(v):
                            if isinstance(v, datetime):
                                return v.isoformat()
                            if isinstance(v, Decimal):
                                return float(v)
                            return v

                        serialized_kpis = {k: serialize_val(v) for k, v in kpis.items()}
                        serialized_events = [
                            {k: serialize_val(v) for k, v in ev.items()}
                            for ev in recent_events
                        ]

                        payload = {
                            "timestamp": datetime.utcnow().isoformat(),
                            "kpis": serialized_kpis,
                            "recent_events": serialized_events,
                            "type": "heartbeat_update"
                        }

                        yield f"event: seismic_update\ndata: {json.dumps(payload, default=str)}\n\n"

            except Exception as e:
                logger.error("Error reading DB for SSE stream: %s", e)
                yield f"event: error\ndata: {json.dumps({'error': 'Error interno al consultar métricas sísmicas'})}\n\n"

            await asyncio.sleep(5)

    return StreamingResponse(
        generate_sse_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
