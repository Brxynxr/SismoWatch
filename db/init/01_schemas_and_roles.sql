-- ==============================================================================
-- SismoWatch - 01_schemas_and_roles.sql
-- Inicialización de Schemas Medallion y Roles de Mínimo Privilegio (POLP)
-- ==============================================================================

-- 1. Crear base de datos para Airflow si no existe (aislamiento de metadata)
SELECT 'CREATE DATABASE airflow_db'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'airflow_db')\gexec

-- 2. Conectarse a sismowatch_db y configurar schemas
\c sismowatch_db

-- Eliminar permisos públicos por defecto por seguridad
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Crear Schemas Medallion
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS curated;

-- 3. Crear Roles de Base de Datos
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'role_ingestion') THEN
        CREATE ROLE role_ingestion;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'role_transformation') THEN
        CREATE ROLE role_transformation;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'role_api_reader') THEN
        CREATE ROLE role_api_reader;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'role_chat_reader') THEN
        CREATE ROLE role_chat_reader;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'role_api_logger') THEN
        CREATE ROLE role_api_logger;
    END IF;
END $$;

-- Configurar restricciones duras a nivel de sesión para role_chat_reader
ALTER ROLE role_chat_reader SET default_transaction_read_only = on;
ALTER ROLE role_chat_reader SET statement_timeout = '3000ms';

-- 4. Crear Usuarios y Asignar Roles
DO $$
BEGIN
    -- user_ingestion
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'user_ingestion') THEN
        CREATE USER user_ingestion WITH PASSWORD 'ingestion_secret_pwd_2026';
    END IF;
    GRANT role_ingestion TO user_ingestion;

    -- user_transformation
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'user_transformation') THEN
        CREATE USER user_transformation WITH PASSWORD 'transformation_secret_pwd_2026';
    END IF;
    GRANT role_transformation TO user_transformation;

    -- user_api_reader
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'user_api_reader') THEN
        CREATE USER user_api_reader WITH PASSWORD 'api_reader_secret_pwd_2026';
    END IF;
    GRANT role_api_reader TO user_api_reader;

    -- user_chat_reader
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'user_chat_reader') THEN
        CREATE USER user_chat_reader WITH PASSWORD 'chat_reader_secret_pwd_2026';
    END IF;
    GRANT role_chat_reader TO user_chat_reader;

    -- user_api_logger
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'user_api_logger') THEN
        CREATE USER user_api_logger WITH PASSWORD 'api_logger_secret_pwd_2026';
    END IF;
    GRANT role_api_logger TO user_api_logger;
END $$;

-- 5. Concesión de Permisos a nivel de Schema (POLP)
-- Revocar accesos por defecto
REVOKE ALL ON SCHEMA raw FROM PUBLIC;
REVOKE ALL ON SCHEMA staging FROM PUBLIC;
REVOKE ALL ON SCHEMA curated FROM PUBLIC;

-- USAGE en Schemas según rol
GRANT USAGE ON SCHEMA raw TO role_ingestion;
GRANT USAGE ON SCHEMA raw, staging, curated TO role_transformation;
GRANT USAGE ON SCHEMA curated TO role_api_reader;
GRANT USAGE ON SCHEMA curated TO role_chat_reader;
GRANT USAGE ON SCHEMA curated TO role_api_logger;

-- Permisos sobre secuencias (para inserciones con IDs autoincrementales)
ALTER DEFAULT PRIVILEGES IN SCHEMA raw GRANT USAGE, SELECT ON SEQUENCES TO role_ingestion;
ALTER DEFAULT PRIVILEGES IN SCHEMA staging GRANT USAGE, SELECT ON SEQUENCES TO role_transformation;
ALTER DEFAULT PRIVILEGES IN SCHEMA curated GRANT USAGE, SELECT ON SEQUENCES TO role_transformation;
ALTER DEFAULT PRIVILEGES IN SCHEMA curated GRANT USAGE, SELECT ON SEQUENCES TO role_api_logger;
