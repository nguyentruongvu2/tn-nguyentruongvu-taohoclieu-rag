"""
FastAPI main application
Document Processing Module for RAG Pipeline

Two-stage workflow:
1. /documents/convert - Upload file → Extract Markdown
2. /documents/process - Process Markdown → Chunking
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import API_TITLE, API_VERSION, API_DESCRIPTION, LOG_LEVEL
from .auth_db import init_auth_db, log_request, upsert_usage, any_admin_exists, create_user
from .security import decode_access_token, hash_password
from .routes import auth, project_rag, quiz, secure_rag, slides, convert

import redis.asyncio as redis
from fastapi_cache import FastAPICache
from fastapi_cache.backends.redis import RedisBackend
from fastapi_limiter import FastAPILimiter


# Configure logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

_FIELD_LABELS = {
    "email": "Email",
    "password": "Mật khẩu",
    "confirm_password": "Xác nhận mật khẩu",
}


def _field_from_loc(loc: list | tuple | None) -> str:
    if not loc:
        return "field"
    filtered = [str(part) for part in loc if str(part) not in {"body", "query", "path"}]
    if not filtered:
        return "field"
    return filtered[-1]


def _validation_message_vi(error: dict) -> str:
    err_type = str(error.get("type", ""))
    raw_msg = str(error.get("msg", "Dữ liệu không hợp lệ."))
    ctx = error.get("ctx") or {}
    field_key = _field_from_loc(error.get("loc"))
    field_label = _FIELD_LABELS.get(field_key, field_key)

    if err_type == "missing":
        return f"{field_label} không được để trống."

    if field_key == "email" and ("email" in err_type or "email" in raw_msg.lower()):
        return "Email không đúng định dạng."

    if err_type in {"string_too_short", "too_short"}:
        min_len = ctx.get("min_length")
        if min_len:
            return f"{field_label} phải có ít nhất {min_len} ký tự."
        return f"{field_label} quá ngắn."

    if err_type in {"string_too_long", "too_long"}:
        max_len = ctx.get("max_length")
        if max_len:
            return f"{field_label} không được vượt quá {max_len} ký tự."
        return f"{field_label} quá dài."

    if err_type == "string_pattern_mismatch":
        return f"{field_label} không đúng định dạng yêu cầu."

    return raw_msg


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application lifecycle (startup and shutdown events)
    """
    # Startup
    logger.info("Document Processing API starting up...")
    
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    redis_client = redis.from_url(redis_url, encoding="utf8", decode_responses=True)
    app.state.redis = redis_client
    FastAPICache.init(RedisBackend(redis_client), prefix="rag-cache")
    try:
        await FastAPILimiter.init(redis_client)
        logger.info("Redis cache and rate limiter initialized.")
    except Exception as e:
        logger.warning(f"Could not connect to Redis: {e}")

    import time, random, psycopg
    # Random sleep to stagger worker startup and prevent PostgreSQL deadlocks during init_auth_db
    time.sleep(random.uniform(0, 2))
    try:
        init_auth_db()
    except psycopg.errors.DeadlockDetected:
        logger.warning("Deadlock detected during init_auth_db, ignoring since another worker is initializing the schema.")

    # Bootstrap default admin for local/dev usage if none exists yet.
    if not any_admin_exists():
        admin_password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "admin123")
        admin_email = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "admin@local.test")
        create_user(
            "admin",
            hash_password(admin_password),
            role="admin",
            email=admin_email,
            status="active",
        )
        logger.warning(
            "Bootstrapped default admin account: %s / [configured password] (change in production)",
            admin_email,
        )
    yield
    # Shutdown
    logger.info("Document Processing API shutting down...")
    try:
        await FastAPILimiter.close()
    except Exception:
        pass


# Create FastAPI application
app = FastAPI(
    title=API_TITLE,
    description=API_DESCRIPTION,
    version=API_VERSION,
    lifespan=lifespan
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError):
    errors = []
    for err in exc.errors():
        field = _field_from_loc(err.get("loc"))
        errors.append(
            {
                "field": field,
                "message": _validation_message_vi(err),
                "code": str(err.get("type", "validation_error")),
            }
        )

    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "message": "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại thông tin.",
            "error_code": "VALIDATION_ERROR",
            "errors": errors,
        },
    )

