"""
DAG: usgs_transform_quality
Description: Validates data quality in two levels (Pandera), routes corrupted data to quarantine,
and applies conditional upsert into Gold (curated.earthquakes).
"""
import os
import logging
from datetime import datetime, timedelta
from airflow.decorators import dag, task, task_group
from airflow.datasets import Dataset
from include.callbacks import task_failure_alert
from include.db import fetch_latest_raw_events, save_staging_and_curated
from include.transform import parse_geojson_feature
from include.quality import validate_batch_level, validate_rows_and_quarantine, BatchQualityError
from include.openmetadata_emitter import emit_lineage

logger = logging.getLogger("airflow.task")

RAW_DATASET = Dataset("postgres://sismowatch-postgres:5432/sismowatch_db/raw/usgs_events")

DOC_MD = """
# USGS Transformation & Data Quality Pipeline (Silver & Gold Layers)

Este DAG es activado automáticamente cuando la ingesta en Bronze (`raw.usgs_events`) publica nuevos eventos.

### Estrategia de Calidad y Linaje:
1. **Nivel Lote (Bloqueante):** Verifica volumen anómalo, estructura GeoJSON y frescura. Si falla, el DAG se detiene y nada pasa a Curated.
2. **Transformación:** Normaliza tipos, extrae `region`, clasifica `magnitude_class` y calcula el `impact_radius_km`.
3. **Nivel Fila (Pandera lazy=True):** Separa registros conformes de los que violan restricciones de coordenadas, fechas o rangos.
4. **Capa Silver:**
   * Registros limpios van a `staging.events`.
   * Registros corruptos van a `staging.quarantine` con sus `failed_rules` y `rejection_reason`.
5. **Capa Gold:**
   * Upsert condicional en `curated.earthquakes` (solo actualiza si `updated_time` es más reciente).
   * Persistencia de métricas en `curated.quality_runs`.
6. **OpenMetadata:** Emite el manifiesto de linaje conforme al estándar de gobierno.
"""

default_args = {
    "owner": "sismowatch",
    "depends_on_past": False,
    "retries": 2,
    "retry_delay": timedelta(seconds=10),
    "execution_timeout": timedelta(minutes=5),
    "on_failure_callback": task_failure_alert
}

@dag(
    dag_id="usgs_transform_quality",
    default_args=default_args,
    description="Transformación Pandera en 2 niveles, cuarentena y upsert en Curated (Gold)",
    schedule=[RAW_DATASET],  # Se dispara reactivamente ante eventos en Bronze
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["usgs", "transformation", "silver", "gold", "quality", "medallion"],
    doc_md=DOC_MD
)
def usgs_transformation_pipeline():

    @task
    def prepare_batch_manifest() -> dict:
        """Emits lightweight batch parameters to avoid passing large dataframes over XCom."""
        return {
            "batch_limit": 500,
            "initiated_at": datetime.utcnow().isoformat()
        }

    @task_group(group_id="quality_and_transformation")
    def transform_and_validate_group(manifest: dict):

        @task
        def process_and_publish_quality(manifest_info: dict, **context) -> dict:
            batch_limit = manifest_info.get("batch_limit", 500)
            items = fetch_latest_raw_events(limit=batch_limit)
            if not items:
                logger.info("No raw items to process. Exiting task.")
                return {"processed": 0, "quarantined": 0}

            # 1. Level 1 Validation: Batch level with authentic feed timestamps
            raw_features = [item["payload"] for item in items]
            feed_times = [
                item["payload"].get("properties", {}).get("time")
                for item in items
                if item.get("payload", {}).get("properties", {}).get("time")
            ]
            real_generated = max(feed_times) if feed_times else int(datetime.utcnow().timestamp() * 1000)
            batch_envelope = {
                "type": "FeatureCollection",
                "features": raw_features,
                "metadata": {"generated": real_generated}
            }
            validate_batch_level(batch_envelope)

            # 2. Parse GeoJSON features into typed staging records
            raw_id_map = {item["event_id"]: item["raw_id"] for item in items}
            transformed_records = []
            for item in items:
                parsed = parse_geojson_feature(item["payload"])
                transformed_records.append(parsed)

            # 3. Level 2 Validation: Row level with Pandera (lazy=True)
            valid_records, quarantined_records, metrics = validate_rows_and_quarantine(
                transformed_records,
                raw_id_map=raw_id_map
            )

            # 4. Save into Staging, Curated and Quality Runs (PostgreSQL Hot Tier)
            run_id = context.get("run_id", f"manual_{datetime.utcnow().isoformat()}")
            save_staging_and_curated(valid_records, quarantined_records, metrics, execution_id=run_id)

            # 5. Cold-tier export to MinIO Lakehouse (Silver & Gold Parquet, resilient non-blocking)
            try:
                from include.minio_exporter import export_silver_parquet, export_gold_parquet
                export_silver_parquet(valid_records, quarantined_records)
                export_gold_parquet(valid_records)
            except Exception as minio_err:
                logger.warning("MinIO Silver/Gold Parquet export failed (non-blocking fallback): %s", minio_err)

            # 6. Emit OpenMetadata lineage manifest
            emit_lineage("usgs_transform_quality", str(datetime.utcnow()))

            logger.info("Successfully processed batch: %d valid published to Gold, %d quarantined.",
                        len(valid_records), len(quarantined_records))

            return {
                "total_evaluated": metrics["total_evaluated"],
                "total_passed": metrics["total_passed"],
                "total_quarantined": metrics["total_quarantined"],
                "quality_score": metrics["quality_score"]
            }

        process_and_publish_quality(manifest_info=manifest)

    batch_manifest = prepare_batch_manifest()
    transform_and_validate_group(batch_manifest)

usgs_transform_dag = usgs_transformation_pipeline()
