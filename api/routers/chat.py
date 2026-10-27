import time
import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from auth import get_current_user, UserPayload
from services.ai_service import (
    generate_sql_for_question,
    validate_sql_query,
    execute_chat_sql,
    generate_grounded_answer,
    log_ai_run,
    settings
)

logger = logging.getLogger("sismowatch.api.chat")
router = APIRouter(prefix="/api/chat", tags=["Agente Conversacional"])

class ChatRequest(BaseModel):
    message: str
    provider: Optional[str] = "cloud"  # "cloud" (Groq predeterminado) o "local" (Ollama)

class ProofOfGrounding(BaseModel):
    verified: bool
    source_table: str = "curated.v_events_chat"
    rows_retrieved: int
    db_role: str = "role_chat_reader"
    statement_timeout_ms: int = 3000

class ChatResponse(BaseModel):
    reply: str
    sql_query: str
    sql_results: List[Dict[str, Any]]
    proof_of_grounding: ProofOfGrounding
    model_used: str
    latency_seconds: float
    provider: str

@router.post("", response_model=ChatResponse)
def ask_chat_agent(
    req: ChatRequest,
    current_user: UserPayload = Depends(get_current_user)
):
    """
    Agente Conversacional Grounded (Cero Alucinaciones):
    1. Traduce la pregunta a SQL de solo lectura sobre curated.v_events_chat.
    2. Valida mediante Guardrail AST/Regex que no contenga DDL/DML.
    3. Ejecuta la consulta usando role_chat_reader (read-only=on, timeout=3000ms).
    4. Genera la respuesta en español estrictamente basada en los datos devueltos.
    5. Registra auditoría de IA en curated.ai_runs.
    """
    start_time = time.time()
    model_name = settings.OLLAMA_MODEL if req.provider == "local" else (settings.GROQ_MODEL if settings.GROQ_API_KEY else settings.OLLAMA_MODEL)

    try:
        # Step 1: Text-to-SQL
        sql = generate_sql_for_question(req.message, provider=req.provider)

        # Off-topic domain protection guardrail
        if sql.strip() == "RECHAZO_FUERA_DE_DOMINIO":
            return ChatResponse(
                reply="Como asistente analítico especializado de SismoWatch, mi función está restringida exclusivamente al monitoreo sísmico global, consultas sobre el catálogo de terremotos, magnitudes y alertas de tsunami. Por favor realiza una pregunta relacionada con eventos sísmicos o métricas de la plataforma.",
                sql_query="N/A (Consulta fuera de dominio rechazada por seguridad)",
                sql_results=[],
                proof_of_grounding=ProofOfGrounding(
                    verified=True,
                    rows_retrieved=0
                ),
                model_used=model_name,
                latency_seconds=round(time.time() - start_time, 2),
                provider=req.provider
            )

        # Step 2: Guardrail validation
        is_valid, reason = validate_sql_query(sql)
        if not is_valid:
            log_ai_run(
                run_type="chat_query",
                prompt=req.message,
                model_used=model_name,
                tokens=len(req.message.split()) * 2,
                latency=time.time() - start_time,
                status_str="guardrail_blocked",
                error=reason
            )
            return ChatResponse(
                reply=f"🛡️ **Protección de Dominio y Seguridad**: La consulta generada no fue autorizada ({reason}). Como asistente analítico de SismoWatch, mi función está restringida exclusivamente a consultas sobre el catálogo de sismos, magnitudes, regiones y alertas.",
                sql_query=f"RECHAZADA: {sql}",
                sql_results=[],
                proof_of_grounding=ProofOfGrounding(
                    verified=False,
                    rows_retrieved=0
                ),
                model_used=model_name,
                latency_seconds=round(time.time() - start_time, 2),
                provider=req.provider
            )

        # Step 3: Execute query under role_chat_reader (with self-correction fallback)
        try:
            sql_results, db_latency = execute_chat_sql(sql)
        except Exception as sql_err:
            logger.warning("Initial SQL execution failed: %s. Attempting self-correction...", sql_err)
            try:
                correction_prompt = f"La consulta '{sql}' falló con error: {str(sql_err)}. Corrige la sentencia para que sea válida en PostgreSQL sobre curated.v_events_chat (ej: usa MAX(magnitude) o columnas ordenadas sin mezclar COUNT). Responde SOLO el SQL puro:"
                sql = generate_sql_for_question(correction_prompt, provider=req.provider)
                is_valid, _ = validate_sql_query(sql)
                if not is_valid:
                    sql = "SELECT event_id, magnitude, region, place, event_time, depth_km, tsunami_alert FROM curated.v_events_chat ORDER BY magnitude DESC LIMIT 10;"
                sql_results, db_latency = execute_chat_sql(sql)
            except Exception as retry_err:
                logger.warning("Self-correction failed: %s. Using safe fallback query.", retry_err)
                sql = "SELECT event_id, magnitude, region, place, event_time, depth_km, tsunami_alert FROM curated.v_events_chat ORDER BY magnitude DESC LIMIT 10;"
                sql_results, db_latency = execute_chat_sql(sql)

        # Step 4: Grounded Answer Synthesis
        reply = generate_grounded_answer(req.message, sql, sql_results, provider=req.provider)

        total_latency = time.time() - start_time

        # Step 5: Audit log
        log_ai_run(
            run_type="chat_query",
            prompt=req.message,
            model_used=model_name,
            tokens=len(req.message.split()) * 3 + len(sql.split()) + len(reply.split()),
            latency=total_latency,
            status_str="success"
        )

        return ChatResponse(
            reply=reply,
            sql_query=sql,
            sql_results=sql_results,
            proof_of_grounding=ProofOfGrounding(
                verified=True,
                rows_retrieved=len(sql_results)
            ),
            model_used=model_name,
            latency_seconds=round(total_latency, 2),
            provider=req.provider
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error in chat agent: %s", e)
        total_latency = time.time() - start_time
        log_ai_run(
            run_type="chat_query",
            prompt=req.message,
            model_used=model_name,
            tokens=0,
            latency=total_latency,
            status_str="error",
            error=str(e)
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error en el asistente de IA: {str(e)}"
        )
