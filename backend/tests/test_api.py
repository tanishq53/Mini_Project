from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def sample(**over):
    scan = {
        "url": "https://example.com/login", "hostname": "example.com",
        "scannedAt": "2026-10-02T10:00:00Z", "https": True,
        "scanner": {"forms": 3, "personalDataFields": 6,
                    "fieldTypes": {"name": 1, "email": 2, "phone": 1, "address": 1,
                                   "dob": 0, "password": 1, "financial": 0, "governmentId": 0}},
        "tracking": {"cookies": {"total": 14, "firstParty": 9, "thirdParty": 5},
                     "thirdPartyScripts": 6,
                     "trackers": {"analytics": 3, "advertising": 2, "social": 1, "unknown": 1}},
        "policy": {"found": False, "url": None, "candidates": []},
    }
    scan.update(over)
    return scan


def test_worked_example():
    r = client.post("/scan", json=sample())
    assert r.status_code == 200
    body = r.json()
    assert body["riskScore"] == 39 and body["riskLevel"] == "Moderate"
    assert body["breakdown"] == {"personalData": 14, "trackers": 25, "security": 0}
    assert sum(body["breakdown"].values()) == body["riskScore"]
    assert 1 <= len(body["recommendations"]) <= 5


def test_http_with_password_adds_20():
    r = client.post("/scan", json=sample(https=False))
    assert r.json()["breakdown"]["security"] == 20


def test_missing_https_is_not_penalised():
    s = sample()
    del s["https"]
    assert client.post("/scan", json=s).json()["breakdown"]["security"] == 0


def test_all_zero_scan():
    s = sample()
    s["scanner"] = {"forms": 0, "personalDataFields": 0,
                    "fieldTypes": {k: 0 for k in s["scanner"]["fieldTypes"]}}
    s["tracking"] = {"cookies": {"total": 0, "firstParty": 0, "thirdParty": 0},
                     "thirdPartyScripts": 0,
                     "trackers": {"analytics": 0, "advertising": 0, "social": 0, "unknown": 0}}
    body = client.post("/scan", json=s).json()
    assert body["riskScore"] == 0 and body["riskLevel"] == "Low"


def test_invalid_input_is_400_in_contract_format():
    s = sample()
    del s["scanner"]["fieldTypes"]["email"]
    r = client.post("/scan", json=s)
    assert r.status_code == 400
    assert r.json()["error"] is True and r.json()["code"] == "INVALID_INPUT"


def test_inconsistent_totals_rejected():
    s = sample()
    s["tracking"]["cookies"]["total"] = 99
    assert client.post("/scan", json=s).status_code == 400


def test_caps_never_exceed_100():
    s = sample(https=False)
    s["scanner"]["fieldTypes"].update(governmentId=5, financial=5)
    s["scanner"]["personalDataFields"] = sum(s["scanner"]["fieldTypes"].values())
    s["tracking"]["trackers"]["advertising"] = 50
    s["tracking"]["cookies"] = {"total": 60, "firstParty": 0, "thirdParty": 60}
    body = client.post("/scan", json=s).json()
    assert body["riskScore"] == 100 and body["riskLevel"] == "Very High"


def test_report_roundtrip_and_404():
    scan_id = client.post("/scan", json=sample()).json()["id"]
    assert client.get(f"/report/{scan_id}").json()["id"] == scan_id
    assert client.get("/report/scan_nope").status_code == 404
