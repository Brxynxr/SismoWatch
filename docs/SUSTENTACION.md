# SismoWatch - Guía Maestra de Sustentación Oral y Defensa Técnica

Esta guía compila los argumentos técnicos, métricas, justificaciones de diseño y respuestas estratégicas para sustentar el proyecto **SismoWatch** ante el jurado evaluador o Tech Lead, cubriendo el 100% de la rúbrica de evaluación.

---

## 🎯 1. Resumen Ejecutivo de la Solución
* **Problema:** Los feeds públicos de sismos (como el de la USGS) son efímeros, carecen de controles de calidad integrados, presentan latencia variable y no ofrecen aislamiento de seguridad ni enriquecimiento geofísico.
* **Solución Implementada:** Pipeline E2E con arquitectura Medallion Lakehouse (PostgreSQL 16 Hot Tier + MinIO Parquet Cold Tier), orquestado por Apache Airflow 2.10 mediante Datasets reactivos, motor de calidad dual con Pandera, seguridad POLP estricta en base de datos, asistente conversacional con **Proof of Grounding** (cero alucinaciones) y plataforma web con Cockpit 3D Globe y streaming SSE en tiempo real.

---

## 🏛️ 2. Arquitectura y Trade-offs Técnicos

### ¿Por qué Medallion Lakehouse y no una sola tabla o Lambda?
1. **Medallion vs. Tabla Plana:**  
   Una tabla plana mezcla la ingesta cruda con la lógica de negocio. Si una regla de cálculo de magnitud o región cambia, se pierde el dato original. Medallion garantiza:
   - **Bronze (`raw.usgs_events`):** Inmutable, append-only, almacena el GeoJSON original con hash SHA-256. Permite reprocesar cualquier período histórico sin depender de la fuente externa.
   - **Silver (`staging`):** Tipado fuerte y aislamiento de calidad. Separa eventos válidos (`staging.events`) de eventos corruptos (`staging.quarantine`).
   - **Gold (`curated.earthquakes`):** Estado consolidado enriquecido con cálculos deterministas: clasificación de magnitud, región geográfica y **radio de impacto superficial PGA** ($R = 10^{0.45 \cdot M - 0.8}$).
2. **Hot/Cold Tiering (PostgreSQL + MinIO Snappy Parquet):**  
   PostgreSQL maneja las consultas transaccionales de milisegundos para el frontend y la API REST/SSE. MinIO actúa como Cold Tier para almacenamiento analítico a largo plazo con compresión Snappy columnar, listo para DuckDB o Apache Spark. La exportación es no bloqueante para resiliencia total.

---

## ⚙️ 3. Ingesta y Orquestación en Apache Airflow 2.10

### Características Clave de los DAGs:
1. **Idempotencia Absoluta:**
   - La ingesta calcula un hash SHA-256 sobre el payload normalizado. La inserción utiliza `ON CONFLICT (event_id, payload_hash) DO NOTHING`. Re-ejecutar el DAG 100 veces produce exactamente el mismo estado sin duplicados.
2. **Orquestación Reactiva por Datasets (Data-Aware Scheduling):**
   - El DAG `usgs_ingest_feed` produce el dataset `Dataset("sismowatch://raw/usgs_events")`.
   - El DAG `usgs_transform_quality` se dispara reactivamente en cuanto el dataset se actualiza, eliminando sondeos pasivos y demoras.
3. **Resiliencia ante Fallos de la USGS:**
   - Reintentos con espera creciente exponencial (`retries=3`, `retry_delay=exponential_backoff`), timeouts estrictos en llamadas HTTP y circuit breaker si el feed presenta retrasos mayores a 120 minutos.
4. **Backfill Parametrizado (30 días):**
   - DAG dedicado `usgs_historical_backfill` invocable con parámetros de rango de fechas (`start_date`, `end_date`), ejecutable desde Airflow o directamente desde la plataforma web por usuarios administradores.

---

## 🛡️ 4. Calidad de Datos (Pandera en Dos Niveles)

### Estrategia de Calidad Implementada:
1. **Nivel Lote (Circuit Breaker Bloqueante):**
   - Valida la integridad estructural del GeoJSON, volumen mínimo de eventos y **SLA de frescura** (< 120 minutos entre la ejecución y el último evento sísmico). Si se viola, la tarea aborta y **ningún dato inválido ingresa a Silver ni Gold**.
2. **Nivel Fila (`lazy=True` y Cuarentena):**
   - Valida rangos físicos: latitud $[-90, 90]$, longitud $[-180, 180]$, profundidad $\ge 0$, magnitud $[-1, 10]$ y fechas sin saltos al futuro.
   - Los registros que fallan se insertan en `staging.quarantine` con sus `failed_rules` y `rejection_reason` explicados en lenguaje natural. Los registros válidos del mismo lote continúan su flujo sin interrupciones.
3. **Métricas y Puntuación de Calidad:**
   - Cada ejecución registra en `curated.quality_runs` el total de registros, conformes, rechazados, porcentaje de calidad y frescura en minutos, visible en el panel administrativo.

---

## 🔒 5. Seguridad en Profundidad y Principio de Mínimo Privilegio (POLP)

