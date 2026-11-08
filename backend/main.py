"""PrivacyGuard backend. Run from the backend folder:
    uvicorn main:app --reload --port 8000"""
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from routes import accounts, policy_analysis, report, reputation, scan

log = logging.getLogger("privacyguard")
app = FastAPI(title="PrivacyGuard API", version="1.4")

# Dev only: the caller is the extension's service worker, so allow all origins locally.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

WEB_DIR = Path(__file__).resolve().parent / "web"
app.mount("/web", StaticFiles(directory=WEB_DIR), name="web")
app.include_router(accounts.router)
app.include_router(policy_analysis.router)
app.include_router(scan.router)
app.include_router(report.router)
app.include_router(reputation.router)


@app.exception_handler(RequestValidationError)
async def invalid_input(_: Request, exc: RequestValidationError):
    # Contract 5.6: invalid input is HTTP 400 with our own error body, not FastAPI's 422.
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    return JSONResponse(status_code=400, content={
        "error": True, "code": "INVALID_INPUT",
        "message": f"Invalid scan data at '{where}': {first.get('msg', 'bad input')}"})


@app.exception_handler(Exception)
async def server_error(_: Request, exc: Exception):
    log.exception("Unhandled error: %s", exc)
    # OPEN: the contract has no generic server-error code; confirm with Tanishq.
    return JSONResponse(status_code=500, content={
        "error": True, "code": "BACKEND_UNREACHABLE",
        "message": "The PrivacyGuard server had an internal error."})


@app.get("/", include_in_schema=False)
def dashboard():
    return FileResponse(WEB_DIR / "index.html")


@app.get("/health")
def health():
    return {"ok": True, "service": "privacyguard-backend"}
