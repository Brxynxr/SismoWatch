-- ==============================================================================
-- SismoWatch - 02_tables_and_views.sql
-- Creación de Tablas Medallion (Bronze/Silver/Gold), Vistas de Consumo y Permisos
-- ==============================================================================

\c sismowatch_db

-- ------------------------------------------------------------------------------
-- 1. CAPA BRONZE (RAW) - Append-Only & Idempotente
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.usgs_events (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    source_feed VARCHAR(100) NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_event_hash UNIQUE (event_id, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_raw_event_id ON raw.usgs_events(event_id);
CREATE INDEX IF NOT EXISTS idx_raw_fetched_at ON raw.usgs_events(fetched_at DESC);

-- ------------------------------------------------------------------------------
-- 2. CAPA SILVER (STAGING) - Tipado, Limpieza y Cuarentena
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging.events (
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

CREATE TABLE IF NOT EXISTS staging.quarantine (
    quarantine_id BIGSERIAL PRIMARY KEY,
    raw_id BIGINT REFERENCES raw.usgs_events(id) ON DELETE SET NULL,
    event_id VARCHAR(50),
    failed_rules TEXT[] NOT NULL,
    rejection_reason TEXT NOT NULL,
    payload JSONB NOT NULL,
    quarantined_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staging_quarantine_event ON staging.quarantine(event_id);

-- ------------------------------------------------------------------------------
-- 3. CAPA GOLD (CURATED) - Negocio, Estado Actual y Auditoría
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curated.earthquakes (
    event_id VARCHAR(50) PRIMARY KEY,
    magnitude NUMERIC(4,2),
    magnitude_class VARCHAR(20) NOT NULL,
    mag_type VARCHAR(10),
    place VARCHAR(255),
    region VARCHAR(100),
    impact_radius_km NUMERIC(6,2),
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

CREATE INDEX IF NOT EXISTS idx_curated_event_time ON curated.earthquakes(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_curated_magnitude ON curated.earthquakes(magnitude DESC);
CREATE INDEX IF NOT EXISTS idx_curated_region ON curated.earthquakes(region);
CREATE INDEX IF NOT EXISTS idx_curated_coords ON curated.earthquakes(latitude, longitude);

-- Tablas generadas por procesos
CREATE TABLE IF NOT EXISTS curated.quality_runs (
    run_id BIGSERIAL PRIMARY KEY,
    execution_id VARCHAR(100) NOT NULL,
    total_evaluated INTEGER NOT NULL,
    total_passed INTEGER NOT NULL,
    total_quarantined INTEGER NOT NULL,
    quality_score NUMERIC(5,2) NOT NULL,
    freshness_latency_seconds INTEGER,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curated.ai_reports (
    report_id BIGSERIAL PRIMARY KEY,
    report_date DATE UNIQUE NOT NULL,
    summary_text TEXT NOT NULL,
    calculated_kpis JSONB NOT NULL,
    model_name VARCHAR(50) NOT NULL,
    execution_time_ms INTEGER NOT NULL,
    validation_passed BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curated.anomalies (
    anomaly_id BIGSERIAL PRIMARY KEY,
    time_window VARCHAR(50) NOT NULL,
    region VARCHAR(100) NOT NULL,
    metric_name VARCHAR(50) NOT NULL,
    metric_value NUMERIC(8,2) NOT NULL,
    z_score NUMERIC(6,2) NOT NULL,
    explanation TEXT NOT NULL,
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curated.ai_runs (
    run_id BIGSERIAL PRIMARY KEY,
    run_type VARCHAR(25) NOT NULL, -- 'daily_report', 'anomaly_detection', 'chat_query'
    model_name VARCHAR(50) NOT NULL,
    prompt_tokens_estimated INTEGER,
    completion_tokens_estimated INTEGER,
    latency_ms INTEGER NOT NULL,
    estimated_cost_usd NUMERIC(8,6) DEFAULT 0.0,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 4. VISTAS NORMALES DE CONSUMO (GOLD)
-- ------------------------------------------------------------------------------

-- Vista 1: KPIs de las últimas 24 horas
CREATE OR REPLACE VIEW curated.v_kpis_24h AS
SELECT
    COUNT(*)::INTEGER AS total_events_24h,
    COALESCE(MAX(magnitude), 0.0)::NUMERIC(4,2) AS max_magnitude_24h,
    COALESCE(ROUND(AVG(magnitude), 2), 0.0)::NUMERIC(4,2) AS avg_magnitude_24h,
    COUNT(CASE WHEN tsunami_alert = TRUE THEN 1 END)::INTEGER AS tsunami_alerts_24h,
    MAX(event_time) AS latest_event_time,
    COUNT(CASE WHEN status = 'reviewed' THEN 1 END)::INTEGER AS reviewed_events_24h
FROM curated.earthquakes
WHERE event_time >= NOW() - INTERVAL '24 hours';

-- Vista 2: Conteo horario de eventos (últimas 24 horas)
CREATE OR REPLACE VIEW curated.v_hourly_counts AS
SELECT
    date_trunc('hour', event_time) AS hour_bucket,
    COUNT(*)::INTEGER AS event_count,
    COALESCE(MAX(magnitude), 0.0)::NUMERIC(4,2) AS max_magnitude
FROM curated.earthquakes
WHERE event_time >= NOW() - INTERVAL '24 hours'
GROUP BY date_trunc('hour', event_time)
ORDER BY hour_bucket ASC;

-- Vista 3: Actividad por región (Top 10)
CREATE OR REPLACE VIEW curated.v_region_activity AS
SELECT
    COALESCE(NULLIF(region, ''), 'Desconocida') AS region_name,
    COUNT(*)::INTEGER AS total_events,
    COALESCE(MAX(magnitude), 0.0)::NUMERIC(4,2) AS max_magnitude,
    COALESCE(ROUND(AVG(magnitude), 2), 0.0)::NUMERIC(4,2) AS avg_magnitude
FROM curated.earthquakes
GROUP BY region_name
ORDER BY total_events DESC
LIMIT 10;

-- Vista 4: Distribución por clasificación de magnitud
CREATE OR REPLACE VIEW curated.v_magnitude_distribution AS
SELECT
    magnitude_class,
    COUNT(*)::INTEGER AS event_count,
    ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM curated.earthquakes), 0), 2) AS percentage
FROM curated.earthquakes
GROUP BY magnitude_class
ORDER BY event_count DESC;

-- Vista 5: Cuarentena para Administrador (Mapea staging.quarantine hacia curated)
CREATE OR REPLACE VIEW curated.v_quarantine AS
SELECT
    q.quarantine_id,
    q.event_id,
    q.failed_rules,
    q.rejection_reason,
    q.payload,
    q.quarantined_at
FROM staging.quarantine q;

ALTER VIEW curated.v_quarantine OWNER TO postgres;

-- Vista 6: Columnas restringidas para el Agente Conversacional (Chat)
CREATE OR REPLACE VIEW curated.v_events_chat AS
SELECT
    event_id,
    magnitude,
    magnitude_class,
    place,
    region,
    impact_radius_km,
    event_time,
    depth_km,
    tsunami_alert,
    status
FROM curated.earthquakes;

-- ------------------------------------------------------------------------------
-- 5. ASIGNACIÓN GRANULAR DE PRIVILEGIOS POR ROL (POLP)
-- ------------------------------------------------------------------------------

-- role_ingestion: Solo INSERT y SELECT en raw.usgs_events
GRANT INSERT, SELECT ON TABLE raw.usgs_events TO role_ingestion;
GRANT USAGE, SELECT ON SEQUENCE raw.usgs_events_id_seq TO role_ingestion;

-- role_transformation: Airflow procesa raw -> staging -> curated
GRANT SELECT ON TABLE raw.usgs_events TO role_transformation;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA staging TO role_transformation;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA staging TO role_transformation;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA curated TO role_transformation;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA curated TO role_transformation;

-- role_api_reader: Solo SELECT en curated (tablas y vistas). CERO acceso a raw y staging.
-- En PostgreSQL, "ALL TABLES" abarca tanto tablas regulares como vistas.
GRANT SELECT ON ALL TABLES IN SCHEMA curated TO role_api_reader;

-- role_chat_reader: ÚNICAMENTE SELECT en curated.v_events_chat
GRANT USAGE ON SCHEMA curated TO role_chat_reader;
GRANT SELECT ON TABLE curated.v_events_chat TO role_chat_reader;

-- role_api_logger: ÚNICAMENTE INSERT en curated.ai_runs y SELECT en run_id para RETURNING
GRANT USAGE ON SCHEMA curated TO role_api_logger;
GRANT INSERT ON TABLE curated.ai_runs TO role_api_logger;
GRANT SELECT (run_id) ON TABLE curated.ai_runs TO role_api_logger;
GRANT USAGE, SELECT ON SEQUENCE curated.ai_runs_run_id_seq TO role_api_logger;
