"""Storage for scans. Uses MongoDB when MONGODB_URI is set and reachable;
otherwise falls back to memory so /scan never fails because of the database."""
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("privacyguard.db")

_memory: Dict[str, Dict[str, Any]] = {}
_collection = None

_uri = os.getenv("MONGODB_URI")
if _uri:
    try:
        from pymongo import MongoClient
        _client = MongoClient(_uri, serverSelectionTimeoutMS=2000)
        _collection = _client[os.getenv("MONGODB_DB", "privacyguard")]["scans"]
    except Exception as exc:  # bad URI etc.: keep going with memory
        log.warning("MongoDB not available, using memory: %s", exc)


def save_scan(scan_id: str, scan: Dict[str, Any], result: Dict[str, Any]) -> None:
    doc = {"_id": scan_id, "url": result["url"], "scan": scan, "result": result,
           "createdAt": datetime.now(timezone.utc).isoformat()}
    _memory[scan_id] = doc
    if _collection is not None:
        try:
            _collection.insert_one(dict(doc))
        except Exception as exc:  # never break a scan because the DB is down
            log.warning("Could not save scan to MongoDB: %s", exc)


def get_result(scan_id: str) -> Optional[Dict[str, Any]]:
    if _collection is not None:
        try:
            doc = _collection.find_one({"_id": scan_id})
            if doc:
                return doc["result"]
        except Exception as exc:
            log.warning("Could not read from MongoDB: %s", exc)
    doc = _memory.get(scan_id)
    return doc["result"] if doc else None
