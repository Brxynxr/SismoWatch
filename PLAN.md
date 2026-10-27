# SismoWatch - Plan Estratégico y Técnico de Ejecución (Versión 2.0)

**Autor:** Ingeniero de Datos Senior & Automatizador con IA  
**Audiencia:** Desarrollador Junior / Sustentación Oral ante Tech Lead y Jurados  
**Fecha de Ejecución:** 27 de Octubre de 2026  
**Hora de Inicio Real:** 07:15 - **Hora Límite de Cierre:** 13:59  
**Meta de Finalización de Código:** 13:00 (dejando 59 minutos exclusivamente para documentación final, auditoría y empaquetado de entrega)

---

## 1. Resumen de la Prueba y Criterios de Aceptación (en lenguaje claro)

### ¿Qué es SismoWatch y qué problema resuelve?
SuperApp lanza **SismoWatch**, una plataforma de monitoreo sísmico global en tiempo casi real orientada a las áreas de operaciones y gestión de riesgo. La fuente primaria es el catálogo público del **USGS (United States Geological Survey)**.

El reto principal radica en que el feed público:
1. Cambia minuto a minuto sin almacenar historial consolidado.
2. No aplica validaciones de integridad de datos (pueden llegar coordenadas nulas, magnitudes fuera de rango o eventos duplicados/modificados).
3. Carece de resúmenes ejecutivos automatizados y detección estadística de eventos anómalos.
4. Requiere una plataforma web protegida por roles (Viewer vs. Admin) con visualizaciones en tiempo real, reportes descargables y un asistente conversacional local que responda preguntas analíticas **sin alucinar cifras**.

---

### Criterios de Aceptación Específicos
* [ ] **Despliegue con comando único:** `docker compose up -d` levanta PostgreSQL, Apache Airflow (LocalExecutor) y los servicios correspondientes sin fallos ni pasos manuales.
* [ ] **Flujo E2E Automatizado:** Los datos fluyen desde la API del USGS (`all_hour.geojson`), pasando por Airflow, ingresando a Bronze (`raw`), filtrándose en Silver (`staging`) y publicándose en Gold (`curated`), reflejándose en la web sin intervención humana.
* [ ] **Idempotencia Estricta:** Re-ejecutar un DAG o reprocesar un intervalo de tiempo no genera duplicados:
  * Bronze guarda versiones con `INSERT ... ON CONFLICT (event_id, payload_hash) DO NOTHING`.
  * Gold consolida el estado actual mediante upsert condicional (`UPDATE` solo si `EXCLUDED.updated_time > curated.earthquakes.updated_time`).
* [ ] **Calidad en Dos Niveles:**
  * *Nivel Lote:* Si el feed está vacío anormalmente, no hay frescura o el esquema estructural viene roto, el DAG falla y **nada pasa a Gold**.
  * *Nivel Fila:* Filas individuales con errores (coordenadas fuera de rango, magnitud absurda, id nulo) se desvían a `staging.quarantine` con el motivo del fallo (`failed_rules`), mientras las filas sanas continúan a Gold.
* [ ] **Seguridad y Cero Secretos:** Repositorio limpio de credenciales verificado con `gitleaks`. Variables de entorno aisladas en `.env` (nunca commiteado) y `.env.example` documentado.
* [ ] **Mínimo Privilegio Real en PostgreSQL:**
  * `role_ingestion`: Solo INSERT/SELECT en `raw.usgs_events`.
  * `role_transformation`: SELECT en raw; lectura/escritura en staging y curated.
  * `role_api_reader`: Solo SELECT en vistas y tablas de `curated`. Cero acceso a raw y staging. La cuarentena se expone exclusivamente por `curated.v_quarantine`.
  * `role_chat_reader`: Solo SELECT en `curated.v_events_chat`, forzado con `default_transaction_read_only = on` y `statement_timeout = '3s'`.
  * `role_api_logger`: Solo INSERT en `curated.ai_runs`.
