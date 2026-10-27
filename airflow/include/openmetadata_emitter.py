"""
OpenMetadata Lineage and Quality Emitter for SismoWatch
Formats and exports lineage and test execution manifests compatible with OpenMetadata standard.
"""
import os
import json
import logging
from datetime import datetime

logger = logging.getLogger("airflow.task")

def generate_lineage_manifest(pipeline_name: str, execution_date: str) -> dict:
    """
    Builds a JSON payload adhering to the OpenMetadata Lineage Schema:
    Pipeline (Airflow) -> Upstream Tables -> Downstream Tables
    """
    manifest = {
        "service": {
            "name": "airflow_sismowatch",
            "type": "Airflow",
            "pipeline": pipeline_name
        },
        "executionDate": execution_date,
        "nodes": [
            {
                "id": "raw.usgs_events",
                "type": "table",
                "schema": "raw",
                "description": "Bronze layer: immutable append-only raw USGS feed"
            },
            {
                "id": "staging.events",
                "type": "table",
                "schema": "staging",
                "description": "Silver layer: clean and validated events"
            },
            {
                "id": "staging.quarantine",
                "type": "table",
                "schema": "staging",
                "description": "Silver layer: rejected events with validation failure reasons"
            },
            {
                "id": "curated.earthquakes",
                "type": "table",
                "schema": "curated",
                "description": "Gold layer: consolidated current state with derived metrics"
            }
        ],
        "edges": [
            {
                "fromEntity": "raw.usgs_events",
                "toEntity": "staging.events",
                "pipeline": "usgs_transform_quality",
                "description": "Pandera row-level validation filtering"
            },
            {
                "fromEntity": "raw.usgs_events",
                "toEntity": "staging.quarantine",
                "pipeline": "usgs_transform_quality",
                "description": "Routing of corrupted records to quarantine"
            },
            {
                "fromEntity": "staging.events",
                "toEntity": "curated.earthquakes",
                "pipeline": "usgs_transform_quality",
                "description": "Idempotent conditional upsert on event_id"
            }
        ],
        "emittedAt": datetime.utcnow().isoformat()
    }
    return manifest

def emit_lineage(pipeline_name: str, execution_date: str, output_path: str = "docs/lineage_manifest.json") -> dict:
    manifest = generate_lineage_manifest(pipeline_name, execution_date)
    om_url = os.getenv("OPENMETADATA_SERVER_URL")
    
    if om_url:
        try:
            import requests
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {os.getenv('OPENMETADATA_JWT_TOKEN', '')}"
            }
            res = requests.post(f"{om_url.rstrip('/')}/api/v1/lineage", json=manifest, headers=headers, timeout=5)
            logger.info("Lineage emitted to OpenMetadata server: %s", res.status_code)
        except Exception as e:
            logger.warning("Could not reach OpenMetadata server (%s), falling back to local export: %s", om_url, e)
            
    # Persist locally for audit and review
    try:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        logger.info("OpenMetadata lineage manifest persisted locally to %s", output_path)
    except Exception as e:
        logger.error("Failed to write lineage manifest to disk: %s", e)
        
    return manifest
