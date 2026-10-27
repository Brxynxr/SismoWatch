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


---

## 6. Evolución a Producción y Criterios de Escala (Ecosistema Apache)

En la fase actual de **SismoWatch**, introducir componentes como Apache Spark, MinIO o Apache Atlas constituiría **sobreingeniería injustificada** (añadiría más de 3 contenedores adicionales, 4 GB de RAM extra y múltiples puntos únicos de fallo que pondrían en riesgo la estabilidad del comando único `docker compose up -d`).

Actualmente, el linaje y gobierno de datos están garantizados de forma nativa por los **Airflow Datasets (Inlets y Outlets)**, permitiendo que la transformación reaccione automáticamente a la actualización de la capa Bronze (`raw.usgs_events`).

Sin embargo, para una evolución hacia un producto de datos global de escala petabyte, se definen los siguientes criterios concretos para su incorporación:

| Componente | ¿Cuándo incorporarlo? (Criterio de Escala) | ¿Por qué y qué problema resuelve? |
| :--- | :--- | :--- |
| **Apache Spark** | Cuando el volumen supere **100 GB/día** o se integren redes de sensores sísmicos IoT de alta frecuencia (miles de lecturas por segundo) que desborden la memoria/CPU de un único nodo PostgreSQL. | Permite procesamiento paralelo distribuido en clúster (RDDs y Spark DataFrames) para agregaciones geoespaciales complejas y cálculo de matrices de covarianza a escala sin estrangular la base de datos relacional. |
| **Object Storage (S3 / MinIO)** | Cuando el historial acumulado supere **500 GB** o se requiera desacoplar almacenamiento de cómputo para auditoría regulatoria de largo plazo. | Permite archivar la capa Bronze en formato columnar comprimido (**Apache Parquet con compresión Snappy/ZSTD**), reduciendo costos de almacenamiento en un 80% y habilitando consultas federadas mediante Trino o Athena sin impactar el disco local. |
| **Catálogo de Linaje (Atlas / OpenMetadata)** | Cuando la organización crezca a **más de 15 pipelines interdependientes** y múltiples equipos interdisciplinarios (Data Engineering, Data Science, Compliance) consuman y publiquen datos. | Centraliza la gobernanza empresarial, catálogo de términos de negocio, control de linaje automatizado columna por columna (column-level lineage) y auditoría de accesos PII/sensibles en una plataforma corporativa unificada. |


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
