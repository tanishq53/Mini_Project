"""Phase 1 API contract and security tests. Run with python -m pytest."""
import hashlib
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from database import db
import main
from main import app, validate_production_configuration
from middleware import RequestSecurityMiddleware

TEST_API_KEY = "test-only-api-key-for-privacyguard-tests"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("PRIVACYGUARD_API_KEY", TEST_API_KEY)
    with TestClient(app, headers={"Authorization": f"Bearer {TEST_API_KEY}"}) as test_client:
        yield test_client


def sample(**over):
    scan = {
        "url": "https://example.com/login", "hostname": "example.com",
        "scannedAt": "2026-10-02T10:00:00Z", "https": True,
        "scanner": {"forms": 3, "personalDataFields": 6,
                    "fieldTypes": {"name": 1, "email": 2, "phone": 1, "address": 1,
                                   "dob": 0, "password": 1, "financial": 0, "governmentId": 0}},
        "tracking": {"cookies": {"total": 14, "firstParty": 9, "thirdParty": 5},
                     "thirdPartyScripts": 7,
                     "trackers": {"analytics": 3, "advertising": 2, "social": 1, "unknown": 1}},
        "policy": {"found": False, "url": None, "candidates": []},
    }
    scan.update(over)
    return scan


def test_worked_example(client):
    r = client.post("/scan", json=sample())
    assert r.status_code == 200
    body = r.json()
    assert body["riskScore"] == 39 and body["riskLevel"] == "Moderate"
    assert body["breakdown"] == {"personalData": 14, "trackers": 25, "security": 0}
    assert sum(body["breakdown"].values()) == body["riskScore"]
    assert 1 <= len(body["recommendations"]) <= 5


def test_http_with_password_adds_20(client):
    r = client.post("/scan", json=sample(https=False))
    assert r.json()["breakdown"]["security"] == 20


def test_missing_https_is_not_penalised(client):
    s = sample()
    del s["https"]
    assert client.post("/scan", json=s).json()["breakdown"]["security"] == 0


def test_all_zero_scan(client):
    s = sample()
    s["scanner"] = {"forms": 0, "personalDataFields": 0,
                    "fieldTypes": {k: 0 for k in s["scanner"]["fieldTypes"]}}
    s["tracking"] = {"cookies": {"total": 0, "firstParty": 0, "thirdParty": 0},
                     "thirdPartyScripts": 0,
                     "trackers": {"analytics": 0, "advertising": 0, "social": 0, "unknown": 0}}
    body = client.post("/scan", json=s).json()
    assert body["riskScore"] == 0 and body["riskLevel"] == "Low"


def test_invalid_input_is_400_and_does_not_echo_values(client):
    s = sample()
    del s["scanner"]["fieldTypes"]["email"]
    r = client.post("/scan", json=s)
    assert r.status_code == 400
    assert r.json()["error"] is True and r.json()["code"] == "INVALID_INPUT"
    assert "secret" not in r.text


def test_malformed_json_is_a_contract_error(client):
    response = client.post("/scan", content=b"{bad-json", headers={"Content-Type": "application/json"})
    assert response.status_code == 400
    assert response.json() == {
        "error": True,
        "code": "INVALID_INPUT",
        "message": "Invalid scan payload. Check it against docs/contract.md.",
    }


def test_sensitive_field_value_is_rejected(client):
    s = sample()
    s["scanner"]["fields"] = [{"category": "email", "name": "email", "type": "email",
                                "formIndex": 0, "value": "user-secret@example.com"}]
    r = client.post("/scan", json=s)
    assert r.status_code == 400
    assert "user-secret@example.com" not in r.text


def test_inconsistent_totals_rejected(client):
    s = sample()
    s["tracking"]["cookies"]["total"] = 99
    assert client.post("/scan", json=s).status_code == 400


def test_excessive_tracker_counts_rejected(client):
    s = sample()
    s["tracking"]["trackers"]["advertising"] = 5001
    assert client.post("/scan", json=s).status_code == 400


def test_inconsistent_tracker_totals_rejected(client):
    s = sample()
    s["tracking"]["thirdPartyScripts"] = 6
    assert client.post("/scan", json=s).status_code == 400


def test_invalid_or_mismatched_url_rejected(client):
    assert client.post("/scan", json=sample(url="javascript:alert(1)")).status_code == 400
    assert client.post("/scan", json=sample(hostname="elsewhere.example")).status_code == 400
    assert client.post("/scan", json=sample(url="https://user:pass@example.com/" )).status_code == 400


def test_query_string_is_removed_before_report_storage(client):
    s = sample(url="https://example.com/login?token=private-session-token#section")
    response = client.post("/scan", json=s)
    assert response.status_code == 200
    scan_id = response.json()["id"]
    assert response.json()["url"] == "https://example.com/"
    stored = db._memory[scan_id]
    assert "scan" not in stored
    assert "private-session-token" not in repr(stored)
    assert len(scan_id) == len("scan_") + 32


def test_report_roundtrip_and_404(client):
    scan_id = client.post("/scan", json=sample()).json()["id"]
    assert client.get(f"/report/{scan_id}").json()["id"] == scan_id
    assert client.get("/report/scan_nope").status_code == 404


