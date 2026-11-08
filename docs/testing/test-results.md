# Test results

## Automated checks - 2026-10-22

- `python -m pytest -q` from `backend/`: **56 passed**, with one upstream Starlette `TestClient` deprecation warning.
- `node extension/content/scanner.test.js`: **216 assertions passed** (simulated DOM; this does not replace a Chrome integration run).
- `node --check` for the options, API, and side-panel scripts: passed.
- `python -m compileall -q backend`: passed.
- Bandit over backend source modules: **no issues identified**. One suppression documents the scoring key named `password`, which stores an integer weight rather than a credential.
- `pip-audit -r requirements.txt`: **no known vulnerabilities** after updating `certifi` to the audited fixed release.

Manual Chrome extension scans and production reverse-proxy/MongoDB TLS configuration have not been exercised in this session.
