# SismoWatch - Contexto Integral del Proyecto y Guía de Sustentación

**Documento de Inducción Técnica, Estado Final y Guía para Sustentación Oral**  
**Fecha:** 27 de Octubre de 2026 | **Estado del Proyecto:** 100% COMPLETADO Y VERIFICADO (34/34 Tests Passing)

---

## 1. Visión General del Proyecto
**SismoWatch** convierte el feed público del **USGS (United States Geological Survey)** (`all_hour.geojson` y API histórica) en un producto de datos analítico y en tiempo casi real con arquitectura Medallion, seguridad de mínimo privilegio (POLP) en PostgreSQL, IA local Grounded sin alucinaciones numéricas y plataforma web interactiva.

---

## 2. Estado Final de Implementación (Todas las Fases Completadas)

* **Infraestructura Activa en Docker Compose (`docker compose up -d`):**
  * `sismowatch-postgres`: PostgreSQL 16 con esquemas `raw`, `staging` y `curated`, y metadata de Airflow en `airflow_db`.
  * `sismowatch-airflow-webserver` y `sismowatch-airflow-scheduler`: Airflow 2.10 en LocalExecutor con 4 DAGs activos.
  * `sismowatch-api`: FastAPI con JWT RBAC, endpoints Medallion, SSE Streaming en `/api/stream` y agente Text-to-SQL.
  * `sismowatch-web`: Nginx Alpine sirviendo el bundle de React 18 + Vite + Tailwind CSS + Leaflet Maps + Recharts con reverse proxy.
  * Ollama local corriendo en el host en puerto 11434 (`qwen2.5-coder:1.5b`).

* **Pipeline de Datos (Airflow):**
  * `usgs_ingest_feed`: Ingesta Bronze cada 5 minutos con deduplicación por hash SHA-256 (`ON CONFLICT DO NOTHING`).
  * `usgs_transform_quality`: Activado automáticamente por Dataset de Airflow; ejecuta calidad Pandera en dos niveles y upsert a Gold.
  * `usgs_historical_backfill`: Recuperación histórica bajo demanda (Admin).
  * `usgs_daily_report_anomaly`: Genera reporte ejecutivo ministerial a las 06:00 UTC y detecta anomalías regionales con Z-score ($z \ge 2.0$).

* **Seguridad y Mínimo Privilegio (POLP):**
  * `role_ingestion`: Solo INSERT/SELECT en `raw.usgs_events`.
  * `role_transformation`: SELECT en `raw`; lectura y escritura en `staging` y `curated`.
  * `role_api_reader`: Solo SELECT en `curated.*` y `curated.v_quarantine`. Cero acceso a `raw` y `staging`.
  * `role_chat_reader`: Solo SELECT en `curated.v_events_chat`, `read_only = on`, `statement_timeout = 3000ms`.
  * `role_api_logger`: Solo INSERT en `curated.ai_runs`.

---

## 3. Elementos Diferenciadores Clave

1. **Radio de Impacto Superficial PGA (Peak Ground Acceleration):**
   * Fórmula geofísica: $R = 10^{0.43 \cdot M - 0.005 \cdot h}$
   * Proyectado en el mapa Leaflet como círculos concéntricos dinámicos con borde punteado alrededor de cada epicentro.
2. **Proof of Grounding (Cero Alucinaciones):**
   * El LLM traduce la pregunta a SQL puro sobre `curated.v_events_chat`.
   * Un guardrail AST/regex bloquea sentencias destructivas (`DROP`, `DELETE`, etc.).
   * Se ejecuta bajo `role_chat_reader` (restringido en motor PostgreSQL).
   * La respuesta en español se sintetiza únicamente con los datos recuperados y se expone la insignia de verificación en la UI.
3. **Circuit Breaker y SLA de Frescura:**
   * Pandera valida a nivel lote: si el feed tiene latencia > 120 min o volumen anómalo, la tarea falla y detiene el lote.
   * Pandera valida a nivel fila (`lazy=True`): registros corruptos se aíslan en `staging.quarantine` sin detener los válidos.

---

## 4. Guía para la Sustentación Oral (Preguntas Probables y Respuestas)

### P1: ¿Por qué eligieron arquitectura Medallion en lugar de Lambda?
**Respuesta:**  
*Lambda introduce una capa Batch (lenta pero completa) y una capa Speed (rápida pero aproximada), requiriendo unir vistas y duplicar código. Para un volumen de miles de eventos al día y latencia de 5 minutos, Medallion es la arquitectura estándar de la industria: Bronze garantiza auditoría inmutable, Silver asegura calidad y cuarentena sin ensuciar el histórico, y Gold ofrece vistas optimizadas sin sobrecargar la infraestructura.*

### P2: ¿Cómo evitan que el modelo de IA invente números?
**Respuesta:**  
*Aplicamos el patrón Grounded Text-to-SQL con Proof of Grounding. El modelo no responde desde su memoria preentrenada, sino que genera una consulta SQL restringida a la vista `curated.v_events_chat`. Validamos la consulta con AST/regex antes de ejecutarla, la corremos con un usuario de base de datos con `default_transaction_read_only = on` y `statement_timeout = 3000ms`, y el modelo final solo redacta la explicación a partir del JSON devuelto por la base de datos.*

### P3: ¿Por qué seleccionaron `qwen2.5-coder:1.5b` en lugar de `phi3` o `llama3.2`?
**Respuesta:**  
*Ejecutamos un benchmark formal en este hardware (Intel Core i5-12400, sin GPU dedicada):*
* *`qwen2.5-coder:1.5b` obtuvo 100% de precisión en SQL, 100% en exactitud numérica, latencia de 2.32s y consumió solo 986 MB de RAM.*
* *`phi3:latest` (3.8B) tardó más de 5.3s por consulta y sobrecargó la CPU.*
* *`llama3.2:3b` tuvo alucinaciones en el 40% de las cifras en español.*

### P4: ¿Qué pasa si la API de USGS se cae o el modelo local está ocupado?
**Respuesta:**  
*Implementamos el principio de Resilient Error Handling (RFC 7807):*
* *Para USGS: reintentos exponenciales en Airflow (retries=3) y fixture local de emergencia.*
* *Para el LLM: timeout de 60s y fallback determinista que genera el informe ejecutivo usando las métricas exactas calculadas previamente en SQL.*
* *Para el chat: soporte dual entre Ollama Local y Groq Cloud.*