def test_both_scan_and_report_require_bearer_token(client, monkeypatch):
    unauthenticated = TestClient(app)
    scan_response = unauthenticated.post("/scan", json=sample())
    assert scan_response.status_code == 401
    assert scan_response.json()["code"] == "AUTH_REQUIRED"

    scan_id = client.post("/scan", json=sample()).json()["id"]
    report_response = unauthenticated.get(f"/report/{scan_id}")
    assert report_response.status_code == 401
    assert report_response.json()["code"] == "AUTH_REQUIRED"


def test_missing_api_key_fails_closed(client, monkeypatch):
    monkeypatch.delenv("PRIVACYGUARD_API_KEY")
    response = TestClient(app).post("/scan", json=sample())
    assert response.status_code == 503
    assert response.json()["code"] == "SERVER_MISCONFIGURED"


def test_remote_plain_http_is_rejected_in_production(client, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    response = client.post("/scan", json=sample())
    assert response.status_code == 403
    assert response.json()["code"] == "HTTPS_REQUIRED"


def test_cors_allows_extension_origin_and_rejects_web_origins(client):
    allowed_origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    allowed = client.options("/scan", headers={
        "Origin": allowed_origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    })
    assert allowed.headers.get("access-control-allow-origin") == allowed_origin

    rejected = client.options("/scan", headers={
        "Origin": "https://untrusted.example",
        "Access-Control-Request-Method": "POST",
    })
    assert "access-control-allow-origin" not in rejected.headers


def test_security_headers_are_present(client):
    response = client.post("/scan", json=sample())
    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "default-src 'none'" in response.headers["content-security-policy"]


def test_audit_log_contains_only_hashed_key_id_and_request_metadata(client, caplog):
    caplog.set_level(logging.INFO, logger="privacyguard.audit")
    response = client.post("/scan", json=sample(url="https://example.com/?token=do-not-log-this"))
    assert response.status_code == 200
    assert "do-not-log-this" not in caplog.text
    assert TEST_API_KEY not in caplog.text
    assert hashlib.sha256(TEST_API_KEY.encode()).hexdigest()[:12] in caplog.text


def test_request_body_limit_returns_contract_error(client, monkeypatch):
    monkeypatch.setenv("PRIVACYGUARD_MAX_BODY_BYTES", "1024")
    response = client.post("/scan", content=b"x" * 2048,
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert response.json()["code"] == "PAYLOAD_TOO_LARGE"


def test_rate_limiter_blocks_excess_requests(monkeypatch):
    rate_app = FastAPI()
    rate_app.add_middleware(RequestSecurityMiddleware)

    @rate_app.post("/scan")
    def scan_stub():
        return {"ok": True}

    token = "rate-limit-test-token"
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("PRIVACYGUARD_API_KEY", token)
    monkeypatch.setenv("PRIVACYGUARD_RATE_LIMIT", "2")
    with TestClient(rate_app, headers={"Authorization": f"Bearer {token}"}) as rate_client:
        assert rate_client.post("/scan", json={}).status_code == 200
        assert rate_client.post("/scan", json={}).status_code == 200
        limited = rate_client.post("/scan", json={})
        assert limited.status_code == 429
        assert limited.json()["code"] == "RATE_LIMITED"


def test_production_configuration_requires_credentials_and_tls(monkeypatch):
    monkeypatch.setattr(main, "IS_PRODUCTION", True)
    monkeypatch.setattr(main, "allowed_origins", ["https://privacyguard.example"])
    monkeypatch.setenv("PRIVACYGUARD_API_KEY", "A" * 40)
    monkeypatch.setenv("PRIVACYGUARD_HTTPS_ONLY", "true")
    monkeypatch.setenv("MONGODB_URI", "mongodb://user:password@db.example/privacyguard")
    with pytest.raises(RuntimeError, match="MongoDB connections must use TLS"):
        validate_production_configuration()
    monkeypatch.setenv("MONGODB_URI", "mongodb+srv://user:password@db.example/privacyguard")
    validate_production_configuration()


def test_openapi_documents_bearer_auth_and_400_not_422(client):
    schema = client.get("/openapi.json").json()
    assert schema["components"]["securitySchemes"]["BearerAuth"]["scheme"] == "bearer"
    responses = schema["paths"]["/scan"]["post"]["responses"]
    assert "400" in responses and "401" in responses
    assert "422" not in responses


def test_caps_never_exceed_100(client):
    s = sample(https=False)
    s["scanner"]["fieldTypes"].update(governmentId=5, financial=5)
    s["scanner"]["personalDataFields"] = sum(s["scanner"]["fieldTypes"].values())
    s["tracking"]["trackers"]["advertising"] = 50
    s["tracking"]["thirdPartyScripts"] = 55
    s["tracking"]["cookies"] = {"total": 60, "firstParty": 0, "thirdParty": 60}
    body = client.post("/scan", json=s).json()
    assert body["riskScore"] == 100 and body["riskLevel"] == "Very High"
