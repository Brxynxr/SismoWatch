# SismoWatch - Documento de Arquitectura de Datos y Plataforma

## 1. Propósito de la Arquitectura
La arquitectura de **SismoWatch** resuelve la necesidad crítica de transformar un feed público, efímero y no validado de eventos sísmicos globales (USGS Earthquake Catalog) en un **producto de datos empresarial confiable, seguro, auditable y de alto valor analítico**.

### ¿Para quién y qué decisiones habilita?
* **Equipos de Operaciones:** Detección inmediata de sismos de magnitud crítica con alerta de tsunami para activación de protocolos de contingencia y asignación de recursos.
* **Equipos de Gestión de Riesgo:** Análisis de tendencias temporales, distribución de magnitudes y enjambres sísmicos para actualización de modelos de vulnerabilidad territorial.
* **Liderazgo Técnico y Auditoría:** Garantía de trazabilidad completa desde el dato crudo (Bronze) hasta el consumo de negocio (Gold), con métricas de calidad y aislamiento de seguridad estricto.

---

## 2. Decisión de Arquitectura: Patrón Medallion y Data Lakehouse Híbrido (Hot/Cold Tiering)

Se implementa una arquitectura híbrida **Medallion Lakehouse** combinando dos niveles de almacenamiento:
1. **Hot Tier (OLTP Transaccional - PostgreSQL 16):** Responde a las consultas de baja latencia del frontend web, streaming SSE en `/api/stream`, mapa interactivo con Leaflet y ejecución Text-to-SQL del asistente de IA.
2. **Cold Tier (Data Lakehouse - MinIO S3 + Apache Parquet):** Almacenamiento histórico inmutable particionado por fecha con compresión columnar `snappy`, habilitando archivado a largo plazo, compatibilidad analítica masiva (DuckDB/Spark/Trino) y desacoplamiento de cómputo.

```
       [ USGS Public API ]
               |
               v (HTTP GET cada 5 min)
   +-----------------------+
   |  Apache Airflow 2.10  |  (LocalExecutor, TaskFlow API)
   +-----------+-----------+
               |
    ===========|======================================================
    CAPA 1: BRONZE (raw.usgs_events & MinIO Parquet)
    - Hot: PostgreSQL raw.usgs_events (JSONB inmutable, append-only).
    - Cold: s3://sismowatch-lake/bronze/year=YYYY/month=MM/day=DD/raw_events.parquet (snappy).
    ==================================================================
               |
               v [Validación Pandera (lazy=True)]
    ===========|======================================================
    CAPA 2: SILVER (staging & MinIO Parquet)
    - Hot: staging.events (limpios) & staging.quarantine (rechazos).
    - Cold: s3://sismowatch-lake/silver/valid/year=YYYY/month=MM/events_clean.parquet
    - Cold: s3://sismowatch-lake/silver/quarantine/year=YYYY/month=MM/quarantined.parquet
    ==================================================================
               |
               v [Upsert condicional + Enriquecimiento]
    ===========|======================================================
    CAPA 3: GOLD (curated & MinIO Parquet)
    - Hot: curated.earthquakes (region, impact_radius_km, magnitude_class).
    - Cold: s3://sismowatch-lake/gold/year=YYYY/month=MM/earthquakes_curated.parquet
    - Vistas: v_kpis_24h, v_hourly_counts, v_region_activity,
              v_magnitude_distribution, v_quarantine, v_events_chat.
    ==================================================================
         ^                           ^
         | (role_api_reader)         | (role_chat_reader: read-only, timeout 3s)
    +----+------------------+   +----+------------------+
    |   FastAPI Backend     |   |   Agente Chat Local   | (Ollama qwen2.5-coder)
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


---

## 6. Arquitectura Híbrida Hot/Cold Tiering y Data Lakehouse (MinIO + Parquet)

SismoWatch implementa una arquitectura híbrida de almacenamiento dividida en dos capas:

### 1. Hot Tier (PostgreSQL 16)
* **Objetivo:** Explotación analítica y transaccional en tiempo real.
* **Consumidores:** FastAPI (`/api/events`, `/api/kpis`, `/api/reports`), SSE Stream en `/api/stream`, mapa interactivo Leaflet y asistente conversacional Text-to-SQL.
* **Garantías:** Integridad relacional, llaves foráneas, índices B-Tree y GiST, aislamiento por roles de base de datos (POLP).

### 2. Cold Tier (MinIO Object Storage + Apache Parquet)
* **Objetivo:** Archivo histórico inmutable, optimizado para escaneos masivos OLAP y consultas federadas.
* **Formato:** Apache Parquet columnar con compresión `snappy`.
* **Esquema de Particionamiento Medallion en bucket `sismowatch-lake`:**
  * **Bronze:** `bronze/year=YYYY/month=MM/day=DD/raw_events.parquet`
  * **Silver Válidos:** `silver/valid/year=YYYY/month=MM/events_clean.parquet`
  * **Silver Cuarentena:** `silver/quarantine/year=YYYY/month=MM/quarantined.parquet`
  * **Gold Curados:** `gold/year=YYYY/month=MM/earthquakes_curated.parquet`
* **Resiliencia:** La exportación a MinIO está desacoplada del pipeline de base de datos mediante un patrón no bloqueante (`try/except` con log de advertencia), asegurando que cualquier indisponibilidad transitoria del servicio de almacenamiento de objetos jamás detenga la operación crítica en PostgreSQL.
* **Consola de Administración:** Accesible en `http://localhost:9001` con las credenciales de entorno `MINIO_ROOT_USER` y `MINIO_ROOT_PASSWORD`.

