import os
import re
import time
import json
import logging
from typing import Dict, Any, Tuple, Optional, List
import requests
from psycopg2.extras import RealDictCursor
from config import settings
from db import get_chat_reader_conn, get_api_logger_conn

logger = logging.getLogger("sismowatch.api.ai")

PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "..", "prompts")

def load_prompt_template(filename: str, default_content: str) -> str:
    path = os.path.join(PROMPTS_DIR, filename)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read().strip()
        except Exception as e:
            logger.warning("Failed to load prompt template from %s: %s", path, e)
    return default_content.strip()

def sanitize_input_text(text: Any, max_chars: int = 500) -> str:
    """Sanitizes external user/feed text to avoid prompt injection."""
    if not text:
        return ""
    cleaned = re.sub(r"[\r\n]+", " ", str(text))
    cleaned = re.sub(r"[{}\[\]<>]", "", cleaned)
    cleaned = re.sub(r"(?i)(ignore previous instructions|system prompt|assistant:)", "", cleaned)
    return cleaned[:max_chars].strip()

SQL_GUARDRAIL_PATTERN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|EXEC|EXECUTE)\b",
    re.IGNORECASE
)

V_EVENTS_CHAT_SCHEMA = """
Vista de solo lectura permitida: curated.v_events_chat
Columnas disponibles (ÚNICAMENTE ESTAS):
- event_id (TEXT): Identificador único del sismo.
- magnitude (FLOAT): Magnitud en escala Richter/Momento.
- magnitude_class (TEXT): Valores exactos en inglés: 'Micro' (<2.0), 'Minor' (2.0-3.9), 'Light' (4.0-4.9), 'Moderate' (5.0-5.9), 'Strong' (6.0-6.9), 'Major' (7.0-7.9), 'Great' (>=8.0).
- place (TEXT): Descripción del lugar (ej. '13 km N of Borrego Springs, CA').
- region (TEXT): Región geográfica normalizada (ej. 'California', 'Chile', 'Alaska').
- impact_radius_km (FLOAT): Radio estimado de afectación superficial en km.
- event_time (TIMESTAMPTZ): Fecha y hora UTC del sismo.
- depth_km (FLOAT): Profundidad en kilómetros.
- tsunami_alert (BOOLEAN): true si generó alerta de tsunami, false si no.
- status (TEXT): 'reviewed' o 'automatic'.
"""

def validate_sql_query(sql: str) -> Tuple[bool, str]:
    """
    Validates that the generated SQL:
    1. Starts with SELECT.
    2. Does NOT contain DML/DDL forbidden keywords.
    3. References only curated.v_events_chat or v_events_chat.
    """
    cleaned = sql.strip().strip(";").strip()
    if not cleaned.upper().startswith("SELECT"):
        return False, "La consulta no comienza con SELECT."

    if SQL_GUARDRAIL_PATTERN.search(cleaned):
        return False, "La consulta contiene palabras clave prohibidas de modificación o DDL."

    # Verify table name
    allowed_tables = ["v_events_chat", "curated.v_events_chat"]
    has_allowed_table = any(t in cleaned.lower() for t in allowed_tables)
    if not has_allowed_table:
        return False, "La consulta solo tiene permiso de consultar la vista 'curated.v_events_chat'."

    return True, ""

def execute_chat_sql(sql: str) -> Tuple[List[Dict[str, Any]], float]:
    """Executes query strictly with user_chat_reader (read-only=on, timeout=3000ms)."""
    start = time.time()
    with get_chat_reader_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql)
            rows = [dict(r) for r in cur.fetchall()]
    elapsed = time.time() - start
    return rows, elapsed

def log_ai_run(
    run_type: str,
    prompt: str,
    model_used: str,
    tokens: int,
    latency: float,
    status_str: str,
    error: Optional[str] = None
):
    """Logs AI execution into curated.ai_runs using role_api_logger."""
    try:
        with get_api_logger_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO curated.ai_runs 
                    (run_type, model_name, prompt_tokens_estimated, completion_tokens_estimated, latency_ms, estimated_cost_usd, success, error_message)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
                """, (
                    run_type,
                    model_used,
                    max(1, tokens // 2),
                    max(1, tokens // 2),
                    int(latency * 1000),
                    0.0,
                    (status_str == "success"),
                    error
                ))
                conn.commit()
    except Exception as e:
        logger.error("Failed to log AI run: %s", e)

def query_llm(prompt: str, system_prompt: str, provider: str = "local", max_tokens: int = 1000) -> str:
    """
    Queries LLM via Ollama (Local) or Groq (Cloud Fallback).
    """
    # Cloud Provider: Groq
    if provider == "cloud" and settings.GROQ_API_KEY:
        try:
            headers = {
                "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                "Content-Type": "application/json"
            }
            body = {
                "model": settings.GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.1,
                "max_tokens": max_tokens
            }
            res = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=body,
                timeout=15
            )
            if res.status_code == 200:
                data = res.json()
                return data["choices"][0]["message"]["content"]
            else:
                logger.warning("Groq API error (%d): %s. Falling back to local Ollama.", res.status_code, res.text)
        except Exception as e:
            logger.warning("Groq request failed: %s. Falling back to local Ollama.", e)

    # Local Provider: Ollama
    url = f"{settings.OLLAMA_BASE_URL}/api/chat"
    payload = {
        "model": settings.OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "stream": False,
        "options": {
            "temperature": 0.1,
            "num_predict": max_tokens
        }
    }
    res = requests.post(url, json=payload, timeout=25)
    if res.status_code != 200:
        raise RuntimeError(f"Ollama local error ({res.status_code}): {res.text}")
    data = res.json()
    return data.get("message", {}).get("content", "")

def generate_sql_for_question(user_question: str, history: Optional[List[Dict[str, str]]] = None, provider: str = "local") -> str:
    """Uses LLM to translate natural language question to read-only SQL, taking conversation history into account."""
    default_sys = f"""Eres un Ingeniero de Datos experto en PostgreSQL para SismoWatch.
