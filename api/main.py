import logging
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from config import settings
from routers import auth, dashboard, events, reports, quarantine, admin, stream, chat

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("sismowatch.api")

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="""
    ## SismoWatch API de Monitoreo Sísmico Global y Plataforma Medallion
    
    * **Arquitectura Medallion:** Ingesta Bronze (`raw`), Limpieza Silver (`staging`) y Consumo Gold (`curated`).
    * **Mínimo Privilegio (POLP):** Consultas de API ejecutadas exclusivamente bajo `role_api_reader` y Chat bajo `role_chat_reader`.
    * **IA Grounded:** Asistente conversacional Text-to-SQL con verificación numérica y cero alucinaciones.
    * **RBAC:** Roles `viewer` y `admin` con autenticación JWT sin estado.
    """,
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(events.router)
app.include_router(reports.router)
app.include_router(quarantine.router)
app.include_router(admin.router)
app.include_router(stream.router)
app.include_router(chat.router)

@app.get("/health", tags=["Health"])
def health_check():
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "local_model": settings.OLLAMA_MODEL,
        "cloud_provider_available": bool(settings.GROQ_API_KEY)
    }

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled API exception on %s: %s", request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Error interno del servidor. Por favor consulte los registros del sistema."}
    )
