"""
DAG: usgs_ingest_feed
Description: Ingests near-real-time earthquake feed from USGS every 5 minutes into Bronze layer (raw.usgs_events).
"""
import os
import json
import logging
from datetime import datetime, timedelta
import requests
from airflow.decorators import dag, task
from airflow.datasets import Dataset
from include.callbacks import task_failure_alert
from include.db import insert_raw_events

logger = logging.getLogger("airflow.task")

USGS_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"
RAW_DATASET = Dataset("postgres://sismowatch-postgres:5432/sismowatch_db/raw/usgs_events")

DOC_MD = """
# USGS Ingestion Feed (Bronze Layer)

Este DAG consulta el catálogo en tiempo real del **USGS** cada 5 minutos.
* **Fuente Primaria:** `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson`
* **Destino:** `raw.usgs_events` (Schema Bronze)
* **Garantía de Idempotencia:** Append-only con `UNIQUE(event_id, payload_hash)` y `ON CONFLICT DO NOTHING`.
* **Resiliencia (Circuit Breaker):** Si la API pública no responde tras reintentos, conmuta al fixture de respaldo local.
* **Alerta:** Despacha alertas a webhook ante fallos mediante `on_failure_callback`.
* **Linaje:** Emite un evento sobre el Dataset `postgres://raw.usgs_events` para activar la transformación downstream.
"""

default_args = {
    "owner": "sismowatch",
    "depends_on_past": False,
    "retries": 3,
    "retry_delay": timedelta(seconds=15),
    "retry_exponential_backoff": True,
    "max_retry_delay": timedelta(minutes=2),
    "execution_timeout": timedelta(minutes=3),
    "on_failure_callback": task_failure_alert
}

@dag(
    dag_id="usgs_ingest_feed",
    default_args=default_args,
    description="Ingesta continua cada 5 minutos desde USGS hacia raw.usgs_events (Bronze)",
    schedule_interval="*/5 * * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["usgs", "ingestion", "bronze", "medallion"],
    doc_md=DOC_MD
)
def usgs_ingest_pipeline():

    @task(outlets=[RAW_DATASET])
    def fetch_and_store_usgs_feed() -> int:
        events = []
        source_feed = "all_hour.geojson"
        
        try:
            logger.info("Connecting to USGS Realtime Feed: %s", USGS_FEED_URL)
            response = requests.get(USGS_FEED_URL, timeout=10)
            response.raise_for_status()
            data = response.json()
            events = data.get("features", [])
            logger.info("Fetched %d features directly from USGS API.", len(events))
        except Exception as err:
            logger.warning("USGS Public API unavailable or rate-limited: %s. Activating Circuit Breaker fallback...", err)
            # Circuit breaker fallback to local validated fixture
            fixture_path = os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "sample_usgs_feed.json")
            if not os.path.exists(fixture_path):
                fixture_path = "/opt/airflow/tests/fixtures/sample_usgs_feed.json"
                
            if os.path.exists(fixture_path):
                with open(fixture_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    events = data.get("features", [])
                source_feed = "fallback_fixture.json"
                logger.info("Circuit Breaker activated: Loaded %d events from local backup fixture.", len(events))
            else:
                raise RuntimeError(f"USGS API failed and backup fixture not found: {err}")

        # Ingestion into Bronze layer (append-only)
        inserted_count = insert_raw_events(events, source_feed=source_feed)
        logger.info("Ingestion completed: %d raw events processed.", inserted_count)
        return inserted_count

    fetch_and_store_usgs_feed()

usgs_ingest_dag = usgs_ingest_pipeline()
