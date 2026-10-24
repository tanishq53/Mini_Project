"""Google Safe Browsing URL reputation checks, separate from privacy scoring."""
import logging
import os
from urllib.parse import urlsplit

import httpx

log = logging.getLogger("privacyguard.reputation")

SAFE_BROWSING_URL = "https://safebrowsing.googleapis.com/v4/threatMatches:find"
THREAT_TYPES = ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"]


def _origin(url: str) -> tuple[str, str] | None:
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        return None

    hostname = parsed.hostname
    if ":" in hostname:
        hostname = f"[{hostname}]"
    netloc = hostname + (f":{parsed.port}" if parsed.port else "")
    return f"{parsed.scheme}://{netloc}/", parsed.hostname


def check_site_reputation(url: str) -> dict:
    api_key = os.getenv("GOOGLE_SAFE_BROWSING_API_KEY", "").strip()
    if not api_key:
        return {"status": "not_configured"}

    origin = _origin(url)
    if not origin:
        return {"status": "unavailable"}
    checked_url, checked_domain = origin

    payload = {
        "client": {"clientId": "privacyguard", "clientVersion": "0.1.0"},
        "threatInfo": {
            "threatTypes": THREAT_TYPES,
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [{"url": checked_url}],
        },
    }

    try:
        response = httpx.post(
            SAFE_BROWSING_URL,
            params={"key": api_key},
            json=payload,
            timeout=5.0,
        )
    except httpx.HTTPError as exc:
        log.warning("Google Safe Browsing request failed: %s", type(exc).__name__)
        return {"status": "unavailable"}

    if response.status_code != 200:
        log.warning("Google Safe Browsing returned HTTP %s", response.status_code)
        return {"status": "unavailable"}

    try:
        matches = response.json().get("matches", [])
        if not isinstance(matches, list):
            raise ValueError("matches must be a list")
        if any(not isinstance(match, dict) or not isinstance(match.get("threatType"), str) for match in matches):
            raise ValueError("match is missing a threat type")
        threat_types = list(dict.fromkeys(match["threatType"] for match in matches))
    except (ValueError, AttributeError, TypeError):
        log.warning("Google Safe Browsing returned an invalid response")
        return {"status": "unavailable"}

    return {
        "status": "unsafe" if matches else "safe",
        "checkedDomain": checked_domain,
        "threatTypes": threat_types,
    }