Tu tarea es traducir la pregunta del usuario a UNA sentencia SQL de solo lectura sobre la vista curated.v_events_chat.

{V_EVENTS_CHAT_SCHEMA}

REGLAS ESTRICTAS:
1. Responde ÚNICAMENTE con la sentencia SQL pura, sin formato markdown (ni ```sql ni ```).
2. Consulta ÚNICAMENTE la vista 'curated.v_events_chat'.
3. Para conteos usa COUNT(*). Para eventos recientes o mayor magnitud usa ORDER BY.
4. Si la pregunta es sobre sismos, eventos, magnitudes o la base de datos, genera SIEMPRE la consulta SQL.
5. Si hay historial previo de la conversación y la pregunta es de seguimiento (ej: '¿a qué profundidad fue?', '¿hubo tsunami en ese sismo?'), usa el contexto del historial para identificar a qué sismo o región se refiere la consulta.
6. ÚNICAMENTE si la pregunta es explícitamente sobre temas ajenos (como fútbol, cocina, celebridades como Messi, chistes o política), responde: RECHAZO_FUERA_DE_DOMINIO
"""
    system_prompt = load_prompt_template("chat_text_to_sql_system.txt", default_sys)
    sanitized_q = sanitize_input_text(user_question)

    history_context = ""
    if history:
        recent_lines = []
        for h in history[-4:]:
            role_name = "Usuario" if h.get("role") == "user" else "Asistente"
            recent_lines.append(f"{role_name}: {sanitize_input_text(h.get('content', ''))}")
        if recent_lines:
            history_context = "Historial reciente de la conversación:\n" + "\n".join(recent_lines) + "\n\n"

    full_prompt = f"{history_context}Pregunta actual: {sanitized_q}"
    raw_response = query_llm(full_prompt, system_prompt, provider=provider, max_tokens=140)
    cleaned = re.sub(r"```(sql)?", "", raw_response).strip()
    return cleaned

def generate_grounded_answer(
    user_question: str,
    sql_query: str,
    sql_results: List[Dict[str, Any]],
    history: Optional[List[Dict[str, str]]] = None,
    provider: str = "local"
) -> str:
    """Uses LLM to summarize SQL results in Spanish with strict numerical grounding and professional visual layout."""
    results_str = json.dumps(sql_results[:15], default=str, indent=2, ensure_ascii=False)

    default_sys = """Eres el Asistente Experto de SismoWatch para monitoreo sísmico en tiempo real.
Tu misión es responder a la pregunta del usuario de manera natural, fluida, conversacional y profesional en español, explicando con claridad los resultados obtenidos de la base de datos.

PAUTAS DE REDACCIÓN Y RIGOR CIENTÍFICO (CERO ALUCINACIONES):
1. Redacta de forma explicativa, fluida y humana en español.
2. Basa tu respuesta EXCLUSIVAMENTE en los datos de la consulta SQL provista. NUNCA inventes números, magnitudes, regiones ni fechas. Todas las cifras deben coincidir exactamente con los datos devueltos.
3. Si la consulta devuelve una lista de múltiples eventos (2 o más sismos), organiza los eventos en una tabla Markdown con las columnas:
   | Magnitud | Región | Lugar | Fecha (UTC) | Profundidad | Tsunami |
4. Si algún evento tiene alerta de tsunami activa (tsunami_alert = true o tsunami = 1), resáltalo claramente con un bloque de advertencia:
   > 🌊 **ALERTA DE TSUNAMI**: Se activó advertencia para este evento en [Lugar].
5. Si la consulta devolvió 0 resultados, explica con amabilidad y naturalidad que tras consultar el catálogo curado no se registran eventos con esos criterios.
6. No expongas sintaxis técnica de SQL ni bloques de código JSON crudo; entrega un reporte ejecutivo claro para el analista de riesgos.
"""
    system_prompt = load_prompt_template("chat_grounded_answer_system.txt", default_sys)
    sanitized_q = sanitize_input_text(user_question)

    history_context = ""
    if history:
        recent_lines = []
        for h in history[-3:]:
            role_name = "Usuario" if h.get("role") == "user" else "Asistente"
            recent_lines.append(f"{role_name}: {sanitize_input_text(h.get('content', ''))}")
        if recent_lines:
            history_context = "Contexto previo:\n" + "\n".join(recent_lines) + "\n\n"

    user_prompt = f"""{history_context}Pregunta del usuario: {sanitized_q}

Consulta SQL ejecutada:
{sql_query}

Resultados obtenidos de la base de datos (Gold):
{results_str}

Responde a la pregunta en español de forma natural y rigurosamente grounded en estos resultados:"""

    return query_llm(user_prompt, system_prompt, provider=provider, max_tokens=1000)
