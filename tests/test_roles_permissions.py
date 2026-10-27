"""
Test Suite: Roles and Permissions (Principle of Least Privilege - POLP)
Verifies what each database role CAN and CANNOT do according to SismoWatch security design.
"""
import os
import pytest
import psycopg2
from psycopg2 import errors

DB_HOST = os.getenv("POSTGRES_HOST", "localhost")
DB_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
DB_NAME = os.getenv("POSTGRES_DB", "sismowatch_db")

def get_connection(user: str, password: str):
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=user,
        password=password
    )

class TestIngestionRole:
    """role_ingestion: INSERT and SELECT ONLY in raw.usgs_events."""
    USER = "user_ingestion"
    PWD = "ingestion_secret_pwd_2026"

    def test_can_insert_and_select_raw(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO raw.usgs_events (event_id, payload, payload_hash, source_feed)
            VALUES ('test_event_perm_1', '{"mag": 4.5}'::jsonb, 'hash_test_1', 'test_feed')
            ON CONFLICT (event_id, payload_hash) DO NOTHING;
        """)
        conn.commit()

        cur.execute("SELECT event_id FROM raw.usgs_events WHERE event_id = 'test_event_perm_1';")
        row = cur.fetchone()
        assert row is not None
        assert row[0] == 'test_event_perm_1'
        cur.close()
        conn.close()

    def test_cannot_access_staging(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        with pytest.raises(psycopg2.Error) as exc_info:
            cur.execute("SELECT * FROM staging.events;")
        assert "permission denied" in str(exc_info.value).lower()
        conn.close()

    def test_cannot_access_curated(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        with pytest.raises(psycopg2.Error) as exc_info:
            cur.execute("SELECT * FROM curated.earthquakes;")
        assert "permission denied" in str(exc_info.value).lower()
        conn.close()


class TestTransformationRole:
    """role_transformation: SELECT in raw; read/write in staging and curated."""
    USER = "user_transformation"
    PWD = "transformation_secret_pwd_2026"

    def test_can_read_raw_and_write_staging_curated(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        # Read raw
        cur.execute("SELECT count(*) FROM raw.usgs_events;")
        count = cur.fetchone()[0]
        assert count >= 0

        # Write staging
        cur.execute("""
            INSERT INTO staging.events (
                event_id, magnitude, mag_type, place, event_time, updated_time,
                longitude, latitude, depth_km, tsunami_alert, significance, status, event_type
            ) VALUES (
                'test_stg_1', 3.2, 'ml', 'Test Place', NOW(), NOW(),
                -120.5, 36.2, 10.0, false, 150, 'reviewed', 'earthquake'
            ) ON CONFLICT (event_id) DO NOTHING;
        """)

        # Write curated
        cur.execute("""
            INSERT INTO curated.earthquakes (
                event_id, magnitude, magnitude_class, mag_type, place, region,
                event_time, updated_time, longitude, latitude, depth_km,
                tsunami_alert, significance, status, event_type
            ) VALUES (
                'test_stg_1', 3.2, 'Minor', 'ml', 'Test Place', 'Test Region',
                NOW(), NOW(), -120.5, 36.2, 10.0,
                false, 150, 'reviewed', 'earthquake'
            ) ON CONFLICT (event_id) DO UPDATE SET updated_time = EXCLUDED.updated_time;
        """)
        conn.commit()
        cur.close()
        conn.close()


class TestApiReaderRole:
    """role_api_reader: SELECT ONLY in curated (tables and views). CERO access to raw and staging."""
    USER = "user_api_reader"
    PWD = "api_reader_secret_pwd_2026"

    def test_can_select_curated_tables_and_views(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM curated.earthquakes;")
        assert cur.fetchone()[0] >= 0

        cur.execute("SELECT * FROM curated.v_kpis_24h;")
        assert cur.fetchone() is not None

        cur.execute("SELECT count(*) FROM curated.v_quarantine;")
        assert cur.fetchone()[0] >= 0
        cur.close()
        conn.close()

    def test_cannot_read_raw(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        with pytest.raises(psycopg2.Error) as exc_info:
            cur.execute("SELECT * FROM raw.usgs_events;")
        assert "permission denied" in str(exc_info.value).lower()
        conn.close()

    def test_cannot_read_staging_directly(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        with pytest.raises(psycopg2.Error) as exc_info:
            cur.execute("SELECT * FROM staging.quarantine;")
        assert "permission denied" in str(exc_info.value).lower()
        conn.close()

    def test_cannot_write_in_curated(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        with pytest.raises(psycopg2.Error) as exc_info:
            cur.execute("DELETE FROM curated.earthquakes WHERE event_id = 'nonexistent';")
        assert "permission denied" in str(exc_info.value).lower()
        conn.close()


class TestChatReaderRole:
    """role_chat_reader: SELECT ONLY on curated.v_events_chat with read-only transaction."""
    USER = "user_chat_reader"
    PWD = "chat_reader_secret_pwd_2026"

    def test_can_select_v_events_chat(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM curated.v_events_chat;")
        assert cur.fetchone()[0] >= 0
        cur.close()
        conn.close()

    def test_cannot_select_curated_earthquakes_directly(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        with pytest.raises(psycopg2.Error) as exc_info:
            cur.execute("SELECT * FROM curated.earthquakes;")
        assert "permission denied" in str(exc_info.value).lower()
        conn.close()

    def test_cannot_write_due_to_read_only_and_permissions(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        with pytest.raises(psycopg2.Error) as exc_info:
            cur.execute("INSERT INTO curated.ai_runs (run_type, model_name, latency_ms, success) VALUES ('chat', 'phi3', 100, true);")
        # Should fail either due to read-only transaction or lack of permission
        msg = str(exc_info.value).lower()
        assert "read-only" in msg or "permission denied" in msg
        conn.close()


class TestApiLoggerRole:
    """role_api_logger: INSERT ONLY in curated.ai_runs."""
    USER = "user_api_logger"
    PWD = "api_logger_secret_pwd_2026"

    def test_can_insert_ai_runs(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO curated.ai_runs (run_type, model_name, latency_ms, success)
            VALUES ('chat_query', 'phi3:latest', 250, true)
            RETURNING run_id;
        """)
        conn.commit()
        run_id = cur.fetchone()[0]
        assert run_id > 0
        cur.close()
        conn.close()

    def test_cannot_select_earthquakes(self):
        conn = get_connection(self.USER, self.PWD)
        cur = conn.cursor()
        with pytest.raises(psycopg2.Error) as exc_info:
            cur.execute("SELECT * FROM curated.earthquakes;")
        assert "permission denied" in str(exc_info.value).lower()
        conn.close()
