"""Firebase Admin verification and per-user Firestore history storage."""
from __future__ import annotations

import hashlib
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "").strip()
_app = None
_db = None
_lock = threading.Lock()


def web_config() -> dict[str, str]:
    """Public Firebase Web App configuration; never includes Admin credentials."""
    return {
        "apiKey": os.getenv("FIREBASE_WEB_API_KEY", "").strip(),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN", "").strip(),
        "projectId": PROJECT_ID,
        "appId": os.getenv("FIREBASE_APP_ID", "").strip(),
    }


def web_configured() -> bool:
    return all(web_config().values())


def _firestore():
    global _app, _db
    if _db is not None:
        return _db
    if not PROJECT_ID:
        raise RuntimeError("Firebase is not configured. Set FIREBASE_PROJECT_ID in backend/.env.")
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError as exc:
        raise RuntimeError("Install Firebase support with: pip install -r requirements.txt") from exc

    with _lock:
        if _db is not None:
            return _db
        try:
            _app = firebase_admin.get_app()
        except ValueError:
            credential_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
            credential = credentials.Certificate(credential_path) if credential_path else credentials.ApplicationDefault()
            _app = firebase_admin.initialize_app(credential, {"projectId": PROJECT_ID})
        _db = firestore.client(app=_app)
        return _db


def verify_id_token(token: str) -> dict[str, Any]:
    if not PROJECT_ID:
        raise RuntimeError("Firebase is not configured. Set FIREBASE_PROJECT_ID in backend/.env.")
    try:
        import firebase_admin
        from firebase_admin import auth
    except ImportError as exc:
        raise RuntimeError("Install Firebase support with: pip install -r requirements.txt") from exc
    _firestore()  # ensure the Admin SDK is initialized with the intended project
    try:
        decoded = auth.verify_id_token(token, app=_app, check_revoked=True)
    except Exception as exc:
        raise ValueError("Firebase sign-in expired or is invalid. Sign in again.") from exc
    if not decoded.get("email_verified"):
        raise PermissionError("Verify your email address before using PrivacyGuard history.")
    return {"id": decoded["uid"], "email": decoded.get("email", "")}


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def rotate_extension_key(user_id: str) -> str:
    db = _firestore()
    token = "pg_" + secrets.token_urlsafe(32)
    digest = _digest(token)
    user_ref = db.collection("users").document(user_id)
    key_ref = db.collection("extensionKeys").document(digest)
    batch = db.batch()
    old_hash = user_ref.get().to_dict()
    old_hash = old_hash.get("extensionKeyHash") if old_hash else None
    if old_hash:
        batch.delete(db.collection("extensionKeys").document(old_hash))
    batch.set(user_ref, {"extensionKeyHash": digest}, merge=True)
    batch.set(key_ref, {"uid": user_id, "createdAt": datetime.now(timezone.utc)})
    batch.commit()
    return token


def revoke_extension_key(user_id: str) -> None:
    db = _firestore()
    user_ref = db.collection("users").document(user_id)
    user_data = user_ref.get().to_dict() or {}
    old_hash = user_data.get("extensionKeyHash")
    batch = db.batch()
    if old_hash:
        batch.delete(db.collection("extensionKeys").document(old_hash))
    batch.set(user_ref, {"extensionKeyHash": None}, merge=True)
    batch.commit()


def has_extension_key(user_id: str) -> bool:
    db = _firestore()
    user_data = db.collection("users").document(user_id).get().to_dict() or {}
    return bool(user_data.get("extensionKeyHash"))


def get_api_user(token: str) -> dict[str, str] | None:
    db = _firestore()
    key = db.collection("extensionKeys").document(_digest(token)).get()
    data = key.to_dict()
    return {"id": data["uid"]} if data and data.get("uid") else None


def record_visit(user_id: str, hostname: str, risk_score: int, risk_level: str, tls: str | None) -> None:
    db = _firestore()
    from google.cloud import firestore

    hostname = hostname.lower().rstrip(".")
    now = datetime.now(timezone.utc)
    day = now.date().isoformat()
    site_id = hashlib.sha256(hostname.encode("utf-8")).hexdigest()
    ref = db.collection("users").document(user_id).collection("visits").document(site_id)
    transaction = db.transaction()

    @firestore.transactional
    def update_site(transaction):
        snapshot = ref.get(transaction=transaction)
        old = snapshot.to_dict() or {}
        daily = dict(old.get("daily", {}))
        today = dict(daily.get(day, {}))
        today_min = today.get("minScore", risk_score)
        today_max = today.get("maxScore", risk_score)
        today.update({
            "count": int(today.get("count", 0)) + 1,
            "minScore": min(int(today_min), risk_score),
            "maxScore": max(int(today_max), risk_score),
        })
        daily[day] = today
        # Keep only the rolling month needed by the dashboard; global extrema
        # and the all-time scan count remain on the single site document.
        cutoff = (now.date() - timedelta(days=30)).isoformat()
        daily = {key: value for key, value in daily.items() if key >= cutoff}
        transaction.set(ref, {
            "hostname": hostname,
            "scanCount": int(old.get("scanCount", 0)) + 1,
            "firstSeen": old.get("firstSeen", now),
            "lastSeen": now,
            "minScore": min(int(old.get("minScore", risk_score)), risk_score),
            "maxScore": max(int(old.get("maxScore", risk_score)), risk_score),
            "riskLevel": risk_level,
            "tls": tls,
            "daily": daily,
        }, merge=True)

    update_site(transaction)


