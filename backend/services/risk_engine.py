"""PrivacyGuard risk engine, Phase 1.

Turns a merged scan object (docs/contract.md section 4.3) into a Privacy Risk Score.
Phase 1 scores personal-data fields, trackers, cookies and HTTPS. It does NOT look at the
privacy policy; that is Phase 2.

The engine is one pure function: calculate_risk(scan) -> dict. No network, no database, no AI,
so it always works and is easy to test and explain.

All weights are constants at the top of this file. To change the model, change them here,
update tests/test_risk_engine.py and docs/scoring.md. The three caps add up to 100.
"""
from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------- weights
# Personal data: points per detected field. Capped at CAP_PERSONAL_DATA.
FIELD_WEIGHTS = {
    "name": 1,
    "email": 2,
    "phone": 3,
    "address": 4,
    "dob": 4,
    "password": 2,
    "financial": 8,
    "governmentId": 10,
}
CAP_PERSONAL_DATA = 25

# Trackers: points per tracker of each category. Capped at CAP_TRACKERS.
TRACKER_WEIGHTS = {"analytics": 2, "advertising": 5, "social": 3, "unknown": 1}
CAP_TRACKERS = 45

# Cookies: points per third-party cookie. First-party cookies are not scored. Capped at CAP_COOKIES.
THIRD_PARTY_COOKIE_WEIGHT = 1
CAP_COOKIES = 10

# Security: HTTPS status. Capped at CAP_SECURITY (the two items below add up to it).
NOT_HTTPS_POINTS = 12
SENSITIVE_ON_HTTP_POINTS = 8
SENSITIVE_FIELDS = ("password", "financial", "governmentId")
CAP_SECURITY = 20

# Risk levels: (highest score in the band, name)
LEVEL_BANDS = [(25, "Low"), (50, "Moderate"), (75, "High"), (100, "Very High")]

MAX_RECOMMENDATIONS = 5


