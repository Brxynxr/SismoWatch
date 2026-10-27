import os
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # App
    APP_NAME: str = "SismoWatch API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://127.0.0.1:3000", "*"]

    # Database
    DB_HOST: str = os.getenv("POSTGRES_HOST", "localhost")
    DB_PORT: int = int(os.getenv("POSTGRES_PORT", "5432"))
    DB_NAME: str = os.getenv("POSTGRES_DB", "sismowatch_db")

    # POLP DB Credentials
    DB_USER_API_READER: str = os.getenv("DB_API_READER_USER", "user_api_reader")
    DB_PASS_API_READER: str = os.getenv("DB_API_READER_PASSWORD", "api_reader_secret_pwd_2026")

    DB_USER_CHAT_READER: str = os.getenv("DB_CHAT_READER_USER", "user_chat_reader")
    DB_PASS_CHAT_READER: str = os.getenv("DB_CHAT_READER_PASSWORD", "chat_reader_secret_pwd_2026")

    DB_USER_API_LOGGER: str = os.getenv("DB_API_LOGGER_USER", "user_api_logger")
    DB_PASS_API_LOGGER: str = os.getenv("DB_API_LOGGER_PASSWORD", "api_logger_secret_pwd_2026")

    # Security & JWT
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "sismowatch-super-secret-jwt-key-minimum-32-chars-long!")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours for evaluation session

    # In-memory users for RBAC
    ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "admin")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "Admin123!")

    VIEWER_USERNAME: str = os.getenv("VIEWER_USERNAME", "viewer")
    VIEWER_PASSWORD: str = os.getenv("VIEWER_PASSWORD", "Viewer123!")

    # Local AI (Ollama)
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:1.5b")

    # Cloud AI (Groq - Optional)
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")

    # Airflow Trigger API
    AIRFLOW_URL: str = os.getenv("AIRFLOW_URL", "http://localhost:8080")
    AIRFLOW_USER: str = os.getenv("AIRFLOW_ADMIN_USER", os.getenv("AIRFLOW_API_USER", "sismo_admin"))
    AIRFLOW_PASSWORD: str = os.getenv("AIRFLOW_ADMIN_PASSWORD", os.getenv("AIRFLOW_API_PASSWORD", "sismo_admin_secure_pwd_2026"))

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
