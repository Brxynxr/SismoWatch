# SismoWatch - Contexto Integral del Proyecto para Agentes Colaboradores

**Documento de Inducción Técnica y Estado del Proyecto**  
**Fecha:** 27 de Octubre de 2026 | **Deadline de Entrega:** 13:59 (Meta de código: 13:00)

---

## 1. Visión General del Proyecto
**SismoWatch** convierte el feed público del **USGS (United States Geological Survey)** (`all_hour.geojson` y API histórica) en un producto de datos analítico y en tiempo casi real para SuperApp.

### Problema que resuelve:
* El feed público de USGS no tiene historial consolidado, no aplica validación de calidad y puede emitir actualizaciones posteriores de sismos pasados.
* SismoWatch ingesta cada 5 minutos en Bronze, valida en Silver con Pandera (cuarentena de filas inválidas), consolida en Gold con upserts idempotentes, genera reportes y anomalías con IA local (Ollama) y sirve un dashboard con tiempo real (SSE) y chat asistido.

---

## 2. Estado Actual de Implementación (Fase 1 Completada)

* **Infraestructura Activa:**
  * `sismowatch-postgres` (Postgres 16, puerto 5432, bases de datos `sismowatch_db` y `airflow_db`).
  * `sismowatch-airflow-webserver` (Airflow 2.10, puerto 8080, health endpoint 200 OK).
  * `sismowatch-airflow-scheduler` (Airflow Scheduler, estado healthy).
  * Ollama corriendo en el host en puerto 11434 (`phi3:latest` 2.2GB disponible).
* **Base de Datos y Schemas Creados:**
  * `raw.usgs_events`: Ingesta append-only con `UNIQUE(event_id, payload_hash)`.
  * `staging.events`: Eventos normalizados y tipados.
  * `staging.quarantine`: Eventos rechazados con `failed_rules`, `rejection_reason` y payload original.
  * `curated.earthquakes`: Estado actual con columnas derivadas `region` y `magnitude_class`.
  * `curated.quality_runs`: Métricas de lote/fila y frescura.
  * `curated.ai_reports`: Resúmenes ejecutivos diarios.
  * `curated.anomalies`: Detecciones estadísticas (Z-score).
  * `curated.ai_runs`: Tabla unificada de auditoría de IA (reportes, anomalías, chat).
* **Vistas de Consumo Disponibles:**
  * `curated.v_kpis_24h`
  * `curated.v_hourly_counts`
  * `curated.v_region_activity`
  * `curated.v_magnitude_distribution`
  * `curated.v_quarantine` (expone staging.quarantine para administradores)
  * `curated.v_events_chat` (columnas restringidas para el asistente LLM)
* **Seguridad y Permisos:**
  * Roles configurados: `role_ingestion`, `role_transformation`, `role_api_reader`, `role_chat_reader` (solo lectura forzada, timeout 3s) y `role_api_logger`.
  * Suite de 13 pruebas unitarias de permisos pasando al 100% (`tests/test_roles_permissions.py`).

---

## 3. Próximas Fases de Construcción

* **Fase 2:** Pipeline de Datos en Airflow:
  * `usgs_ingest_feed.py`: Ingesta cada 5 min a `raw.usgs_events`.
  * `usgs_transform_quality.py`: Transformación Pandera (lote bloqueante, fila a cuarentena, upsert a curated).
  * `usgs_historical_backfill.py`: Carga histórica parametrizada de 30 días.
* **Fase 3:** Backend FastAPI:
  * Autenticación JWT (`admin` y `viewer` en memoria con bcrypt).
  * Endpoints REST sobre vistas de Gold.
  * Stream SSE (`/api/stream`) consultando la BD cada 5-10s.
  * Disparadores hacia la API REST de Airflow para Backfill y Regenerar Reporte.
* **Fase 4:** Frontend React + Vite:
  * Dashboard con KPIs, mapa Leaflet y gráficos Recharts.
  * Lector de stream SSE con badge "EN VIVO" y reconexión automática.
  * Panel de cuarentena para rol `admin`.
* **Fase 5:** Módulos de IA:
  * DAG diario de reporte ejecutivo con cifras fijas y validación.
  * Detección de anomalías Z-Score en `airflow/include/anomaly.py`.
* **Fase 6:** Agente Conversacional Local:
  * Endpoint `/api/chat` con streaming fetch.
  * Generación de SQL de solo lectura validado con AST sobre `v_events_chat`.
  * Guardrail numérico anti-alucinaciones y auditoría en `curated.ai_runs`.

---

## 4. Comandos de Operación Habitual

```bash
# Levantar o verificar servicios Docker
docker compose ps
docker compose logs -f sismowatch-airflow-webserver

# Correr pruebas unitarias
source .venv/bin/activate
pytest tests/ -v

# Verificar que no haya secretos
~/.local/bin/gitleaks protect -v --staged

# Consultar base de datos
docker exec -it sismowatch-postgres psql -U postgres -d sismowatch_db
```
