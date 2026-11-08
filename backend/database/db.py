"""Store score reports only, with a bounded in-memory fallback and Mongo TTL."""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("privacyguard.db")

try:
    RETENTION_DAYS = max(1, min(365, int(os.getenv("PRIVACYGUARD_RETENTION_DAYS", "30"))))
except ValueError:
    RETENTION_DAYS = 30

_memory: Dict[str, Dict[str, Any]] = {}
_collection = None
MAX_MEMORY_REPORTS = 5000
_production = os.getenv("APP_ENV", "development").lower() == "production"

_uri = os.getenv("MONGODB_URI")
if _uri:
    try:
        from pymongo import MongoClient

        _client = MongoClient(_uri, serverSelectionTimeoutMS=2000, timeoutMS=5000)
        _collection = _client[os.getenv("MONGODB_DB", "privacyguard")]["scans"]
        # Older releases wrote ISO timestamp strings; normalize them so TTL applies to those rows too.
        _collection.update_many(
            {"createdAt": {"$type": "string"}},
            [{"$set": {"createdAt": {"$dateFromString": {
                "dateString": "$createdAt", "onError": None, "onNull": None
            }}}}],
        )
        legacy_scans = _collection.update_many({"scan": {"$exists": True}}, {"$unset": {"scan": ""}})
        if legacy_scans.modified_count:
            log.info("Removed legacy raw scan payloads from %s report records", legacy_scans.modified_count)
        _collection.create_index("createdAt", expireAfterSeconds=RETENTION_DAYS * 86400)
    except Exception as exc:  # The scan path remains available when MongoDB is unavailable.
        _collection = None
        log.warning("MongoDB unavailable; using memory (%s)", type(exc).__name__)


def _prune_memory(now: datetime) -> None:
    cutoff = now - timedelta(days=RETENTION_DAYS)
    expired = [scan_id for scan_id, doc in _memory.items() if doc["createdAt"] <= cutoff]
    for scan_id in expired:
        _memory.pop(scan_id, None)


def save_scan(scan_id: str, result: Dict[str, Any]) -> None:
    """Persist only the score report and redacted URL, never the raw scan payload."""
    now = datetime.now(timezone.utc)
    doc = {
        "_id": scan_id,
        "url": result["url"],
        "result": result,
        "createdAt": now,
    }
    if _production:
        if _collection is None:
            raise RuntimeError("Production report storage is unavailable.")
        try:
            _collection.insert_one(dict(doc))
        except Exception as exc:
            log.warning("MongoDB write failed (%s)", type(exc).__name__)
            raise RuntimeError("Production report storage is unavailable.") from None
        return

    _prune_memory(now)
    _memory[scan_id] = doc
    if len(_memory) > MAX_MEMORY_REPORTS:
        oldest = min(_memory, key=lambda key: _memory[key]["createdAt"])
        _memory.pop(oldest, None)
    if _collection is not None:
        try:
            _collection.insert_one(dict(doc))
        except Exception as exc:
            log.warning("MongoDB write failed; keeping report in memory (%s)", type(exc).__name__)


def get_result(scan_id: str) -> Optional[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    _prune_memory(now)
    if _production:
        if _collection is None:
            raise RuntimeError("Production report storage is unavailable.")
        try:
            doc = _collection.find_one({"_id": scan_id}, {"result": 1})
            return doc["result"] if doc else None
        except Exception as exc:
            log.warning("MongoDB read failed (%s)", type(exc).__name__)
            raise RuntimeError("Production report storage is unavailable.") from None
    if _collection is not None:
        try:
            doc = _collection.find_one({"_id": scan_id}, {"result": 1})
            if doc:
                return doc["result"]
        except Exception as exc:
            log.warning("MongoDB read failed; checking memory (%s)", type(exc).__name__)
    doc = _memory.get(scan_id)
    return doc["result"] if doc else None


def production_storage_ready() -> bool:
    """Production must never fall back to ephemeral in-memory report storage."""
    return _collection is not None
