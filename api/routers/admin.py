import logging
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
import requests
from auth import require_admin, UserPayload
from config import settings

logger = logging.getLogger("sismowatch.api.admin")
router = APIRouter(prefix="/api/admin", tags=["Administración del Pipeline"])

class BackfillRequest(BaseModel):
    days_back: int = 7
    min_magnitude: float = 2.5

@router.post("/backfill", response_model=Dict[str, Any])
def trigger_historical_backfill(
    req: BackfillRequest,
    current_user: UserPayload = Depends(require_admin)
):
    """
    Dispara la recuperación histórica bajo demanda (DAG usgs_historical_backfill).
    Solo disponible para administradores.
    """
    airflow_endpoint = f"{settings.AIRFLOW_URL}/api/v1/dags/usgs_historical_backfill/dagRuns"
    try:
        payload = {
            "conf": {
                "days_back": req.days_back,
                "min_magnitude": req.min_magnitude,
                "triggered_by": current_user.username
            }
        }
        res = requests.post(
            airflow_endpoint,
            json=payload,
            auth=(settings.AIRFLOW_USER, settings.AIRFLOW_PASSWORD),
            timeout=10
        )
        if res.status_code in (200, 201):
            run_data = res.json()
            return {
                "message": f"Backfill histórico iniciado exitosamente para los últimos {req.days_back} días.",
                "dag_run_id": run_data.get("dag_run_id"),
                "state": run_data.get("state")
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Airflow API respondió con error {res.status_code}: {res.text}"
            )
    except requests.exceptions.RequestException as e:
        logger.error("Error contactando Airflow API: %s", e)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"No se pudo conectar con el orquestador Airflow en {settings.AIRFLOW_URL}: {str(e)}"
        )

@router.post("/reports/regenerate", response_model=Dict[str, Any])
def trigger_report_regeneration(
    current_user: UserPayload = Depends(require_admin)
):
    """
    Dispara la regeneración del reporte ejecutivo diario y detección de anomalías (DAG usgs_daily_report_anomaly).
    Solo disponible para administradores.
    """
    airflow_endpoint = f"{settings.AIRFLOW_URL}/api/v1/dags/usgs_daily_report_anomaly/dagRuns"
    try:
        payload = {
            "conf": {
                "triggered_by": current_user.username
            }
        }
        res = requests.post(
            airflow_endpoint,
            json=payload,
            auth=(settings.AIRFLOW_USER, settings.AIRFLOW_PASSWORD),
            timeout=10
        )
        if res.status_code in (200, 201):
            run_data = res.json()
            return {
                "message": "Generación de reporte diario y análisis de anomalías activado.",
                "dag_run_id": run_data.get("dag_run_id"),
                "state": run_data.get("state")
            }
        else:
            logger.error("Airflow trigger failed with status %d: %s", res.status_code, res.text)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Fallo al disparar DAG en Airflow (status {res.status_code}): {res.text}"
            )
    except requests.exceptions.RequestException as e:
        logger.error("Airflow unreachable during trigger: %s", e)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Orquestador Airflow no disponible: {str(e)}"
        )
