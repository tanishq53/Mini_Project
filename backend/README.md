# PrivacyGuard backend

FastAPI service for scan validation, deterministic exposure scoring, optional scan reports, Firebase account history, reputation checks, and user-requested policy analysis. The API contract and score model live in [../docs/contract.md](../docs/contract.md) and [../docs/scoring.md](../docs/scoring.md).

## Local setup

Requires Python 3.10 or newer. From the repository root in PowerShell:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Configure the Firebase web values in `backend/.env` for the dashboard. Keep the Firebase Admin service-account JSON outside the repository and set `GOOGLE_APPLICATION_CREDENTIALS` to its path, or use Application Default Credentials. Never commit or share the private JSON key. Configure `GEMINI_API_KEY` for policy analysis and `GOOGLE_SAFE_BROWSING_API_KEY` for site reputation.

For the legacy shared API credential and production startup checks, generate a random value with `python -c "import secrets; print(secrets.token_urlsafe(32))"` and place it in the ignored `PRIVACYGUARD_API_KEY` setting. The extension uses its account-specific `pg_...` connection key instead.

Start the API from the `backend` directory:

```powershell
uvicorn main:app --reload --port 8000
```

The dashboard is at `http://localhost:8000/`, the health endpoint is `/health`, and local interactive API documentation is at `/docs`. Create and verify a dashboard account, create a connection key, then save it in `chrome://extensions` → PrivacyGuard → **Details** → **Extension options**. Firebase connection keys are account-scoped and can be revoked from the dashboard. In production, `/scan` and `/report` require a valid Firebase account credential.

## Data and privacy

Only scans sent with the extension connection key are added to the account history. History stores site domains, times, risk summaries, and TLS state; it excludes page paths, query strings, form contents, and cookie values. The dashboard can revoke the extension key, adjust retention, and clear saved history. The Admin SDK bypasses Firestore Security Rules, so keep its credentials private and deploy the restrictive rules from the repository root with `firebase deploy --only firestore:rules`.

The backend stores score reports only, with a capped in-memory fallback locally or optional MongoDB persistence. MongoDB reports expire after 30 days by default (`PRIVACYGUARD_RETENTION_DAYS`). Production requires MongoDB with TLS. Rate limiting is in-process; multi-worker deployments should enforce shared rate limits at the reverse proxy or use a shared rate-limit store.

For HTTPS scans, `/scan` performs a certificate-validating TLS handshake and returns `tls` as `secure`, `insecure`, `broken`, or `null` when it cannot check reliably. The handshake sends no HTTP request or page data. The check is restricted to local extension requests and should not be exposed through an untrusted proxy.

Policy analysis starts only when the user clicks an analysis button. It sends up to 30,000 characters of visible text to Gemini; form values, cookies, and URL paths are excluded. The backend does not save submitted page text. Analysis is informational and does not change the deterministic risk score. The default model is `gemini-3.5-flash-lite`; `GEMINI_MODEL` can override it.

## Production requirements

Set `APP_ENV=production`, `PRIVACYGUARD_API_KEY`, `FIREBASE_PROJECT_ID`, `PRIVACYGUARD_HTTPS_ONLY=true`, an explicit `PRIVACYGUARD_ALLOWED_ORIGINS` allowlist, and a TLS-enabled `MONGODB_URI` in the deployment environment. The API refuses to start when these requirements are missing or storage is unavailable. Never commit credentials.

Run Uvicorn on a loopback/private interface behind a trusted TLS reverse proxy. Configure forwarded-header trust for the proxy's exact address, disable public access to the application port, and set short request/read timeouts at the proxy. Production mode disables Swagger/OpenAPI pages. Use a managed secret store for Firebase Admin credentials and API keys.

The backend caps request sizes and scan counts, throttles protected endpoints by client address and credential identifier, emits privacy-safe request metadata, and avoids storing raw scan payloads. Review the Firebase and Google API usage requirements before public deployment.