# Configure CORS middleware to allow frontend requests
# In production, set ALLOWED_ORIGINS env var to a comma-separated list of trusted origins.
# Example: ALLOWED_ORIGINS="https://yourapp.com,https://www.yourapp.com"
# When allow_credentials=True, browsers reject wildcard origins, so we must use explicit origins.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "").strip()
if _raw_origins:
    _allowed_origins: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]
    _allow_credentials = True
else:
    # Development fallback: allow all origins without credentials to avoid browser rejection
    _allowed_origins = ["*"]
    _allow_credentials = False  # credentials=True + origins=["*"] is rejected by browsers

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],  # Explicitly allow all methods including OPTIONS
    allow_headers=["*"],  # Allow all headers including Authorization
    expose_headers=["*"],  # Expose all response headers
    max_age=3600,  # Cache preflight requests for 1 hour
)


@app.middleware("http")
async def auth_context_middleware(request: Request, call_next):
    # Skip auth context for CORS preflight requests
    if request.method == "OPTIONS":
        return await call_next(request)
    
    request.state.auth_user = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        payload = decode_access_token(token)
        if payload and payload.get("user_id") is not None:
            request.state.auth_user = {
                "id": int(payload.get("user_id")),
                "role": str(payload.get("role", "user")),
                "username": str(payload.get("username", "")),
            }

    response = await call_next(request)

    user = request.state.auth_user
    user_id = int(user["id"]) if user else None
    ip_addr = request.client.host if request.client else None
    try:
        log_request(
            user_id=user_id,
            endpoint=request.url.path,
            method=request.method,
            status_code=int(response.status_code),
            ip_address=ip_addr,
            llm_calls=0,
            token_usage=0,
        )
        if user_id is not None:
            upsert_usage(user_id=user_id, request_inc=1)
    except Exception as exc:
        logger.debug("Request log skipped: %s", exc)

    return response

# Include authentication and secure routes
from .security import rate_limiter
from fastapi import Depends

app.include_router(auth.router, prefix="/api/auth", dependencies=[Depends(rate_limiter)])  # JWT auth + admin monitor
app.include_router(secure_rag.router, prefix="/api", dependencies=[Depends(rate_limiter)]) # Secure endpoints (/upload, /documents, /generate, /chat)
app.include_router(project_rag.router, prefix="/api", dependencies=[Depends(rate_limiter)]) # Project-based RAG endpoints
app.include_router(quiz.router, prefix="/api", dependencies=[Depends(rate_limiter)])        # Quiz generation
app.include_router(slides.router, prefix="/api", dependencies=[Depends(rate_limiter)])      # Slide generation
app.include_router(convert.router, prefix="", dependencies=[Depends(rate_limiter)])         # Document conversion endpoints (/documents/convert, etc.)


# Add OPTIONS handlers for CORS preflight
@app.options("/{full_path:path}")
async def options_handler(full_path: str):
    """Handle CORS preflight OPTIONS requests"""
    return {}

@app.get("/health")
@app.get("/documents/health")
async def health_check():
    return {"status": "ok"}

@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "Document Processing API",
        "description": "Upload PDF/DOCX documents and process through RAG pipeline",
        "version": API_VERSION,
        "endpoints": {
            "register": "POST /register - Create account",
            "login": "POST /login - JWT login",
            "secure_upload": "POST /upload - Authenticated PDF upload",
            "secure_documents": "GET /documents - List own documents",
            "secure_generate": "POST /generate - TOC/section/edit/teaching_doc with ownership checks",
            "secure_generate_teaching_doc": "POST /generate/teaching-doc - Multi-document teaching doc generation",
            "secure_document_detail": "GET /documents/{document_id}/detail - Markdown + chunk context by owner",
            "secure_document_preview": "GET /documents/{document_id}/preview - Inline file preview by owner",
            "secure_chat": "POST /chat - RAG chat scoped to your document",
            "convert": "POST /documents/convert - Convert file to Markdown",
            "process": "POST /documents/process - Process Markdown with chunking",
            "pipeline": "POST /documents/pipeline/upload - Convert + clean + chunk + embed + index",
            "chat": "POST /documents/chat - Hybrid retrieval + rerank + Gemini answer",
            "upload": "POST /documents/upload - Legacy one-stage endpoint",
            "health": "GET /documents/health"
        }
    }


if __name__ == "__main__":
    import uvicorn
    
    logger.info("Starting FastAPI application...")
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level=LOG_LEVEL.lower()
    )
