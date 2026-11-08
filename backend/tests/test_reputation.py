import httpx

from fastapi.testclient import TestClient
from main import app
from services import site_reputation

client = TestClient(app)


def fake_google_response(payload):
    def post(url, *, params, json, timeout):
        assert url == site_reputation.SAFE_BROWSING_URL
        assert params == {"key": "test-api-key"}
        assert json["threatInfo"]["threatEntries"] == [{"url": "https://example.com/path"}]
        assert timeout == 5.0
        return httpx.Response(200, json=payload, request=httpx.Request("POST", url))
    return post


def test_reputation_requires_no_key_to_return_not_configured(monkeypatch):
    monkeypatch.delenv("GOOGLE_SAFE_BROWSING_API_KEY", raising=False)
    response = client.post("/reputation", json={"url": "https://example.com/path?secret=value"})
    assert response.status_code == 200
    assert response.json() == {"status": "not_configured"}


def test_reputation_checks_path_without_query_or_fragment(monkeypatch):
    monkeypatch.setenv("GOOGLE_SAFE_BROWSING_API_KEY", "test-api-key")
    monkeypatch.setattr(site_reputation.httpx, "post", fake_google_response({}))
    response = client.post("/reputation", json={"url": "https://example.com/path?secret=value#fragment"})
    assert response.status_code == 200
    assert response.json() == {
        "status": "safe",
        "checkedDomain": "example.com",
        "threatTypes": [],
    }


def test_reputation_returns_threat_types(monkeypatch):
    monkeypatch.setenv("GOOGLE_SAFE_BROWSING_API_KEY", "test-api-key")
    def post(url, *, params, json, timeout):
        assert json["threatInfo"]["threatEntries"] == [{"url": "https://example.com/path"}]
        return httpx.Response(200, json={"matches": [
            {"threatType": "MALWARE"},
            {"threatType": "SOCIAL_ENGINEERING"},
            {"threatType": "MALWARE"},
        ]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(
        site_reputation.httpx,
        "post",
        post,
    )
    response = client.post("/reputation", json={"url": "https://example.com/path"})
    assert response.status_code == 200
    assert response.json() == {
        "status": "unsafe",
        "checkedDomain": "example.com",
        "threatTypes": ["MALWARE", "SOCIAL_ENGINEERING"],
    }


def test_reputation_flags_unrecognized_threat_type_as_unsafe(monkeypatch):
    monkeypatch.setenv("GOOGLE_SAFE_BROWSING_API_KEY", "test-api-key")
    def post(url, *, params, json, timeout):
        return httpx.Response(
            200,
            json={"matches": [{"threatType": "NEW_THREAT_TYPE"}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(
        site_reputation.httpx,
        "post",
        post,
    )
    response = client.post("/reputation", json={"url": "https://example.com"})
    assert response.status_code == 200
    assert response.json()["status"] == "unsafe"


def test_reputation_rejects_non_http_urls():
    response = client.post("/reputation", json={"url": "ftp://example.com/file"})
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_INPUT"


def test_reputation_api_failure_is_unavailable(monkeypatch):
    monkeypatch.setenv("GOOGLE_SAFE_BROWSING_API_KEY", "test-api-key")

    def fail(*args, **kwargs):
        raise httpx.TimeoutException("request timed out")

    monkeypatch.setattr(site_reputation.httpx, "post", fail)
    response = client.post("/reputation", json={"url": "https://example.com"})
    assert response.status_code == 200
    assert response.json() == {"status": "unavailable"}