# ---------------------------------------------------------------- helpers
def _count(value: Any) -> int:
    """A non-negative integer from whatever the scan contains. Bad or missing data becomes 0."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 0
    return max(n, 0)


def level_from_score(score: int) -> str:
    for upper, name in LEVEL_BANDS:
        if score <= upper:
            return name
    return LEVEL_BANDS[-1][1]


def _parts(scan: dict) -> dict:
    """Every contribution to the score, before and after caps. Used by calculate_risk and explain."""
    scanner = scan.get("scanner") or {}
    tracking = scan.get("tracking") or {}
    field_types = scanner.get("fieldTypes") or {}
    trackers = tracking.get("trackers") or {}
    cookies = tracking.get("cookies") or {}

    personal_items = [(k, _count(field_types.get(k)), w) for k, w in FIELD_WEIGHTS.items()]
    tracker_items = [(k, _count(trackers.get(k)), w) for k, w in TRACKER_WEIGHTS.items()]
    third_party_cookies = _count(cookies.get("thirdParty"))

    personal_raw = sum(n * w for _, n, w in personal_items)
    trackers_raw = sum(n * w for _, n, w in tracker_items)
    cookies_raw = third_party_cookies * THIRD_PARTY_COOKIE_WEIGHT

    # Only an explicit False counts as insecure, so a missing value never adds a penalty.
    insecure = scan.get("https") is False
    known_tracker_present = any(_count(trackers.get(k)) > 0 for k in ("analytics", "advertising", "social"))
    data_exposed_to_others = insecure or known_tracker_present or third_party_cookies > 0
    # A clean HTTPS page with no known trackers or third-party cookies gets half personal-data points.
    # Round up so even one low-weight field contributes at least one point.
    personal_points = min(
        CAP_PERSONAL_DATA,
        personal_raw if data_exposed_to_others else (personal_raw + 1) // 2,
    )
    sensitive_present = any(_count(field_types.get(k)) > 0 for k in SENSITIVE_FIELDS)
    security_items = []
    if insecure:
        security_items.append(("page is not HTTPS", NOT_HTTPS_POINTS))
        if sensitive_present:
            security_items.append(("sensitive fields on a non-HTTPS page", SENSITIVE_ON_HTTP_POINTS))
    security_raw = sum(p for _, p in security_items)

    return {
        "personal_items": personal_items, "personal_raw": personal_raw,
        "personal": personal_points,
        "tracker_items": tracker_items, "trackers_raw": trackers_raw,
        "trackers": min(trackers_raw, CAP_TRACKERS),
        "third_party_cookies": third_party_cookies, "cookies_raw": cookies_raw,
        "cookies": min(cookies_raw, CAP_COOKIES),
        "security_items": security_items, "security_raw": security_raw,
        "security": min(security_raw, CAP_SECURITY),
    }


# ---------------------------------------------------------------- recommendations
def _recommendations(scan: dict, p: dict) -> list[str]:
    """Plain-language, rule-based advice, most serious first. Works without any AI."""
    field_types = (scan.get("scanner") or {}).get("fieldTypes") or {}
    trackers = (scan.get("tracking") or {}).get("trackers") or {}
    found: list[tuple[int, str]] = []  # (priority, text)

    if scan.get("https") is False:
        found.append((100, "This page is not secure (HTTP). Do not enter passwords or payment details here."))
    if _count(field_types.get("governmentId")) or _count(field_types.get("financial")):
        found.append((90, "This page asks for financial or government ID details. Only continue if you trust this site."))

    advertising = _count(trackers.get("advertising"))
    if advertising:
        found.append((80, f"{advertising} advertising tracker(s) found. Consider a tracker blocker or declining non-essential cookies."))

    personal_fields = sum(_count(field_types.get(k)) for k in FIELD_WEIGHTS)
    if personal_fields >= 5:
        found.append((70, f"This page asks for many personal details ({personal_fields} fields). Provide only what is required."))

    if p["third_party_cookies"] >= 5:
        found.append((60, f"{p['third_party_cookies']} third-party cookies are set. Consider blocking third-party cookies in your browser."))

    social = _count(trackers.get("social"))
    if social:
        found.append((50, f"{social} social media tracker(s) found. They can link your visit to your social accounts."))

    unknown = _count(trackers.get("unknown"))
    if unknown >= 3:
        found.append((40, f"{unknown} third-party scripts could not be classified. Their purpose is unknown."))

    analytics = _count(trackers.get("analytics"))
    if analytics:
        found.append((30, f"{analytics} analytics tracker(s) found. These measure how you use the site."))

    if not found:
        return ["No notable privacy concerns were found on this page."]
    found.sort(key=lambda item: -item[0])
    return [text for _, text in found[:MAX_RECOMMENDATIONS]]


# ---------------------------------------------------------------- public API
def calculate_risk(scan: dict) -> dict:
    """Return the /scan response fields: riskScore, riskLevel, breakdown, recommendations.

    breakdown.personalData + breakdown.trackers + breakdown.security == riskScore, always.
    breakdown.trackers includes the cookie points.
    """
    p = _parts(scan)
    breakdown = {
        "personalData": p["personal"],
        "trackers": p["trackers"] + p["cookies"],
        "security": p["security"],
    }
    score = max(0, min(100, sum(breakdown.values())))
    return {
        "riskScore": score,
        "riskLevel": level_from_score(score),
        "breakdown": breakdown,
        "recommendations": _recommendations(scan, p),
    }


def explain(scan: dict) -> list[dict]:
    """Every line that contributed points, for debugging, the viva and a future 'details' view."""
    p = _parts(scan)
    lines = []
    for key, n, w in p["personal_items"]:
        if n:
            lines.append({"part": "personalData", "item": f"{key} field x{n}", "points": n * w})
    for key, n, w in p["tracker_items"]:
        if n:
            lines.append({"part": "trackers", "item": f"{key} tracker x{n}", "points": n * w})
    if p["third_party_cookies"]:
        lines.append({"part": "trackers", "item": f"third-party cookie x{p['third_party_cookies']}",
                      "points": p["cookies_raw"]})
    for item, points in p["security_items"]:
        lines.append({"part": "security", "item": item, "points": points})
    return lines
