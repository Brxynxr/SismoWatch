"""
Unit Tests: API Endpoints, Authentication & RBAC Access Control
Tests FastAPI routes, token generation, viewer vs admin privileges, and SQL guardrail.
"""
import sys
import os
import pytest
from fastapi.testclient import TestClient

# Ensure api directory is in python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "api")))

from main import app
from config import settings
from services.ai_service import validate_sql_query

client = TestClient(app)

def test_health_check():
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert "SismoWatch" in data["app"]

def test_login_viewer_success():
    res = client.post("/auth/login", json={"username": settings.VIEWER_USERNAME, "password": settings.VIEWER_PASSWORD})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["role"] == "viewer"
    assert data["username"] == settings.VIEWER_USERNAME

def test_login_admin_success():
    res = client.post("/auth/login", json={"username": settings.ADMIN_USERNAME, "password": settings.ADMIN_PASSWORD})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["role"] == "admin"
    assert data["username"] == settings.ADMIN_USERNAME

def test_login_invalid_password():
    res = client.post("/auth/login", json={"username": settings.ADMIN_USERNAME, "password": "WrongPassword!"})
    assert res.status_code == 401
    assert "Credenciales incorrectas" in res.json()["detail"]

def test_unauthenticated_access_rejected():
    res = client.get("/api/kpis")
    assert res.status_code == 401

def test_viewer_can_access_kpis_and_events():
    # Login viewer
    login_res = client.post("/auth/login", json={"username": settings.VIEWER_USERNAME, "password": settings.VIEWER_PASSWORD})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # KPIs
    kpi_res = client.get("/api/kpis", headers=headers)
    assert kpi_res.status_code == 200
    data = kpi_res.json()
    assert "total_events_24h" in data
    assert "max_magnitude_24h" in data

    # Events
    ev_res = client.get("/api/events?page=1&page_size=5", headers=headers)
    assert ev_res.status_code == 200
    ev_data = ev_res.json()
    assert "items" in ev_data
    assert "total" in ev_data
    assert isinstance(ev_data["items"], list)

def test_viewer_is_forbidden_from_quarantine():
    """RBAC check: viewer role must get 403 Forbidden on quarantine endpoint."""
    login_res = client.post("/auth/login", json={"username": settings.VIEWER_USERNAME, "password": settings.VIEWER_PASSWORD})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/quality/quarantine", headers=headers)
    assert res.status_code == 403
    assert "Administrador" in res.json()["detail"]

def test_admin_can_access_quarantine():
    """RBAC check: admin role is allowed access to quarantine."""
    login_res = client.post("/auth/login", json={"username": settings.ADMIN_USERNAME, "password": settings.ADMIN_PASSWORD})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/quality/quarantine", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "total" in data
    assert "items" in data
    assert data["requested_by"] == settings.ADMIN_USERNAME

def test_reports_latest_and_export():
    login_res = client.post("/auth/login", json={"username": settings.VIEWER_USERNAME, "password": settings.VIEWER_PASSWORD})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Latest report
    res = client.get("/api/reports/latest", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "title" in data
    assert "summary" in data
    assert "total_events" in data

    # Export CSV
    export_res = client.get("/api/reports/export", headers=headers)
    assert export_res.status_code == 200
    assert "text/csv" in export_res.headers["content-type"]
    assert "event_id,event_time" in export_res.text

def test_sql_guardrail_validator():
    # Valid SELECT
    valid_query = "SELECT event_id, magnitude FROM curated.v_events_chat WHERE magnitude > 4.0 ORDER BY magnitude DESC LIMIT 5;"
    is_valid, _ = validate_sql_query(valid_query)
    assert is_valid is True

    # Forbidden DROP
    drop_query = "DROP TABLE curated.earthquakes;"
    is_valid, reason = validate_sql_query(drop_query)
    assert is_valid is False
    assert "SELECT" in reason or "prohibidas" in reason

    # Forbidden INSERT
    insert_query = "INSERT INTO curated.earthquakes VALUES ('hack', 0, 0);"
    is_valid, reason = validate_sql_query(insert_query)
    assert is_valid is False

    # Forbidden table
    raw_query = "SELECT * FROM raw.usgs_events;"
    is_valid, reason = validate_sql_query(raw_query)
    assert is_valid is False
    assert "v_events_chat" in reason

def test_stream_unauthenticated_rejected():
    """SSE stream must reject unauthenticated requests with 401."""
    res = client.get("/api/stream")
    assert res.status_code == 401
    assert "Token de acceso requerido" in res.json()["detail"]

    # Invalid token also rejected
    res_bad = client.get("/api/stream?token=invalid.token.payload")
    assert res_bad.status_code == 401

def test_pipeline_status_and_anomalies_endpoints():
    """Validates /api/pipeline/status and /api/anomalies return 200 with real schema."""
    login_res = client.post("/auth/login", json={"username": settings.VIEWER_USERNAME, "password": settings.VIEWER_PASSWORD})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Pipeline status
    status_res = client.get("/api/pipeline/status", headers=headers)
    assert status_res.status_code == 200
    st_data = status_res.json()
    assert "status" in st_data
    assert "latest_quality_score" in st_data
    assert "recent_quality_runs" in st_data

    # Anomalies
    anom_res = client.get("/api/anomalies", headers=headers)
    assert anom_res.status_code == 200
    assert isinstance(anom_res.json(), list)
