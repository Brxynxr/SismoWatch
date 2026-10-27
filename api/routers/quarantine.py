from typing import Dict, Any, List
from fastapi import APIRouter, Depends, Query
from psycopg2.extras import RealDictCursor
from auth import require_admin, UserPayload
from db import get_api_reader_conn

router = APIRouter(prefix="/api/quality", tags=["Calidad y Cuarentena (Admin)"])

@router.get("/quarantine", response_model=Dict[str, Any])
def list_quarantined_records(
    limit: int = Query(50, ge=1, le=200),
    current_user: UserPayload = Depends(require_admin)
):
    """
    Lista registros aislados en cuarentena por violaciones de calidad Pandera.
    RESTRINGIDO EXCLUSIVAMENTE A ROL ADMIN.
    Los usuarios 'viewer' reciben HTTP 403 Forbidden.
    """
    with get_api_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT count(*) as total FROM curated.v_quarantine;")
            total = cur.fetchone()["total"]

            cur.execute("""
                SELECT quarantine_id, event_id, failed_rules, 
                       rejection_reason, payload, quarantined_at
                FROM curated.v_quarantine
                ORDER BY quarantined_at DESC
                LIMIT %s;
            """, (limit,))
            items = [dict(r) for r in cur.fetchall()]

            return {
                "total": total,
                "items": items,
                "requested_by": current_user.username
            }
