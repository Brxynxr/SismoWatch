# SismoWatch - Documento de Arquitectura de Datos y Plataforma

## 1. Propósito de la Arquitectura
La arquitectura de **SismoWatch** resuelve la necesidad crítica de transformar un feed público, efímero y no validado de eventos sísmicos globales (USGS Earthquake Catalog) en un **producto de datos empresarial confiable, seguro, auditable y de alto valor analítico**.

### ¿Para quién y qué decisiones habilita?
* **Equipos de Operaciones:** Detección inmediata de sismos de magnitud crítica con alerta de tsunami para activación de protocolos de contingencia y asignación de recursos.
* **Equipos de Gestión de Riesgo:** Análisis de tendencias temporales, distribución de magnitudes y enjambres sísmicos para actualización de modelos de vulnerabilidad territorial.
* **Liderazgo Técnico y Auditoría:** Garantía de trazabilidad completa desde el dato crudo (Bronze) hasta el consumo de negocio (Gold), con métricas de calidad y aislamiento de seguridad estricto.

---

## 2. Decisión de Arquitectura: Patrón Medallion (Bronze - Silver - Gold)

Se seleccionó el patrón **Medallion Architecture (Multi-Hop)** sobre arquitecturas alternativas como Lambda o Kappa por tres razones fundamentales:

1. **Evolución Asíncrona de los Datos:** Un evento sísmico publicado por USGS no es inmutable en el tiempo. Minutos o días después, los sismólogos refinan la magnitud preliminar, corrigen la profundidad o actualizan el estado de `automatic` a `reviewed`. Medallion permite almacenar cada versión en Bronze (append-only) y mantener en Gold la última versión oficial consolidada mediante **upsert condicional** (`UPDATE` solo si `EXCLUDED.updated_time > curated.earthquakes.updated_time`).
2. **Eliminación de la Complejidad Operativa (Anti-Sobreingeniería):** Lambda requiere paralelizar dos canales (Batch y Speed) con motores pesados (Kafka/Flink y Spark) que duplican la lógica de negocio. En SismoWatch, micro-lotes de 5 minutos sobre PostgreSQL satisfacen la latencia requerida con una sola base de datos y un solo orquestador.
3. **Gobierno y Cuarentena:** Silver aísla datos limpios y envía registros anómalos a cuarentena sin frenar el flujo de datos sanos.

```
       [ USGS Public API ]
               |
               v (HTTP GET cada 5 min)
   +-----------------------+
   |  Apache Airflow 2.10  |  (LocalExecutor, TaskFlow API)
   +-----------+-----------+
               |
    ===========|======================================================
    CAPA 1: BRONZE (raw.usgs_events)
    - Almacena el GeoJSON tal como llega (JSONB completo).
    - Append-only: INSERT ... ON CONFLICT (event_id, payload_hash) DO NOTHING.
    - Cero mutaciones. Auditoría histórica completa.
    ==================================================================
               |
               v [Validación Pandera (lazy=True)]
    ===========|======================================================
    CAPA 2: SILVER (staging)
    - staging.events: Normalización y tipado fuerte (1 fila por evento).
    - staging.quarantine: Filas inválidas con motivo y regla fallida.
    ==================================================================
               |
               v [Upsert condicional + Enriquecimiento]
    ===========|======================================================
    CAPA 3: GOLD (curated)
    - curated.earthquakes: Estado actual con 'region' y 'magnitude_class'.
    - curated.quality_runs: Métricas de calidad por lote y frescura.
    - curated.ai_reports: Resúmenes ejecutivos diarios.
    - curated.anomalies: Enjambres y picos detectados (Z-score).
    - curated.ai_runs: Registro unificado de ejecuciones LLM.
    - Vistas: v_kpis_24h, v_hourly_counts, v_region_activity,
              v_magnitude_distribution, v_quarantine, v_events_chat.
    ==================================================================
         ^                           ^
         | (role_api_reader)         | (role_chat_reader: read-only, timeout 3s)
    +----+------------------+   +----+------------------+
    |   FastAPI Backend     |   |   Agente Chat Local   | (Ollama Phi-3)
    +-----------+-----------+   +-----------+-----------+
                \                           /
                 v                         v
               +-----------------------------+
               |    React + Vite Frontend    | (Dashboard, Live SSE, Chat)
               +-----------------------------+
```

---

## 3. Modelo de Seguridad y Mínimo Privilegio (POLP)

La base de datos cuenta con una partición estricta de responsabilidades por rol:

```
[role_ingestion]      ---> INSERT/SELECT en raw.usgs_events (CERO acceso a staging/curated)
[role_transformation] ---> SELECT en raw, SELECT/INSERT/UPDATE en staging y curated
[role_api_reader]     ---> SOLO SELECT en tablas y vistas de curated (CERO acceso a raw/staging)
[role_chat_reader]    ---> SOLO SELECT en curated.v_events_chat (default_transaction_read_only=on, timeout=3s)
[role_api_logger]     ---> SOLO INSERT en curated.ai_runs
```

### Seguridad en la Plataforma:
* **Sin tabla de usuarios en BD:** Credenciales de `admin` y `viewer` residen en variables de entorno. Al arrancar la API, las contraseñas se validan contra hashes `bcrypt` en memoria.
* **Acciones de Administración Aisladas:** El backfill histórico y la regeneración de reportes de IA no ejecutan escrituras directas desde la API, sino que invocan la **REST API de Apache Airflow**.
* **Protección contra Inyección en LLM:** Los textos de ubicación (`place`) se sanitizan antes de interactuar con el LLM. El agente conversacional utiliza un validador sintáctico AST/regex que solo autoriza sentencias `SELECT` sobre `curated.v_events_chat`, respaldado físicamente por `role_chat_reader`.

---

## 4. Estrategia de Calidad de Datos

La calidad opera en dos niveles complementarios:
1. **Nivel Lote (Bloqueante):** Si el volumen de sismos es anormalmente nulo, la frescura excede el umbral tolerado o el esquema GeoJSON viene corrompido, la tarea en Airflow falla de forma inmediata y **ningún dato ingresa a Gold**.
2. **Nivel Fila (Cuarentena no bloqueante):** Si una fila individual tiene coordenadas fuera de rango (latitud $[-90, 90]$, longitud $[-180, 180]$) o magnitud absurda, Pandera con `lazy=True` la aísla y la inserta en `staging.quarantine`, permitiendo que el resto del lote limpio continúe hacia `curated.earthquakes`.

---

## 5. Estrategia de Consumo en Tiempo Real

El sistema implementa una arquitectura de streaming transparente:
* **Ingesta:** Micro-lotes cada 5 minutos orquestados por Airflow.
* **Distribución en Vivo:** FastAPI expone `/api/stream` vía Server-Sent Events (SSE). Un generador asíncrono sondea la vista `curated.v_kpis_24h` y eventos recientes cada 5-10 segundos.
* **Consumo Frontend:** Para sortear la limitación de la API nativa `EventSource` (que no permite enviar cabeceras `Authorization: Bearer <token>`), la interfaz de React utiliza `fetch()` con lectura de flujo (`ReadableStream`), manteniendo la autenticación JWT estricta y reconexión automática sin sacrificar seguridad.
