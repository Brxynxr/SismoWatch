# SismoWatch - Integración y Especificación con OpenMetadata

## 1. Propósito y Alcance de OpenMetadata en SismoWatch
**OpenMetadata** es la plataforma de gobernanza, catálogo de datos y linaje de código abierto líder en la industria. En **SismoWatch**, su propósito es proporcionar:
1. **Catálogo Unificado:** Indexación y documentación de las tres capas Medallion (`raw`, `staging`, `curated`).
2. **Linaje de Datos de Extremo a Extremo (Column-Level & Table-Level Lineage):** Visualización de la trayectoria del dato desde la API externa del USGS hasta las vistas de consumo de la API y el Chat de IA.
3. **Gobierno de Calidad:** Registro de reglas de validación (Pandera) y métricas de frescura/volumen mapeadas al estándar de Data Quality de OpenMetadata.

---

## 2. Grafo de Linaje de Datos en OpenMetadata

```
[USGS Pipeline Service] (Pipeline: usgs_ingest_feed)
         │
         ▼
[Postgres Database Service: sismowatch_db]
 └── Schema: raw
      └── Table: usgs_events (Bronze)
               │
               ▼ (Pipeline: usgs_transform_quality)
 └── Schema: staging
      ├── Table: events (Silver Clean)
      └── Table: quarantine (Silver Quarantine)
               │
               ▼ (Upsert condicional & Enriquecimiento)
 └── Schema: curated
      ├── Table: earthquakes (Gold)
      ├── Table: quality_runs (Data Quality Metrics)
      ├── Table: ai_reports (Executive Summaries)
      ├── Table: anomalies (Z-Score Outliers)
      ├── Table: ai_runs (Unified AI Audits)
      │
      ├── Views de Consumo:
      │    ├── v_kpis_24h ─────────► [FastAPI /api/kpis] ──► [Dashboard UI]
      │    ├── v_hourly_counts ────► [FastAPI /api/stats] ─► [Timeseries UI]
      │    ├── v_quarantine ───────► [FastAPI Admin API] ──► [Quarantine UI]
      │    └── v_events_chat ──────► [Ollama Chat Agent] ──► [Chat Interface]
```

---

## 3. Especificación de Entidades y Metadatos

### A. Servicio de Base de Datos (`DatabaseService`)
* **Nombre:** `postgres_sismowatch`
* **Tipo:** `Postgres`
* **Host:** `postgres:5432`
* **Base de datos:** `sismowatch_db`

### B. Capas y Tablas Catalogadas
1. **`raw.usgs_events` (Bronze Layer):**
   * *Descripción:* Almacenamiento append-only inmutable de respuestas crudas GeoJSON de la API de USGS.
   * *Clasificación/Tags:* `Tier.Tier1`, `DataGov.RawData`, `Source.PublicAPI`.
   * *Columnas críticas:* `event_id`, `payload` (JSONB), `payload_hash` (SHA256).

2. **`staging.events` (Silver Layer):**
   * *Descripción:* Datos normalizados, tipados y filtrados. Solo contiene eventos validados por Pandera.
   * *Clasificación/Tags:* `Tier.Tier2`, `DataGov.SilverClean`.

3. **`staging.quarantine` (Silver Quarantine):**
   * *Descripción:* Registros con fallos de esquema, lat/lon fuera de rango o fechas incoherentes.
   * *Columnas críticas:* `failed_rules`, `rejection_reason`, `payload`.

4. **`curated.earthquakes` (Gold Layer):**
   * *Descripción:* Estado actual consolidado de sismos con columnas derivadas (`region`, `magnitude_class`, `impact_radius_km`).
   * *Clasificación/Tags:* `Tier.Tier1`, `DataGov.GoldCurated`, `PII.None`.

---

## 4. Mapeo de Data Quality Tests a OpenMetadata

Las reglas evaluadas por **Pandera** en Airflow se homologan directamente a las especificaciones de OpenMetadata Test Suites:

| Regla de Calidad Pandera | OpenMetadata Test Definition | Criterio de Aceptación |
| :--- | :--- | :--- |
| `latitude.between(-90, 90)` | `columnValueMax` / `columnValueMin` | $[-90.0, 90.0]$ |
| `longitude.between(-180, 180)` | `columnValueMax` / `columnValueMin` | $[-180.0, 180.0]$ |
| `magnitude.between(0, 10)` | `columnValuesToBeBetween` | $[0.0, 10.0]$ |
| `event_id.is_unique` | `columnValuesToBeUnique` | 100% único |
| `freshness_latency_seconds` | `tableCustomMetric` | $< 600$ segundos |

---

## 5. Emisor de Linaje y Metadatos (`OpenMetadata Lineage Emitter`)

Para garantizar que el proyecto cumpla con el estándar de OpenMetadata **sin sobrecargar la memoria del entorno local** (evitando levantar los contenedores de OpenSearch y Dropwizard que requieren > 4 GB de RAM adicionales):

1. **Módulo Emitter (`airflow/include/openmetadata_emitter.py`):**
   * Genera el manifiesto estándar de linaje y metadatos en formato JSON conforme a la especificación de OpenMetadata v1.4+.
   * Si la variable de entorno `OPENMETADATA_SERVER_URL` está configurada, realiza un POST automático hacia el endpoint `/api/v1/lineage` y `/api/v1/dataQuality/testCases`.
   * En modo local/evaluación, persiste el manifiesto en `curated.openmetadata_manifests` y en disco en `docs/lineage_manifest.json`, permitiendo auditoría y visualización instantánea.

---

## 6. Arquitectura de Despliegue en Producción (Escala Empresarial)

En un entorno productivo con clúster Kubernetes (EKS / GKE):
* Se despliega el operador de OpenMetadata mediante Helm Charts.
* Airflow utiliza el provider `openmetadata-managed-apis` o `openmetadata-airflow-lineage`.
* En cada ejecución de DAG, el backend de linaje envía automáticamente las entidades `Inlets` y `Outlets` de Airflow hacia el catálogo centralizado.