### Aislamiento Físico en PostgreSQL:
| Rol | Permisos | Prohibiciones Clave |
| :--- | :--- | :--- |
| `role_ingestion` | `INSERT, SELECT` sobre `raw.usgs_events` | Cero acceso a `staging` y `curated`. |
| `role_transformation` | `SELECT` en `raw`; `SELECT, INSERT, UPDATE, DELETE` en `staging` y `curated` | Cero DDL, prohibido modificar esquemas. |
| `role_api_reader` | `SELECT` sobre tablas y vistas de `curated` | Prohibida toda escritura; cero acceso a `raw` y `staging`. |
| `role_chat_reader` | `SELECT` exclusivamente sobre `curated.v_events_chat` | `read_only = on`, `timeout = 3000ms`. Prohibido acceso a tablas base. |
| `role_api_logger` | `INSERT` en `curated.ai_runs` y `SELECT (run_id)` | Cero lectura sobre eventos o cuarentena. |

### Medidas Complementarias:
- **Cero Secretos:** Escaneo con Gitleaks y Bandit con **0 hallazgos críticos**. `.env` jamás se commitea.
- **Autenticación Stateless JWT:** Roles `admin` y `viewer` en memoria con hashing `bcrypt`, sin persistir credenciales en tablas expuestas.

---

## 🤖 6. Automatización con IA Confiable (Proof of Grounding)

### ¿Cómo se eliminan las alucinaciones del LLM?
1. **Text-to-SQL Estrictamente Acotado:**  
   El LLM no responde memorizando datos. Su única labor es convertir la pregunta del usuario en un `SELECT` sobre la vista desnormalizada `curated.v_events_chat`.
2. **Guardrail Sintáctico AST/Regex:**  
   Antes de llegar a la base de datos, la consulta pasa por un validador que rechaza cualquier palabra reservada DDL/DML (`DROP`, `INSERT`, `UPDATE`, `ALTER`, `EXEC`, `--`, `;`).
3. **Ejecución Bajo `role_chat_reader`:**  
   La consulta se ejecuta con la sesión en solo lectura forzada (`default_transaction_read_only = on`) y un timeout estricto de 3 segundos.
4. **Validación Numérica de Salida:**  
   El código calcula los valores matemáticos de las filas retornadas y valida que el texto generado por el modelo coincida al 100%. En la interfaz se muestra la insignia de **Proof of Grounding**, la consulta SQL generada y la latencia.
5. **Auditoría de IA:**  
   Cada inferencia se registra en `curated.ai_runs` con modelo, tokens, latencia, costo estimado y puntaje de fidelidad.
6. **Fallback Resiliente:**  
   Soporte para Ollama local (`qwen2.5-coder:1.5b`) y fallback inmediato a proveedor cloud vía Groq (`llama-3.1-8b-instant`).

---

## 🖥️ 7. Plataforma Web y Consumo en Tiempo Real

1. **Cockpit 3D Globe:** Visualización esférica en WebGL con mapa de relieve satelital, estrellas cósmicas y balizas láser verticales. Filtro dinámico acoplado (24h: 199 sismos, 7d: 1,536 sismos, 30d: 2,462 sismos).
2. **Dashboard Analítico:** Gráficos Recharts con evolución acumulada mensual YTD (2026), distribución Gutenberg-Richter por magnitud y ranking geográfico.
3. **Streaming SSE en Tiempo Real:** Endpoint `/api/stream` con `fetch()` y `ReadableStream` para actualización instantánea sin recarga, manteniendo autenticación Bearer JWT.
4. **Boletín Oficial de Sismicidad Global:** Vista de reportes diseñada como documento ejecutivo formal con métricas consolidadas, estado de validación anti-alucinaciones y exportación en CSV y PDF.
5. **Panel de Cuarentena:** Vista en tarjetas de 2 columnas con diagnóstico en lenguaje natural de cada regla fallida y botón reactivo para disparar backfill de 7 días vía Airflow REST API.

---

## 🎤 8. Preguntas Típicas del Jurado y Respuestas Modelo

### P: "¿Qué pasaría si la API de USGS cambia el formato de su GeoJSON de repente?"
> **R:** *"El Circuit Breaker de nivel lote de Pandera detectará inmediatamente la incompatibilidad de esquema. La tarea del DAG fallará de forma limpia, emitiendo una alerta estructurada. Ningún dato inválido o a medio procesar entrará a Silver ni Gold, protegiendo la integridad de la plataforma."*

### P: "¿Por qué no utilizaron WebSockets en lugar de Server-Sent Events (SSE)?"
> **R:** *"Porque el monitoreo sísmico es un patrón de publicación unidireccional (del servidor a los clientes). SSE opera sobre HTTP estándar, atraviesa proxies y firewalls sin requerir puertos especiales, reconecta automáticamente de forma nativa y es mucho más ligero en memoria para el servidor que mantener conexiones WebSocket abiertas."*

### P: "¿Cómo justifican el uso de un modelo local pequeño como `qwen2.5-coder:1.5b` frente a GPT-4?"
> **R:** *"Ejecutamos un benchmark documentado en el README. Al restringir el problema a Text-to-SQL sobre una vista única (`curated.v_events_chat`), `qwen2.5-coder:1.5b` alcanzó un 100% de precisión sintáctica con latencia media de 2.3 segundos en CPU, cero costo de API cloud y garantizando soberanía total de datos en entornos aislados o sin conexión a internet."*

### P: "¿Qué cambios específicos harían para llevar esto a producción masiva?"
> **R:** *"A escala petabyte, activaríamos DuckDB o Trino sobre los Parquets de MinIO para consultas analíticas sin tocar la base relacional, Apache Spark/Flink para streaming distribuido con ventanas de tiempo sobre sensores IoT, y OpenMetadata para gobernanza centralizada y linaje columna por columna."*
