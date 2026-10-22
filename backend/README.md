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
```

`MONGODB_URI` is optional. If it is blank or MongoDB is unavailable, scans are stored in memory for the lifetime of the server process. Never put real keys or connection strings in source control; `.env` is ignored by Git.

## Run

Start the development server from the `backend` directory:

```powershell
uvicorn main:app --reload --port 8000
```

The health endpoint is `http://localhost:8000/`; interactive API docs are at `http://localhost:8000/docs`. The extension uses `http://localhost:8000` by default; update `extension/utils/config.js` if the server runs elsewhere.

## Check the backend

From the `backend` directory:

```powershell
python -m pytest
```

The tests cover the Phase 1 risk model and API contract. Policy analysis and Gemini are not part of Phase 1.