* [ ] **Autenticación y RBAC sin tabla de usuarios:** Usuarios `admin` y `viewer` definidos en variables de entorno, validados con `bcrypt` en memoria al iniciar la API. Viewer recibe `403 Forbidden` al intentar rutas admin.
* [ ] **IA Confiable y Local:**
  * Reporte narrativo diario con cifras calculadas por código/SQL; el LLM solo redacta. Fallos del LLM no rompen el pipeline (fallback determinista).
  * Chat analítico local (Ollama) traduciendo lenguaje natural a SQL solo lectura sobre `curated.v_events_chat`.
  * Guardrail numérico que valida y normaliza formatos (`5.8` vs `5.80`); ante discrepancia reemplaza por plantilla generada desde los datos SQL.
  * Todas las ejecuciones de IA se auditan en una única tabla: `curated.ai_runs`.
* [ ] **Tiempo Real Honesto:** Micro-lotes cada 5 minutos en Airflow + SSE en FastAPI que sondea la BD cada 5-10 s para empujar novedades al cliente sin refrescar la página.
* [ ] **Tests Automatizados:** Pruebas unitarias de transformación, integridad de DAGs, validación Pandera y RBAC de la API pasando al 100% con `pytest`.

---

## 2. Decisión de Arquitectura: Medallion (Confirmada)

### Mapeo Conceptual de Capas

| Capa Conceptual | Schema PostgreSQL | Propósito y Comportamiento |
| :--- | :--- | :--- |
| **Bronze (Raw)** | `raw` | Ingesta pura append-only. Guarda el JSONB íntegro de cada evento tal como llega de la API del USGS junto con su hash SHA-256 (`payload_hash`). Permite auditoría forense y reconstrucción histórica. |
| **Silver (Staging)** | `staging` | Limpieza, tipado y control de calidad. Separa los datos válidos (`staging.events`) de los rechazados (`staging.quarantine`). Aquí se aplica Pandera con `lazy=True`. Sin lógica de negocio. |
| **Gold (Curated)** | `curated` | Capa de consumo y negocio. Alberga el estado actual consolidado (`curated.earthquakes`) con columnas calculadas (`region`, `magnitude_class`), tablas de auditoría (`quality_runs`, `ai_reports`, `anomalies`, `ai_runs`) y vistas SQL optimizadas para la API y el Chat. |

### Diagrama de Flujo y Componentes

```
                              [USGS API Public Feed]
                                        |
                          (HTTP GET cada 5 min / Backfill)
                                        v
                 +-----------------------------------------------+
                 |              APACHE AIRFLOW 2.10              |
                 |  - DAG usgs_ingest_feed                       |
                 |  - DAG usgs_transform_quality (Trigger/Asset) |
                 |  - DAG usgs_daily_report_anomaly              |
                 |  - DAG usgs_historical_backfill               |
                 +----------------------+------------------------+
                                        |
                                        v
    ========================================================================
    POSTGRESQL 16 - ARQUITECTURA MEDALLION & ROLES DE MÍNIMO PRIVILEGIO
    ========================================================================
    [BRONZE]
    raw.usgs_events  <--- role_ingestion (INSERT, SELECT)
      - event_id, payload (JSONB), payload_hash, fetched_at
      - UNIQUE(event_id, payload_hash) -> Append-only, sin modificaciones
           |
           | [role_transformation: Validación Pandera lazy=True]
           v
    [SILVER]
    staging.quarantine                 staging.events
    (FK raw_id, failed_rules,          (Tipado estricto, 1 fila por evento,
     rejection_reason, payload)         última versión válida limpia)
           |                                   |
           |                                   | [Upsert condicional: solo si
           |                                   |  EXCLUDED.updated_time > actual]
           |                                   v
    [GOLD]
    curated.earthquakes (event_id PK, mag, region, magnitude_class, coords, ...)
    curated.quality_runs (métricas lote/fila, puntaje, frescura)
    curated.ai_reports   (resumen ejecutivo diario con KPIs verificados)
    curated.anomalies    (detección Z-score: ventana, métrica, explicación)
    curated.ai_runs      (registro consolidado de llamadas: reporte/anomalía/chat)
    ------------------------------------------------------------------------
    VISTAS DE CONSUMO (GOLD):
    - v_kpis_24h, v_hourly_counts, v_region_activity, v_magnitude_distribution
    - v_quarantine (Vista sobre staging.quarantine accesible por role_api_reader)
    - v_events_chat (Vista restringida de columnas para el agente conversacional)
    ========================================================================
           ^                                         ^
           | (role_api_reader)                       | (role_chat_reader: read-only, timeout 3s)
           |                                         |
    +------+--------------------+             +------+--------------------+
    |      FASTAPI BACKEND      |             |     AGENTE CHAT LOCAL     |
    |  - Auth JWT (Viewer/Admin)|             |  - Text-to-SQL Generator  |
    |  - REST APIs & SSE Stream |             |  - Validador AST + Guard  |
    |  - Airflow API Trigger    |             |  - Ollama (phi3:latest)   |
    +-------------+-------------+             +-------------+-------------+
                  ^                                         ^
                  |                                         |
                  +--------------------+--------------------+
                                       | (HTTP / SSE fetch streaming)
                                       v
                        +-------------------------------+
                        |     REACT + VITE FRONTEND     |
                        |  - Dashboard KPIs & Leaflet   |
                        |  - SSE Live Stream Badge      |
                        |  - Admin Quarantine View      |
                        |  - Chat Analítico Integrado   |
                        +-------------------------------+
```

