# SismoWatch - Plataforma de Monitoreo Sísmico Global en Tiempo Real

[![Airflow](https://img.shields.io/badge/Airflow-2.10-017CEE?logo=apache-airflow&logoColor=white)](https://airflow.apache.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Ollama](https://img.shields.io/badge/Ollama-Local_Phi--3-000000?logo=ollama&logoColor=white)](https://ollama.ai/)
[![Pandera](https://img.shields.io/badge/Data_Quality-Pandera-FF6F00)](https://pandera.readthedocs.io/)
[![Security](https://img.shields.io/badge/Security-Gitleaks_%26_Bandit-brightgreen)](https://github.com/gitleaks/gitleaks)

SismoWatch es una solución de ingeniería de datos y automatización con IA diseñada para procesar, auditar y visualizar eventos sísmicos mundiales en tiempo casi real a partir del catálogo público de la **USGS (United States Geological Survey)**.

---

## 🏛️ Arquitectura del Sistema (Patrón Medallion)

El pipeline implementa una arquitectura **Medallion (Bronze $\rightarrow$ Silver $\rightarrow$ Gold)** sobre PostgreSQL:

* **Bronze (`raw.usgs_events`):** Ingesta cruda inmutable (`JSONB` + hash SHA-256) con política append-only (`ON CONFLICT DO NOTHING`).
* **Silver (`staging`):** Tipado estricto y separación de calidad. Registros válidos a `staging.events`; registros corruptos a `staging.quarantine` con causa documentada mediante validación Pandera en dos niveles (lote y fila).
* **Gold (`curated`):** Estado actual consolidado (`curated.earthquakes`) mediante upsert condicional (`updated_time`), enriquecido con `region` y `magnitude_class`. Vistas de consumo para KPIs, series temporales, cuarentena de admin y vista restringida para el chat de IA.

Para detalles exhaustivos, consulta [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

---

## 🚀 Puesta en Marcha Rápida (Quickstart)

### Requisitos Previos
* Docker Engine 24+ y Docker Compose v2+
* Python 3.11+
* Ollama en el host con el modelo `phi3:latest` descargado (`ollama run phi3`)

### 1. Clonar y Configurar Entorno
```bash
cp .env.example .env
# Generar clave Fernet para Airflow y asignarla en .env
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 2. Levantar Todo el Stack
```bash
docker compose up -d
```

### 3. Servicios y Puertos
| Servicio | URL | Credenciales por Defecto |
| :--- | :--- | :--- |
| **Plataforma Web (React)** | http://localhost:3000 | `admin` / `admin_sismowatch_2026_pwd`<br>`viewer` / `viewer_sismowatch_2026_pwd` |
| **API REST (FastAPI / Swagger)** | http://localhost:8000/docs | Protegido con JWT (`/auth/login`) |
| **Apache Airflow Webserver** | http://localhost:8080 | `sismo_admin` / `sismo_admin_secure_pwd_change_me` |
| **PostgreSQL 16** | `localhost:5432` | Base de datos: `sismowatch_db` |

---

## 🔒 Seguridad y Privilegios
* **Cero Secretos:** Repositorio auditado y verificado con Gitleaks.
* **Mínimo Privilegio (POLP):**
  * `role_ingestion`: Solo INSERT/SELECT en `raw.usgs_events`.
  * `role_transformation`: SELECT en raw; lectura y escritura en staging y curated.
  * `role_api_reader`: Solo SELECT en tablas y vistas de `curated`.
  * `role_chat_reader`: Solo SELECT en `curated.v_events_chat` con `read_only=on` y timeout de 3s.
  * `role_api_logger`: Solo INSERT en `curated.ai_runs`.
* **RBAC en Memoria:** Usuarios autenticados con JWT y contraseñas hasheadas con `bcrypt`.

---

## 🧪 Pruebas Automatizadas y Auditoría
```bash
# Correr suite de pruebas con pytest
pytest

# Escaneo de secretos con Gitleaks
gitleaks detect -v

# Análisis estático de código Python con Bandit
bandit -r api/ airflow/
```
