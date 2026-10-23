# PrivacyGuard backend (Phase 1)

FastAPI service for scan validation, deterministic exposure scoring, and optional scan persistence. The API contract and scoring rules live in [../docs/contract.md](../docs/contract.md) and [../docs/scoring.md](../docs/scoring.md).

## Requirements

- Python 3.10 or newer
- Windows PowerShell commands below assume the shell starts in the repository root

## Setup

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Copy the generated token into `PRIVACYGUARD_API_KEY` in the ignored `.env` file, then restart the backend. Open Chrome's PrivacyGuard settings and enter the same token. Protected endpoints fail closed when the key is missing. Never commit the token or paste it into source files.

`MONGODB_URI` is optional in development. If it is blank or MongoDB is unavailable, reports are stored in a capped in-memory cache for the lifetime of the server process. Production requires MongoDB with TLS. Never put real keys or connection strings in source control; `.env` is ignored by Git.

Local development binds to loopback by default. CORS allows Chrome extension origins, and can be narrowed with `PRIVACYGUARD_ALLOWED_ORIGINS`. The extension sends its configured bearer token in the `Authorization` header. Swagger has an **Authorize** button for manual API checks.

The API key is a shared deployment credential. Anyone who can inspect an extension configured with that key can extract it, so use this only for a controlled demo. A public service needs per-user short-lived tokens from an identity provider before it can provide real user authentication. Give MongoDB a dedicated least-privilege user for the PrivacyGuard database and restrict its network allowlist.

## Run

Start the development server from the `backend` directory:

```powershell
uvicorn main:app --reload --port 8000
```

The health endpoint is `http://localhost:8000/`; interactive API docs are at `http://localhost:8000/docs`. The extension uses `http://localhost:8000` by default; update `extension/utils/config.js` if the server runs elsewhere.

Open `chrome://extensions`, select **Details** for PrivacyGuard, then **Extension options**. Set the bearer token to the exact local `PRIVACYGUARD_API_KEY` value. Swagger also has an **Authorize** button for backend checks.

## Check the backend

From the `backend` directory:

```powershell
python -m pytest
```

The tests cover the Phase 1 risk model and API contract. Policy analysis and Gemini are not part of Phase 1.

Run local security checks from the `backend` directory after installing the project requirements:

```powershell
python -m pip install bandit pip-audit
bandit -r main.py middleware.py models.py routes services database
pip-audit -r requirements.txt
```

## Production deployment requirements

The API refuses to start in production mode unless it has an explicit origin allowlist, a random API key of at least 32 characters, HTTPS-only mode, and a TLS-enabled MongoDB URI. Set `APP_ENV=production`, `PRIVACYGUARD_HTTPS_ONLY=true`, `PRIVACYGUARD_API_KEY`, `PRIVACYGUARD_ALLOWED_ORIGINS`, and `MONGODB_URI` in the deployment environment. Do not commit these values.

Run Uvicorn on a loopback/private interface behind a trusted TLS reverse proxy. Configure `--forwarded-allow-ips` to the proxy's exact address so Uvicorn trusts its HTTPS scheme header, for example `uvicorn main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=127.0.0.1` when the proxy connects from loopback. Disable public access to port 8000 and set short request/read timeouts at the proxy. Production mode disables Swagger/OpenAPI pages. The bundled single shared API key is suitable only for a controlled demonstration; replace it with per-user short-lived authentication before exposing the extension to public users.

The backend caps request size and scan counts, throttles by client address and API key in-process, emits privacy-safe request metadata, and stores score reports only. It drops URL paths, query strings, and fragments before returning or storing a result. MongoDB TTL and the in-memory fallback expire reports after 30 days by default (`PRIVACYGUARD_RETENTION_DAYS`); startup removes legacy raw scan payloads from existing MongoDB report rows. For multi-worker production deployments, enforce rate limits at the reverse proxy or use a shared rate-limit store.
