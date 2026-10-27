"""
DAG: usgs_historical_backfill
Description: Parameterized manual execution that loads historical earthquake data (e.g. past 30 days)
from the USGS query endpoint without duplicating existing records.
"""
import logging
from datetime import datetime, timedelta, timezone
import requests
from airflow.decorators import dag, task
from airflow.models.param import Param
from include.callbacks import task_failure_alert
from include.db import insert_raw_events, fetch_latest_raw_events, save_staging_and_curated
from include.transform import parse_geojson_feature
from include.quality import validate_rows_and_quarantine

logger = logging.getLogger("airflow.task")

USGS_QUERY_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"

DOC_MD = """
# USGS Historical Backfill (Parametrizado & Idempotente)

Permite recuperar y cargar el catálogo histórico del **USGS** para los últimos 30 días (o el intervalo configurado).

### Parámetros Configurables:
* `days_back`: Días hacia atrás a consultar (Default: `30`).
* `min_magnitude`: Magnitud mínima a filtrar (Default: `2.5` para evitar saturación de micro-sismos).

### Garantía de Idempotencia:
* En **Bronze**: `UNIQUE(event_id, payload_hash)` y `ON CONFLICT DO NOTHING`.
* En **Gold**: Cláusula `ON CONFLICT (event_id) DO UPDATE` condicional por `updated_time`.
* Ejecutar este DAG dos veces sobre el mismo rango de fechas produce exactamente el mismo resultado sin duplicar registros.
"""

default_args = {
    "owner": "sismowatch",
    "depends_on_past": False,
    "retries": 2,
    "retry_delay": timedelta(seconds=20),
    "execution_timeout": timedelta(minutes=15),
    "on_failure_callback": task_failure_alert
}

@dag(
    dag_id="usgs_historical_backfill",
    default_args=default_args,
    description="Carga histórica parametrizada de 30 días desde USGS query API (Idempotente)",
    schedule=None,  # Solo ejecución manual o vía API REST de Airflow
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    params={
        "days_back": Param(30, type="integer", minimum=1, maximum=90, description="Días hacia atrás a consultar"),
        "min_magnitude": Param(2.5, type="number", minimum=1.0, maximum=9.0, description="Magnitud mínima a extraer")
    },
    tags=["usgs", "backfill", "historical", "admin", "medallion"],
    doc_md=DOC_MD
)
def usgs_backfill_pipeline():

    @task
    def extract_and_ingest_historical(**context) -> dict:
        params = context["params"]
        days_back = int(params["days_back"])
        min_mag = float(params["min_magnitude"])

        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days_back)

        start_str = start_date.strftime("%Y-%m-%d")
        end_str = end_date.strftime("%Y-%m-%d")

        query_params = {
            "format": "geojson",
            "starttime": start_str,
            "endtime": end_str,
            "minmagnitude": min_mag,
            "orderby": "time-asc"
        }

        logger.info("Querying USGS Historical Catalog from %s to %s (min mag: %.1f)...",
                    start_str, end_str, min_mag)

        response = requests.get(USGS_QUERY_URL, params=query_params, timeout=60)
        response.raise_for_status()
        geojson_data = response.json()

        features = geojson_data.get("features", [])
        total_found = len(features)
        logger.info("Retrieved %d historical events from USGS.", total_found)

        # Ingestion into Bronze layer (idempotent ON CONFLICT DO NOTHING)
        inserted = insert_raw_events(features, source_feed=f"backfill_{start_str}_{end_str}")

        return {
            "total_found": total_found,
            "raw_inserted": inserted,
            "start_date": start_str,
            "end_date": end_str
        }

    @task
    def process_and_load_historical(ingest_summary: dict, **context) -> dict:
        total_found = ingest_summary.get("total_found", 0)
        if total_found == 0:
            return {"processed": 0}

        # Fetch the historical records from raw
        items = fetch_latest_raw_events(limit=max(500, total_found))
        raw_id_map = {item["event_id"]: item["raw_id"] for item in items}

        transformed = []
        for item in items:
            transformed.append(parse_geojson_feature(item["payload"]))

        valid_records, quarantined_records, metrics = validate_rows_and_quarantine(
            transformed,
            raw_id_map=raw_id_map
        )

        run_id = f"backfill_{context.get('run_id', datetime.utcnow().isoformat())}"
        save_staging_and_curated(valid_records, quarantined_records, metrics, execution_id=run_id)

        logger.info("Historical backfill completed: %d valid loaded to Gold, %d quarantined.",
                    len(valid_records), len(quarantined_records))

        return {
            "total_processed": metrics["total_evaluated"],
            "gold_loaded": metrics["total_passed"],
            "quarantined": metrics["total_quarantined"],
            "quality_score": metrics["quality_score"]
        }

    ingest_meta = extract_and_ingest_historical()
    process_and_load_historical(ingest_meta)

usgs_backfill_dag = usgs_backfill_pipeline()