---

## 7. Evolución a Producción y Criterios de Escala (Ecosistema Apache)

Para una evolución hacia un producto de datos global de escala petabyte, se definen los siguientes criterios concretos para la incorporación de componentes adicionales:

| Componente | ¿Cuándo incorporarlo? (Criterio de Escala) | ¿Por qué y qué problema resuelve? |
| :--- | :--- | :--- |
| **Apache Spark** | Cuando el volumen supere **100 GB/día** o se integren redes de sensores sísmicos IoT de alta frecuencia (miles de lecturas por segundo) que desborden la memoria/CPU de un único nodo PostgreSQL. | Permite procesamiento paralelo distribuido en clúster (RDDs y Spark DataFrames) para agregaciones geoespaciales complejas y cálculo de matrices de covarianza a escala sin estrangular la base de datos relacional. |
| **Motor de Consulta Federada (Trino / DuckDB)** | Cuando múltiples analistas requieran consultar directamente el Cold Tier en MinIO Parquet sin pasar por PostgreSQL. | Permite ejecutar consultas SQL estándar directamente sobre el lago de datos Parquet particionado en MinIO con latencias de segundos. |
| **Catálogo de Linaje Empresarial (Atlas / OpenMetadata)** | Cuando la organización crezca a **más de 15 pipelines interdependientes** y múltiples equipos interdisciplinarios (Data Engineering, Data Science, Compliance) consuman y publiquen datos. | Centraliza la gobernanza empresarial, catálogo de términos de negocio, control de linaje automatizado columna por columna (column-level lineage) y auditoría de accesos PII/sensibles en una plataforma corporativa unificada. |


---

## 7. Elementos Diferenciadores de SismoWatch (Innovación y Valor de Negocio)

Para transformar un pipeline estándar en una solución de monitoreo de grado empresarial, SismoWatch implementa tres capacidades diferenciadoras:

### 1. Simulador Geoespacial de Impacto Sísmico (Radio Teórico de Aceleración PGA)
En lugar de únicamente mostrar marcadores estáticos en las coordenadas del epicentro, SismoWatch calcula en la capa Gold el **radio de percepción teórica** en kilómetros donde la aceleración del terreno ($PGA$) superó el umbral perceptible de la Escala de Intensidad Mercalli Modificada (MMI III+), basándose en la relación empírica de atenuación sísmica:
$$R_{\text{impacto}} = 10^{(0.45 \times \text{magnitud} - 0.8)}$$
En la plataforma web (Leaflet), se dibuja dinámicamente un radio de cobertura semitransparente que permite a los operadores de riesgo estimar de un vistazo qué infraestructuras y ciudades se vieron comprometidas.

### 2. Proof of Grounding & Explainable AI en el Asistente Conversacional
Cada respuesta analítica generada por el agente local (`qwen2.5-coder:1.5b`) incluye una tarjeta de auditoría transparente que expone:
* La sentencia SQL exacta generada y ejecutada sobre `curated.v_events_chat`.
* El rol de base de datos (`role_chat_reader`) con su restricción de solo lectura y timeout.
* La latencia de ejecución en milisegundos en PostgreSQL.
* El porcentaje de coincidencia numérica verificado por el guardrail numérico (cero alucinaciones).

### 3. Medidor Dinámico de SLA de Frescura y Circuit Breaker (Chaos Testing)
Un widget en el Dashboard mide en tiempo real la frescura de los datos frente al SLA estricto de 5 minutos. Además, el sistema incorpora un mecanismo de contingencia (*Circuit Breaker*) que conmuta a una réplica local validada ante caídas o rate-limiting de la API pública del USGS, garantizando **cero pantallas en blanco**.

---

## 8. Gobernanza y Linaje con OpenMetadata
Para garantizar trazabilidad empresarial y catalogación de metadatos, SismoWatch incorpora compatibilidad nativa con **OpenMetadata**. Toda la arquitectura de linaje, catálogo de schemas Medallion y mapeo de pruebas de calidad Pandera se encuentra documentada en [docs/OPENMETADATA.md](OPENMETADATA.md).
