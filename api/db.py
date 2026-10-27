import logging
from contextlib import contextmanager
import psycopg2
from psycopg2.extras import RealDictCursor
from config import settings

logger = logging.getLogger("sismowatch.api.db")

def _get_connection(user: str, password: str, statement_timeout_ms: int = 5000):
    return psycopg2.connect(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        dbname=settings.DB_NAME,
        user=user,
        password=password,
        options=f"-c statement_timeout={statement_timeout_ms}"
    )

@contextmanager
def get_api_reader_conn():
    """Connection using role_api_reader (SELECT only on curated)."""
    conn = _get_connection(
        user=settings.DB_USER_API_READER,
        password=settings.DB_PASS_API_READER,
        statement_timeout_ms=5000
    )
    try:
        yield conn
    finally:
        conn.close()

@contextmanager
def get_chat_reader_conn():
    """Connection using role_chat_reader (SELECT only on curated.v_events_chat, read-only=on, timeout=3000ms)."""
    conn = _get_connection(
        user=settings.DB_USER_CHAT_READER,
        password=settings.DB_PASS_CHAT_READER,
        statement_timeout_ms=3000
    )
    try:
        yield conn
    finally:
        conn.close()

@contextmanager
def get_api_logger_conn():
    """Connection using role_api_logger (INSERT on curated.ai_runs)."""
    conn = _get_connection(
        user=settings.DB_USER_API_LOGGER,
        password=settings.DB_PASS_API_LOGGER,
        statement_timeout_ms=5000
    )
    try:
        yield conn
    finally:
        conn.close()
