# AGENTS.md - Guía de Operación y Colaboración de Agentes de IA

**Proyecto:** SismoWatch (Pipeline de Datos E2E, Medallion Architecture, Local LLM & Web Platform)  
**Versión:** 2.0  
**Audiencia:** Antigravity AI Agents & Desarrolladores  

---

## 🎯 Misión del Proyecto
Construir una solución de nivel empresarial para el monitoreo sísmico global en tiempo casi real a partir del catálogo público de la **USGS (United States Geological Survey)**. El sistema extrae, audita, transforma y expone datos con **arquitectura Medallion**, **cero secretos**, **mínimo privilegio en base de datos (POLP)**, **IA local sin alucinaciones (Grounded Text-to-SQL y reportes)** y una **plataforma web moderna (FastAPI + React/Vite)**.

---

## 🛠️ Stack y Configuración de Infraestructura

* **Orquestador:** Apache Airflow 2.10 en modo `LocalExecutor` sobre PostgreSQL (Webserver en `:8080`, Scheduler activo).
* **Almacenamiento:** PostgreSQL 16 (`localhost:5432` / container `postgres` en red `sismowatch_network`).
  * Base de datos operacional: `sismowatch_db` con esquemas `raw` (Bronze), `staging` (Silver) y `curated` (Gold).
  * Base de datos de metadata de Airflow: `airflow_db`.
* **Motor de IA Local:** Ollama corriendo nativamente en el host (`http://host.docker.internal:11434` desde Docker, `http://localhost:11434` en local).
* **Backend:** FastAPI (Python 3.11+, puerto `:8000`), autenticación JWT en memoria para `viewer` y `admin`, stream SSE en `/api/stream`.
* **Frontend:** React 18 + Vite + Tailwind CSS + Leaflet (mapas) + Recharts (puerto `:3000`).

---

## 🛡️ Roles y Mínimo Privilegio (POLP) en PostgreSQL

Cualquier agente que trabaje en este repositorio debe respetar estrictamente el principio de mínimo privilegio:

| Rol de Base de Datos | Usuario | Permisos Permitidos | Lo que tiene PROHIBIDO |
| :--- | :--- | :--- | :--- |
| **`role_ingestion`** | `user_ingestion` | `INSERT, SELECT` sobre `raw.usgs_events` | Cero acceso a `staging` y `curated`. |
| **`role_transformation`** | `user_transformation` | `SELECT` en `raw`; `SELECT, INSERT, UPDATE, DELETE` en `staging` y `curated`. | Modificar esquemas DDL o acceder a tablas de sistema. |
| **`role_api_reader`** | `user_api_reader` | `SELECT` sobre tablas y vistas de `curated`. | Cero acceso a `raw` y `staging`; prohibida toda escritura (`INSERT, UPDATE, DELETE`). |
| **`role_chat_reader`** | `user_chat_reader` | `SELECT` **exclusivamente** sobre `curated.v_events_chat`. | `default_transaction_read_only = on`, `statement_timeout = 3000ms`. Prohibido cualquier acceso a tablas base u otros schemas. |
| **`role_api_logger`** | `user_api_logger` | `INSERT` en `curated.ai_runs` y `SELECT (run_id)`. | Cero lectura sobre eventos o cuarentena. |

---

## 🧰 Skills Recomendadas y Protocolos de Trabajo

Para maximizar la calidad y evitar regresiones o alucinaciones, activa y sigue estas skills:

1. **`test-driven-development`:** Escribe pruebas unitarias antes o simultáneamente con el código. Cada funcionalidad debe contar con tests pasando antes de realizar un commit.
2. **`systematic-debugging`:** Ante cualquier error en contenedores, conexiones de base de datos o APIs, inspecciona logs (`docker logs`, `pytest -vv`) y aísla la causa raíz antes de proponer cambios.
3. **`verification-before-completion`:** **Regla de oro:** Nunca asumas que algo funciona sin ejecutar comandos reales de verificación (`pytest`, `curl`, `docker ps`) e inspeccionar sus salidas.
4. **`resilient-error-handling`:** En llamadas a la API de USGS y al LLM local, implementa siempre reintentos con backoff exponencial, timeouts estrictos y mecanismos de fallback deterministas para no dejar la pantalla en blanco.
5. **`clean-architecture-patterns`:** Mantén la estricta separación de capas (Bronze $\rightarrow$ Silver $\rightarrow$ Gold) y no introduzcas lógica pesada de transformación dentro de los archivos DAG de Airflow (delega a `airflow/include/`).
6. **`secure-coding-owasp`:** Sanitiza parámetros de entrada, valida sentencias SQL mediante AST/regex antes de ejecutarlas y garantiza que ningún secreto se escriba en código o commits.

---

## 🔌 Servidores MCP Clave

* **`context7`:** Utilízalo para consultar documentación oficial y sintaxis actualizada de bibliotecas críticas (`FastAPI`, `Pandera`, `Pydantic v2`, `Apache Airflow`, `Leaflet`).
* **`playwright`:** Empléalo para verificar el comportamiento real del frontend web en el navegador, validando estados de carga, mapa de eventos, streaming en tiempo real y flujo de login sin interacción manual.

---

## 📜 Reglas de Commits y Seguridad

* **Convención:** `tipo(alcance): resumen corto en imperativo`.
* **Cuerpo Obligatorio:** Explica claramente:
  1. **QUÉ SE HIZO**
  2. **POR QUÉ SE ELIGIÓ ASÍ** (Decisión técnica defendible)
  3. **CÓMO SE VERIFICÓ** (Comandos ejecutados y resultados)
* **Gitleaks:** Antes de commitear, ejecuta siempre `~/.local/bin/gitleaks protect -v --staged`. El archivo `.env` real **NUNCA** se commitea.
