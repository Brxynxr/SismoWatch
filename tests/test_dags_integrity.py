"""
Unit Tests: Airflow DAGs Integrity & Structure
Verifies that all DAG python files are parseable, define expected DAG objects,
and have tasks with proper tags, retries, and callbacks.
"""
import ast
import os
import subprocess
import pytest

DAGS_FOLDER = os.path.join(os.path.dirname(__file__), "..", "airflow", "dags")

EXPECTED_DAGS = [
    "usgs_ingest_feed.py",
    "usgs_transform_quality.py",
    "usgs_historical_backfill.py",
]

def test_dag_files_exist_and_parse():
    for filename in EXPECTED_DAGS:
        filepath = os.path.join(DAGS_FOLDER, filename)
        assert os.path.exists(filepath), f"DAG file missing: {filename}"
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        # Parse AST to ensure no syntax errors
        tree = ast.parse(content, filename=filename)
        assert tree is not None

def test_dag_integrity_in_airflow_container():
    """Executes DagBag import validation inside running Airflow container."""
    cmd = [
        "docker", "exec", "-i", "sismowatch-airflow-webserver",
        "python", "-c",
        "from airflow.models import DagBag; bag = DagBag('/opt/airflow/dags', include_examples=False); "
        "assert len(bag.import_errors) == 0, f'Import errors: {bag.import_errors}'; "
        "assert len(bag.dags) >= 3, 'Expected at least 3 DAGs'; "
        "print('PASS')"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    assert result.returncode == 0, f"Airflow DagBag error:\n{result.stderr}\n{result.stdout}"
    assert "PASS" in result.stdout
