"""PrivacyGuard API with local-development and production safety modes."""
import logging
import os
import re
from contextlib import asynccontextmanager
from urllib.parse import parse_qs, urlsplit

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse

load_dotenv()

from middleware import RequestSecurityMiddleware
from database.db import production_storage_ready
from routes import report, scan

log = logging.getLogger("privacyguard")
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
if APP_ENV not in {"development", "production"}:
    raise RuntimeError("APP_ENV must be 'development' or 'production'.")
IS_PRODUCTION = APP_ENV == "production"


@asynccontextmanager
async def lifespan(_app):
    validate_production_configuration()
    if IS_PRODUCTION and not production_storage_ready():
        raise RuntimeError("Production MongoDB is unavailable; refusing to start in memory-only mode.")
    yield

app = FastAPI(
    title="PrivacyGuard API",
    version="1.3",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
    lifespan=lifespan,
)

app.include_router(scan.router)
app.include_router(report.router)
app.add_middleware(RequestSecurityMiddleware)

allowed_origins = [
    origin.strip() for origin in os.getenv("PRIVACYGUARD_ALLOWED_ORIGINS", "").split(",") if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    # Local development supports unpacked Chrome extension IDs. Production requires exact origins above.
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$" if not IS_PRODUCTION and not allowed_origins else None,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
    max_age=600,
)


def custom_openapi():
    """Document bearer auth and the contract's 400 errors instead of FastAPI's 422 default."""
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
    schemas = schema.setdefault("components", {}).setdefault("securitySchemes", {})
    schemas["BearerAuth"] = {"type": "http", "scheme": "bearer"}
    for path, method, responses in [
        ("/scan", "post", {"400": "Invalid scan payload", "401": "Authentication required", "413": "Request body too large", "429": "Rate limit exceeded", "503": "Server security configuration missing"}),
        ("/report/{scan_id}", "get", {"401": "Authentication required", "404": "Report not found", "429": "Rate limit exceeded", "503": "Server security configuration missing"}),
    ]:
        operation = schema.get("paths", {}).get(path, {}).get(method)
        if not operation:
            continue
        operation["security"] = [{"BearerAuth": []}]
        operation.setdefault("responses", {}).pop("422", None)
        for status, description in responses.items():
            operation["responses"].setdefault(status, {"description": description})
    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = custom_openapi


def validate_production_configuration() -> None:
    """Fail closed instead of silently starting a publicly exposed dev configuration."""
    if not IS_PRODUCTION:
        return
    api_key = os.getenv("PRIVACYGUARD_API_KEY", "")
    if len(api_key) < 32:
        raise RuntimeError("Production requires a random PRIVACYGUARD_API_KEY of at least 32 characters.")
    if not allowed_origins:
        raise RuntimeError("Production requires explicit PRIVACYGUARD_ALLOWED_ORIGINS.")
    def valid_origin(origin: str) -> bool:
        if re.fullmatch(r"chrome-extension://[a-p]{32}", origin):
            return True
        parsed_origin = urlsplit(origin)
        return (parsed_origin.scheme == "https" and bool(parsed_origin.netloc)
                and not parsed_origin.path and not parsed_origin.query and not parsed_origin.fragment)

    if any(not valid_origin(origin) for origin in allowed_origins):
        raise RuntimeError("Production CORS origins must be exact HTTPS or Chrome extension origins.")
    if not os.getenv("PRIVACYGUARD_HTTPS_ONLY", "").lower() == "true":
        raise RuntimeError("Production requires PRIVACYGUARD_HTTPS_ONLY=true behind a trusted TLS proxy.")
    mongo_uri = os.getenv("MONGODB_URI", "")
    if not mongo_uri:
        raise RuntimeError("Production requires MongoDB; in-memory storage is for local development only.")
    parsed = urlsplit(mongo_uri)
    query = parse_qs(parsed.query)
    if parsed.scheme != "mongodb+srv" and query.get("tls", query.get("ssl", ["false"]))[0].lower() not in {"true", "1"}:
        raise RuntimeError("Production MongoDB connections must use TLS.")


@app.exception_handler(RequestValidationError)
async def invalid_input(_: Request, __: RequestValidationError):
    # Do not echo rejected values or internal validation details to clients.
    return JSONResponse(status_code=400, content={
        "error": True, "code": "INVALID_INPUT",
        "message": "Invalid scan payload. Check it against docs/contract.md."})


@app.exception_handler(Exception)
async def server_error(_: Request, exc: Exception):
    # Keep request bodies and database exception details out of logs.
    if type(exc).__name__ != "RuntimeError" or "Production report storage" not in str(exc):
        log.error("Unhandled request error (%s)", type(exc).__name__)
    else:
        log.error("Production storage is unavailable (%s)", type(exc).__name__)
    return JSONResponse(status_code=500, content={
        "error": True, "code": "BACKEND_UNREACHABLE",
        "message": "The PrivacyGuard server had an internal error."})


@app.get("/")
def health():
    return {"ok": True, "service": "privacyguard-backend"}
