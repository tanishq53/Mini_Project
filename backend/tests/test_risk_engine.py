"""Tests for the Phase 1 risk engine. Run from the backend folder with: pytest"""
import pytest

from services.risk_engine import (
    CAP_COOKIES, CAP_PERSONAL_DATA, CAP_SECURITY, CAP_TRACKERS,
    calculate_risk, explain, level_from_score,
)

FIELD_KEYS = ["name", "email", "phone", "address", "dob", "password", "financial", "governmentId"]


def make_scan(fields=None, trackers=None, third_party_cookies=0, first_party_cookies=0, https=True):
    field_types = {k: 0 for k in FIELD_KEYS} | (fields or {})
    return {
        "https": https,
        "scanner": {"forms": 1, "personalDataFields": sum(field_types.values()), "fieldTypes": field_types},
        "tracking": {
            "cookies": {"total": first_party_cookies + third_party_cookies,
                        "firstParty": first_party_cookies, "thirdParty": third_party_cookies},
            "trackers": {"analytics": 0, "advertising": 0, "social": 0, "unknown": 0} | (trackers or {}),
        },
    }


def test_empty_scan_is_zero_and_low():
    r = calculate_risk({})
    assert r["riskScore"] == 0 and r["riskLevel"] == "Low"
    assert r["breakdown"] == {"personalData": 0, "trackers": 0, "security": 0}


def test_breakdown_always_sums_to_score():
    scan = make_scan({"email": 2, "phone": 1}, {"analytics": 3, "advertising": 2}, third_party_cookies=4, https=False)
    r = calculate_risk(scan)
    assert sum(r["breakdown"].values()) == r["riskScore"]


def test_breakdown_has_exactly_the_phase_1_keys():
    assert set(calculate_risk(make_scan())["breakdown"]) == {"personalData", "trackers", "security"}


def test_personal_data_points():
    # name 1 + email 2*2 + phone 3 + address 4 + password 2 = 14
    r = calculate_risk(make_scan({"name": 1, "email": 2, "phone": 1, "address": 1, "password": 1}))
    assert r["breakdown"]["personalData"] == 14


def test_tracker_and_cookie_points():
    # analytics 3*2 + advertising 2*5 + social 1*3 + unknown 1 = 20, plus 5 third-party cookies = 25
    r = calculate_risk(make_scan(trackers={"analytics": 3, "advertising": 2, "social": 1, "unknown": 1}, third_party_cookies=5))
    assert r["breakdown"]["trackers"] == 25


def test_first_party_cookies_are_not_scored():
    assert calculate_risk(make_scan(first_party_cookies=40))["riskScore"] == 0


def test_caps():
    heavy = make_scan({"financial": 5, "governmentId": 3}, {"advertising": 50}, third_party_cookies=80, https=False)
    r = calculate_risk(heavy)
    assert r["breakdown"]["personalData"] == CAP_PERSONAL_DATA
    assert r["breakdown"]["trackers"] == CAP_TRACKERS + CAP_COOKIES
    assert r["breakdown"]["security"] == CAP_SECURITY
    assert r["riskScore"] == 100 and r["riskLevel"] == "Very High"


def test_security_points():
    assert calculate_risk(make_scan(https=True))["breakdown"]["security"] == 0
    assert calculate_risk(make_scan(https=False))["breakdown"]["security"] == 12
    assert calculate_risk(make_scan({"password": 1}, https=False))["breakdown"]["security"] == 20


def test_missing_https_is_not_penalised():
    scan = make_scan()
    del scan["https"]
    assert calculate_risk(scan)["breakdown"]["security"] == 0


@pytest.mark.parametrize("score,level", [
    (0, "Low"), (25, "Low"), (26, "Moderate"), (50, "Moderate"),
    (51, "High"), (75, "High"), (76, "Very High"), (100, "Very High"),
])
def test_level_boundaries(score, level):
    assert level_from_score(score) == level


def test_tracking_alone_can_reach_high_but_not_very_high():
    r = calculate_risk(make_scan(trackers={"advertising": 20}, third_party_cookies=30))
    assert r["riskLevel"] == "High"


def test_bad_input_does_not_crash():
    scan = {"scanner": {"fieldTypes": {"email": "two", "phone": -3, "name": None}},
            "tracking": {"trackers": {"analytics": "x"}, "cookies": {"thirdParty": None}}}
    r = calculate_risk(scan)
    assert r["riskScore"] == 0


def test_unknown_keys_are_ignored():
    scan = make_scan({"email": 1})
    scan["policy"] = {"found": False}
    scan["somethingNew"] = 123
    assert calculate_risk(scan)["riskScore"] == 2


def test_recommendations_are_limited_ordered_and_have_no_policy_text():
    scan = make_scan({"email": 3, "phone": 1, "address": 2}, {"analytics": 2, "advertising": 4, "social": 2, "unknown": 5},
                     third_party_cookies=9, https=False)
    recs = calculate_risk(scan)["recommendations"]
    assert 1 <= len(recs) <= 5
    assert "not secure" in recs[0]
    assert not any("policy" in r.lower() for r in recs)


def test_clean_page_gets_a_reassuring_recommendation():
    assert calculate_risk(make_scan())["recommendations"] == ["No notable privacy concerns were found on this page."]


def test_explain_adds_up_to_uncapped_parts():
    scan = make_scan({"email": 2}, {"analytics": 1}, third_party_cookies=2)
    assert sum(line["points"] for line in explain(scan)) == 4 + 2 + 2


def test_input_is_not_modified():
    scan = make_scan({"email": 1})
    before = repr(scan)
    calculate_risk(scan)
    assert repr(scan) == before