def read_history(user_id: str, days: int) -> dict[str, Any]:
    db = _firestore()
    start_day = (datetime.now(timezone.utc).date() - timedelta(days=days - 1)).isoformat()
    totals_by_day: dict[str, int] = {}
    period_sites = []
    # Combine any pre-rollup per-scan documents with the new per-site document
    # so users always see one row per hostname, including their existing history.
    sites: dict[str, dict[str, Any]] = {}
    for snapshot in db.collection("users").document(user_id).collection("visits").stream():
        row = snapshot.to_dict() or {}
        hostname = row.get("hostname", "")
        if not hostname:
            continue
        daily = row.get("daily")
        if not isinstance(daily, dict):
            # Read and combine records written by the previous per-scan schema.
            visited_at = row.get("visitedAt")
            if isinstance(visited_at, datetime):
                day = visited_at.astimezone(timezone.utc).date().isoformat()
            else:
                day = str(visited_at or "")[:10]
            score = int(row.get("riskScore", 0))
            daily = {day: {"count": 1, "minScore": score, "maxScore": score}} if day else {}
        site = sites.setdefault(hostname, {"daily": {}, "scanCount": 0, "minScore": None,
                                           "maxScore": None, "lastSeen": None,
                                           "riskLevel": "Low", "tls": None})
        site["scanCount"] += int(row.get("scanCount", 0)) if isinstance(row.get("daily"), dict) else 1
        row_min = row.get("minScore", row.get("riskScore"))
        row_max = row.get("maxScore", row.get("riskScore"))
        if row_min is not None:
            site["minScore"] = int(row_min) if site["minScore"] is None else min(site["minScore"], int(row_min))
            site["maxScore"] = int(row_max) if site["maxScore"] is None else max(site["maxScore"], int(row_max))
        last_seen = row.get("lastSeen", row.get("visitedAt"))
        if isinstance(last_seen, datetime):
            last_seen = last_seen.astimezone(timezone.utc).isoformat(timespec="seconds")
        if last_seen and (site["lastSeen"] is None or last_seen > site["lastSeen"]):
            site["lastSeen"] = last_seen
            site["riskLevel"] = row.get("riskLevel", "Low")
            site["tls"] = row.get("tls")
        for day, stats in daily.items():
            current = site["daily"].get(day)
            count = int(stats.get("count", 0))
            if current is None:
                site["daily"][day] = {"count": count, "minScore": int(stats.get("minScore", 0)),
                                      "maxScore": int(stats.get("maxScore", 0))}
            else:
                current["count"] += count
                current["minScore"] = min(current["minScore"], int(stats.get("minScore", 0)))
                current["maxScore"] = max(current["maxScore"], int(stats.get("maxScore", 0)))

    for hostname, row in sites.items():
        daily = row["daily"]
        period_count = period_min = period_max = 0
        for day, stats in daily.items():
            if day < start_day:
                continue
            count = int(stats.get("count", 0))
            if not count:
                continue
            totals_by_day[day] = totals_by_day.get(day, 0) + count
            day_min = int(stats.get("minScore", 0))
            day_max = int(stats.get("maxScore", 0))
            if period_count == 0:
                period_min, period_max = day_min, day_max
            else:
                period_min = min(period_min, day_min)
                period_max = max(period_max, day_max)
            period_count += count
        if not period_count:
            continue
        period_sites.append({
            "hostname": hostname,
            "visitedAt": row["lastSeen"],
            "visits": period_count,
            "minScore": period_min,
            "maxScore": period_max,
            "riskLevel": row["riskLevel"],
            "tls": row["tls"],
        })
    period_sites.sort(key=lambda item: item.get("visitedAt") or "", reverse=True)
    top_sites = sorted(period_sites, key=lambda item: (-item["visits"], item["hostname"]))[:10]
    total_visits = sum(totals_by_day.values())
    return {"totalVisits": total_visits, "uniqueSites": len(period_sites), "visits": period_sites[:8],
            "allSites": period_sites,
            "byDay": [{"date": day, "visits": count} for day, count in sorted(totals_by_day.items())],
            "topSites": top_sites}


def clear_history(user_id: str) -> None:
    db = _firestore()
    visits = db.collection("users").document(user_id).collection("visits")
    while True:
        batch = db.batch()
        snapshots = list(visits.limit(450).stream())
        if not snapshots:
            return
        for snapshot in snapshots:
            batch.delete(snapshot.reference)
        batch.commit()