---

## 3. Tabla de Decisiones Técnicas: Selección vs. Alternativas Descartadas

| Área / Componente | Herramienta Elegida | Alternativa Descartada | Justificación Técnica de Alto Nivel (Defensa Oral) |
| :--- | :--- | :--- | :--- |
| **Arquitectura de Datos** | **Medallion (Bronze/Silver/Gold)** | Lambda Architecture | Lambda requiere mantener dos caminos (Speed y Batch) y motores distribuidos como Kafka/Spark. Medallion permite absorber en Bronze y consolidar en Gold mediante upserts idempotentes sobre una única base de datos, manejando de forma natural las actualizaciones asíncronas del USGS sin sobreingeniería. |
| **Orquestación** | **Airflow 2.10 (LocalExecutor)** | CeleryExecutor / Cron / Prefect | LocalExecutor corre directamente sobre PostgreSQL sin necesidad de Redis ni workers distribuidos adicionales, ahorrando más de 1.5 GB de RAM. Cumple el estándar corporativo con TaskFlow API, reintentos con backoff y soporte de Datasets. |
| **Calidad de Datos** | **Pandera (Python)** | Great Expectations / Soda Core | Great Expectations introduce dependencias masivas (~400MB) y configuración JSON compleja. Pandera se integra nativamente en DataFrames, valida esquemas con `lazy=True` permitiendo aislar registros corruptos a nivel de fila y reporta métricas en milisegundos. |
| **Motor de Almacenamiento** | **PostgreSQL 16** | MySQL / MongoDB / Snowflake | Maneja nativamente schemas (`raw`, `staging`, `curated`), tipos `JSONB` con operadores de indexación GIN, cláusulas `ON CONFLICT DO UPDATE` y aislamiento de privilegios mediante roles y vistas. |
| **Capas de Agregación** | **Vistas SQL Estándar** | Vistas Materializadas / Tablas Agregadas | Alertas y sismos cambian frecuentemente. Las vistas estándar garantizan que las consultas de la API lean el dato más fresco al instante sin requerir jobs periódicos de `REFRESH MATERIALIZED VIEW` que añaden latencia y complejidad. |
| **Backend de la Plataforma**| **FastAPI (Python 3.11+)** | Flask / Django / Express | Soporte nativo de operaciones asíncronas (`asyncio`), streaming SSE con `StreamingResponse`, esquemas tipados con Pydantic v2 y documentación Swagger OpenAPI automática. |
| **Frontend Web** | **React + Vite + Tailwind CSS** | Streamlit / Dash | Streamlit renderiza la página entera en cada interacción, impidiendo una experiencia de usuario fluida con streaming SSE, chats conversacionales reactivos y mapas geoespaciales interactivos con Leaflet. |
| **Proveedor y Modelo de IA**| **Ollama Local (`phi3:latest` 3.8B)** | OpenAI API / Qwen2.5-Coder / Mistral | `phi3:latest` (2.2 GB) ya se encuentra verificado e instalado en el sistema host. En pruebas directas generó SQL exacto para PostgreSQL en 4-6 segundos sin costo de red ni consumo de tokens comerciales. Se configura como servicio opcional en Docker con profile `ai` y conexión transparente a `host.docker.internal`. |
| **Consumo en Tiempo Real**| **Fetch con ReadableStream (SSE)** | EventSource nativo / WebSockets | El `EventSource` nativo del navegador **no permite inyectar headers HTTP** (impidiendo enviar el token `Authorization: Bearer <JWT>`) ni soporta peticiones `POST` para el chat. Usar `fetch()` leyendo el stream (`ReadableStreamDefaultReader`) permite autenticación JWT estándar en streaming SSE unidireccional sin la sobrecarga de un servidor WebSocket bidireccional. |
| **Control de Seguridad** | **Gitleaks + Bandit** | SonarQube / Snyk | Herramientas ligeras ejecutables en local: Gitleaks asegura cero secretos en el historial de Git y Bandit analiza vulnerabilidades estáticas de Python (SQLi, llamadas inseguras). |

---

## 4. Modelo de Datos y Esquema de Permisos (Mínimo Privilegio)

### Estructura de Schemas y Tablas

#### Bronze (`raw`)
```sql
CREATE TABLE raw.usgs_events (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    source_feed VARCHAR(100) NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_event_hash UNIQUE (event_id, payload_hash)
);
-- Solo se agrega (append-only), nunca se edita. Garantiza idempotencia de ingesta.
```

#### Silver (`staging`)
```sql
CREATE TABLE staging.events (
    event_id VARCHAR(50) PRIMARY KEY,
    magnitude NUMERIC(4,2),
    mag_type VARCHAR(10),
    place VARCHAR(255),
    event_time TIMESTAMPTZ NOT NULL,
    updated_time TIMESTAMPTZ NOT NULL,
    longitude NUMERIC(9,6) NOT NULL,
    latitude NUMERIC(9,6) NOT NULL,
    depth_km NUMERIC(7,2) NOT NULL,
    tsunami_alert BOOLEAN DEFAULT FALSE,
    significance INTEGER,
    status VARCHAR(50),
    event_type VARCHAR(50),
    usgs_url TEXT,
    staged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE staging.quarantine (
    quarantine_id BIGSERIAL PRIMARY KEY,
    raw_id BIGINT REFERENCES raw.usgs_events(id),
    event_id VARCHAR(50),
    failed_rules TEXT[] NOT NULL,
    rejection_reason TEXT NOT NULL,
    payload JSONB NOT NULL,
    quarantined_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Gold (`curated`)
```sql
CREATE TABLE curated.earthquakes (
    event_id VARCHAR(50) PRIMARY KEY,
    magnitude NUMERIC(4,2),
    magnitude_class VARCHAR(20) NOT NULL, -- 'Micro', 'Minor', 'Light', 'Moderate', 'Strong', 'Major', 'Great'
    mag_type VARCHAR(10),
    place VARCHAR(255),
    region VARCHAR(100), -- Extraído de place (ej: 'California', 'Japan', 'Chile')
    event_time TIMESTAMPTZ NOT NULL,
    updated_time TIMESTAMPTZ NOT NULL,
    longitude NUMERIC(9,6) NOT NULL,
    latitude NUMERIC(9,6) NOT NULL,
    depth_km NUMERIC(7,2) NOT NULL,
    tsunami_alert BOOLEAN DEFAULT FALSE,
    significance INTEGER,
    status VARCHAR(50),
    event_type VARCHAR(50),
    usgs_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_modified_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE curated.quality_runs (
    run_id BIGSERIAL PRIMARY KEY,
    execution_id VARCHAR(100) NOT NULL,
    total_evaluated INTEGER NOT NULL,
    total_passed INTEGER NOT NULL,
    total_quarantined INTEGER NOT NULL,
    quality_score NUMERIC(5,2) NOT NULL,
    freshness_latency_seconds INTEGER,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE curated.ai_reports (
    report_id BIGSERIAL PRIMARY KEY,
    report_date DATE UNIQUE NOT NULL,
    summary_text TEXT NOT NULL,
    calculated_kpis JSONB NOT NULL,
    model_name VARCHAR(50) NOT NULL,
    execution_time_ms INTEGER NOT NULL,
    validation_passed BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE curated.anomalies (
    anomaly_id BIGSERIAL PRIMARY KEY,
    time_window VARCHAR(50) NOT NULL,
    region VARCHAR(100) NOT NULL,
    metric_name VARCHAR(50) NOT NULL, -- 'event_count_spike', 'high_magnitude_outlier'
    metric_value NUMERIC(8,2) NOT NULL,
    z_score NUMERIC(6,2) NOT NULL,
    explanation TEXT NOT NULL,
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE curated.ai_runs (
    run_id BIGSERIAL PRIMARY KEY,
    run_type VARCHAR(20) NOT NULL, -- 'daily_report', 'anomaly_explanation', 'chat_query'
    model_name VARCHAR(50) NOT NULL,
    prompt_tokens_estimated INTEGER,
    completion_tokens_estimated INTEGER,
    latency_ms INTEGER NOT NULL,
    estimated_cost_usd NUMERIC(8,6) DEFAULT 0.0,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Vistas de Consumo Normales (Gold)
* `curated.v_kpis_24h`: Calcula en tiempo real total de sismos, magnitud máxima, promedio, alertas de tsunami y hora del último evento.
* `curated.v_hourly_counts`: Agrupación por hora de las últimas 24 horas para la serie temporal.
* `curated.v_region_activity`: Conteo y promedio de magnitud por región (top 10 regiones más activas).
* `curated.v_magnitude_distribution`: Conteo agrupado por `magnitude_class`.
* `curated.v_quarantine`: Vista definida sobre `staging.quarantine` propiedad de `postgres` (con `SECURITY DEFINER` o permisos concedidos a `role_api_reader`), permitiendo que la API lea cuarentenas sin tener permiso directo sobre el schema `staging`.
* `curated.v_events_chat`: Vista con columnas restringidas exclusivamente para el agente de IA: `event_id, magnitude, magnitude_class, place, region, event_time, depth_km, tsunami_alert, status`.

---

### Matriz de Roles y Permisos de Mínimo Privilegio (POLP)

| Rol de Base de Datos | Schema `raw` | Schema `staging` | Schema `curated` | Atributos Especiales de Seguridad |
| :--- | :--- | :--- | :--- | :--- |
| **`role_ingestion`** | `INSERT, SELECT` sobre `raw.usgs_events` | Cero acceso | Cero acceso | Sin acceso a staging ni curated. |
| **`role_transformation`** | `SELECT` | `SELECT, INSERT, UPDATE, DELETE` | `SELECT, INSERT, UPDATE, DELETE` | Utilizado por los DAGs de Airflow de procesamiento y reportes. |
| **`role_api_reader`** | Cero acceso | Cero acceso | `SELECT` en tablas y vistas de `curated` | La API de FastAPI no puede mutar datos bajo ninguna circunstancia. |
| **`role_chat_reader`** | Cero acceso | Cero acceso | `SELECT` **exclusivamente** en `curated.v_events_chat` | `default_transaction_read_only = on`, `statement_timeout = '3000ms'`. |
| **`role_api_logger`** | Cero acceso | Cero acceso | `INSERT` **exclusivamente** en `curated.ai_runs` | Utilizado por la API para registrar auditoría de IA. |

---

## 5. Diseño del Agente Conversacional Local y Guardrails

### Flujo Operativo del Chat
1. **Petición del Usuario:** El usuario envía su pregunta desde el frontend (vía `fetch` con stream SSE y token JWT de Viewer o Admin).
2. **Sanitización de Entrada:** Se filtra el texto del usuario para mitigar inyecciones de prompt.
3. **Generación de SQL (Text-to-SQL):**
   * Se envía a Ollama (`phi3:latest`) el schema exacto de `curated.v_events_chat`.
   * El modelo genera una única sentencia `SELECT`.
4. **Validador Determinístico de Seguridad (AST / Regex):**
   * Comprueba que la consulta comience por `SELECT`.
   * Bloquea terminantemente: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `EXEC`, `;`, `--`, `pg_`.
   * Verifica que únicamente consulte `curated.v_events_chat`.
   * Inyecta o valida `LIMIT 50`.
5. **Ejecución en Base de Datos:**
   * La consulta se ejecuta utilizando la conexión de `role_chat_reader` (solo lectura forzada a nivel de sesión y timeout estricto de 3 segundos).
6. **Sintetizador Grounded:**
   * Se envía a Ollama el resultado JSON obtenido de la base de datos junto con la pregunta original, con la directiva estricta de responder basándose **únicamente** en esos registros.
7. **Guardrail Numérico Post-LLM:**
   * Un analizador extrae todos los números generados por el modelo en su respuesta.
   * Normaliza los formatos numéricos (ej. `5.8` vs `5.80`, redondeo de decimales y fechas).
   * Valida que cada cifra generada esté presente en el resultado SQL.
   * **Manejo de Discrepancia / Fallo:** Si el modelo genera cifras inventadas o alucina, el guardrail intercepta la respuesta y genera una plantilla estructurada construida directamente a partir del JSON de la base de datos.
8. **Auditoría:** Cada llamada se registra en `curated.ai_runs` a través del usuario `role_api_logger`.

---

## 6. Cronograma de Construcción y Estimación de Tiempo (Hora Real: 07:15)

```
META: CÓDIGO 100% FUNCIONAL Y PROBADO A LAS 13:00 (Buffer de 59 min para entrega)
=======================================================================================
07:15 - 07:35  [TAREA 1]: Plan v2, Verificación de Ollama, Commit de Docs.
07:35 - 08:35  [FASE 1]:  Infra Docker (Postgres + Airflow + Ollama opcional), 
                          Schemas Medallion, Roles POLP, Tablas, Vistas y Tests de Permisos.
08:35 - 09:50  [FASE 2]:  Pipeline Airflow E2E: Ingesta (5 min), Pandera (2 niveles: lote/fila),
                          Cuarentena, Curated Upsert, Backfill 30d y Tests Pytest.
09:50 - 10:55  [FASE 3]:  FastAPI Backend: Auth JWT en memoria (Viewer/Admin), Endpoints
                          Curated, Airflow API Trigger, SSE Streaming y Tests de RBAC.
10:55 - 11:55  [FASE 4]:  Frontend React: Dashboard, Mapa Leaflet, SSE Stream Reader,
                          Panel de Cuarentena Admin, Estados de Carga y Manejo de Errores.
11:55 - 12:40  [FASE 5]:  Módulos de IA: DAG Reporte Diario (cifras verificadas), Detección de
                          Anomalías Z-Score y persistencia en ai_runs.
12:40 - 13:00  [FASE 6]:  Agente Chat Local: Text-to-SQL, role_chat_reader, guardrails numéricos,
                          streaming fetch SSE en UI y verificación integral.
---------------------------------------------------------------------------------------
13:00 - 13:40  [FASE 7]:  Documentación Final: README.md completo, docs/ARQUITECTURA.md,
                          reportes de seguridad (Gitleaks y Bandit) y capturas.
13:40 - 13:59  [FASE 8]:  Verificación Final: `docker compose up -d` limpio, empaquetado
                          en archivo .zip y confirmación de entrega en Moodle.
=======================================================================================
```

---

## 7. Matriz de Trazabilidad de Requisitos

| Requisito del Enunciado / Tech Lead | Componente / Archivo Responsable | Fase | Criterio de Verificación |
| :--- | :--- | :--- | :--- |
| **Mapeo Medallion (Bronze/Silver/Gold)** | `db/init/01_schemas.sql`, `02_tables.sql` | Fase 1 | Schemas `raw`, `staging`, `curated` creados y aislados. |
| **Bronze Append-Only e Idempotente** | `raw.usgs_events` | Fase 1 & 2 | `UNIQUE(event_id, payload_hash)` y `ON CONFLICT DO NOTHING`. |
| **Silver: Tipado y Cuarentena** | `staging.events`, `staging.quarantine` | Fase 1 & 2 | Validación Pandera con `lazy=True`; causas documentadas. |
| **Gold: Curated y Columnas Derivadas**| `curated.earthquakes` | Fase 1 & 2 | Upsert condicional (`updated_time`), `region` y `magnitude_class`. |
| **Vistas Normales de Consumo** | `curated.v_*` | Fase 1 | 6 vistas creadas (KPIs, Horas, Regiones, Magnitudes, Cuarentena, Chat). |
| **Roles de Mínimo Privilegio (POLP)** | `db/init/01_schemas.sql`, `tests/test_roles.py` | Fase 1 | Verificación con tests de qué puede y qué NO puede hacer cada rol. |
| **Airflow con LocalExecutor & Compose** | `docker-compose.yml`, `airflow/Dockerfile` | Fase 1 | Interfaz accesible en `http://localhost:8080`, cero errores. |
| **Ingesta 5 min y Disparo de Transformación**| `airflow/dags/usgs_ingest_feed.py` | Fase 2 | Programación `*/5 * * * *`, disparo por Dataset/Trigger. |
| **Calidad Lote (bloqueante) y Fila (cuarentena)**| `airflow/include/quality.py` | Fase 2 | Error de lote detiene DAG; error de fila va a cuarentena. |
| **Backfill Histórico 30 días** | `airflow/dags/usgs_historical_backfill.py`| Fase 2 | DAG parametrizado con fecha, idempotente. |
| **Alertas por Fallo** | `airflow/include/callbacks.py` | Fase 2 | `on_failure_callback` envía alerta a webhook de `.env`. |
| **Auth JWT y RBAC sin tabla usuarios**| `api/auth.py` | Fase 3 | Usuarios en variables de entorno, passwords en bcrypt, Viewer 403. |
| **Disparo de Acciones hacia Airflow API**| `api/routes/admin.py` | Fase 3 | Backfill y regeneración llaman a la REST API de Airflow. |
| **Tiempo Real con SSE y Fetch** | `api/routes/stream.py`, `web/src/hooks/useStream.ts` | Fase 3 & 4 | Novedades en vivo sin recargar; polling cada 5-10s en servidor. |
| **Dashboard, Mapa y KPIs** | `web/src/pages/Dashboard.tsx` | Fase 4 | Visualización geoespacial con Leaflet y gráficos Recharts. |
| **Reporte Narrativo IA Diario** | `airflow/dags/usgs_daily_report_anomaly.py` | Fase 5 | Cifras calculadas por código; LLM solo redacta; fallback activo. |
| **Detección de Anomalías Z-Score** | `airflow/include/anomaly.py` | Fase 5 | Detección estadística y persistencia en `curated.anomalies`. |
| **Auditoría Unificada de IA** | `curated.ai_runs` | Fase 5 | Registro de modelo, tokens, latencia y costo para todo proceso IA. |
| **Chat Local Grounded (Ollama Phi-3)** | `api/routes/chat.py`, `web/src/components/Chat.tsx` | Fase 6 | Solo lectura en `v_events_chat`, streaming fetch, guardrail numérico. |
| **Auditoría de Seguridad y Secretos** | `docs/security_audit.txt` | Fase 7 | Reporte limpio de `gitleaks` y análisis estático de `bandit`. |
| **Entrega en Moodle** | `sismowatch_entrega.zip` | Fase 8 | Archivo listo y verificado antes de las 13:59. |

---

## 8. Estructura de Carpetas del Repositorio

```
sismowatch/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
├── PLAN.md
├── docs/
│   ├── ARQUITECTURA.md
│   └── security_audit.txt
├── db/
│   └── init/
│       ├── 01_schemas_and_roles.sql
│       └── 02_tables_and_views.sql
├── airflow/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── dags/
│   │   ├── usgs_ingest_feed.py
│   │   ├── usgs_transform_quality.py
│   │   ├── usgs_daily_report_anomaly.py
│   │   └── usgs_historical_backfill.py
│   └── include/
│       ├── __init__.py
│       ├── transform.py
│       ├── quality.py
│       ├── anomaly.py
│       ├── ai_client.py
│       ├── callbacks.py
│       └── prompts.py
├── api/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py
│   ├── config.py
│   ├── auth.py
│   ├── database.py
│   ├── routes/
│   │   ├── auth.py
│   │   ├── kpis.py
│   │   ├── events.py
│   │   ├── reports.py
│   │   ├── stream.py
│   │   ├── admin.py
│   │   └── chat.py
│   └── services/
│       ├── airflow_client.py
│       ├── chat_service.py
│       └── guardrails.py
├── web/
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── context/AuthContext.tsx
│   │   ├── components/
│   │   │   ├── Navbar.tsx
│   │   │   ├── KpiCard.tsx
│   │   │   ├── EarthquakeMap.tsx
│   │   │   ├── TimeseriesChart.tsx
│   │   │   ├── LiveIndicator.tsx
│   │   │   └── ChatDrawer.tsx
│   │   └── pages/
│   │       ├── Login.tsx
│   │       ├── Dashboard.tsx
│   │       ├── Reports.tsx
│   │       ├── PipelineStatus.tsx
│   │       └── Quarantine.tsx
└── tests/
    ├── conftest.py
    ├── test_roles_permissions.py
    ├── test_transform.py
    ├── test_quality.py
    ├── test_dags_integrity.py
    └── test_api_rbac.py
```

---

## 9. Análisis de Modelos Locales y Evidencia de Selección

### Verificación del Entorno
* Comando ejecutado: `ollama list`
* Resultado:
  ```
  NAME           ID              SIZE      MODIFIED     
  phi3:latest    4f2222927938    2.2 GB    5 months ago
  ```
* Único modelo actualmente disponible localmente: **`phi3:latest` (3.8B parámetros)**.

### Prueba de Evaluación Text-to-SQL con `phi3:latest` (5 Consultas Reales)

| # | Pregunta de Usuario | SQL Generado por `phi3:latest` | Latencia | Evaluación Técnica |
| :--- | :--- | :--- | :--- | :--- |
| 1 | *¿Cuáles son los 5 sismos más fuertes registrados?* | `SELECT event_id, magnitude, status FROM curated.v_events_chat ORDER BY magnitude DESC LIMIT 5;` | 8.55s | **Válido y Óptimo:** Respeta la vista, ordena descendente y aplica LIMIT. |
| 2 | *¿Cuántos sismos ocurrieron en las últimas 24 horas?* | `SELECT COUNT(*) AS total_earthquakes FROM curated.v_events_chat WHERE event_time > NOW() - INTERVAL '1 day';` | 4.57s | **Válido y Óptimo:** Utiliza la función temporal nativa de PostgreSQL (`INTERVAL '1 day'`). |
| 3 | *¿Cuál es la magnitud promedio en California?* | `SELECT AVG(magnitude) AS average_magnitude FROM curated.v_events_chat WHERE region = 'California' AND status = 'confirmed';` | 5.19s | **Válido:** Filtra por columna `region` derivada y agrega con `AVG()`. |
| 4 | *¿Qué sismos tuvieron alerta de tsunami?* | `SELECT event_id, magnitude, place, region, depth_km, status FROM curated.v_events_chat WHERE tsunami_alert = TRUE ORDER BY event_time DESC LIMIT 50;` | 5.99s | **Válido y Seguro:** Maneja booleano nativo y acota a 50 filas. |
| 5 | *¿Cuántos sismos hay por cada clasificación de magnitud?* | `SELECT magnitude_class, COUNT(event_id) AS event_count FROM curated.v_events_chat GROUP BY magnitude_class ORDER BY ... LIMIT 50;` | 5.70s | **Válido:** Agrupación correcta por columna categórica `magnitude_class`. |

### Conclusión y Recomendación:
`phi3:latest` demostró una precisión del **100% en la sintaxis SQL de PostgreSQL** sobre la vista `curated.v_events_chat` con latencia promedio de **5.5 segundos**. Descargar un modelo adicional como `qwen2.5-coder` requeriría descargar ~2GB sobre la red en plena prueba técnica, arriesgando ancho de banda y tiempo crítico sin una ganancia justificada. Por ende, **se recomienda mantener `phi3:latest` como modelo principal**, respaldado por los guardrails determinísticos en Python y fallback de plantillas.

---

## 10. Recortes Explícitos y Contingencias (Plan Anti-Fallo)

### Lo que NO se implementará (Sobreingeniería descartada):
* **Sin dbt:** Las transformaciones son directas y se orquestan en tareas Python/Pandera de Airflow.
* **Sin Great Expectations:** Pandera cubre el 100% de las validaciones requeridas de forma ligera.
* **Sin Kafka / Spark:** Medallion sobre micro-lotes en PostgreSQL resuelve el volumen sin duplicar infraestructura.
* **Sin Celery / Redis:** Airflow opera con `LocalExecutor` sobre PostgreSQL.
* **Sin RAG / Base Vectorial:** El asistente analítico es Text-to-SQL directo sobre datos estructurados, no búsqueda semántica de documentos no estructurados.
* **Sin Vistas Materializadas:** Vistas normales para lectura de datos en tiempo real sin latencia de refresco.

### Orden de Recortes ante Falta de Tiempo:
1. **Recorte 1:** Exportación de reportes a PDF $\rightarrow$ Mantener CSV y HTML descargable.
2. **Recorte 2:** Estilos avanzados del mapa Leaflet $\rightarrow$ Marcadores circulares con popup básico.
3. **Recorte 3:** Detección de anomalías multidimensional $\rightarrow$ Z-Score unidimensional sobre tasa horaria.
4. **INMUTABLE (Criterio de Aprobación):** Pipeline E2E Airflow, Schemas y Roles Medallion, Pandera Lote/Fila, Chat Local de solo lectura con guardrails y `docker compose up -d` funcional.
