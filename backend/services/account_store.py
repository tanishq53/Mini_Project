"""Legacy SQLite account/history store retained for manual migration only.

The active dashboard now uses Firebase Authentication and Cloud Firestore.
This module is no longer imported by the application.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
import re

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

_default_path = Path(__file__).resolve().parents[1] / "data" / "privacyguard.sqlite3"
DB_PATH = Path(os.getenv("PRIVACYGUARD_DB_PATH", str(_default_path))).expanduser()
PBKDF2_ROUNDS = 310_000
SESSION_DAYS = 14


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_account_store() -> None:
    db = _connect()
    try:
        with db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                extension_key_hash TEXT UNIQUE,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
            CREATE TABLE IF NOT EXISTS login_attempts (
                client_key TEXT PRIMARY KEY,
                window_started_at TEXT NOT NULL,
                failed_attempts INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS visit_history (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                hostname TEXT NOT NULL,
                visited_at TEXT NOT NULL,
                risk_score INTEGER NOT NULL,
                risk_level TEXT NOT NULL,
                tls TEXT
            );
            CREATE INDEX IF NOT EXISTS visit_history_user_time_idx
                ON visit_history(user_id, visited_at DESC);
            """)
    finally:
        db.close()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def create_user(email: str, password: str) -> int:
    normalized = email.strip().lower()
    if len(normalized) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
        raise ValueError("Enter a valid email address.")
    if len(password) < 10 or len(password) > 256:
        raise ValueError("Use a password between 10 and 256 characters.")
    salt = secrets.token_bytes(16)
    password_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    db = _connect()
    try:
        with db:
            cursor = db.execute(
                "INSERT INTO users(email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?)",
                (normalized, salt, password_hash, _stamp(_now())),
            )
            return int(cursor.lastrowid)
    except sqlite3.IntegrityError as exc:
        raise ValueError("An account with that email already exists.") from exc
    finally:
        db.close()


def verify_user(email: str, password: str) -> dict[str, Any] | None:
    db = _connect()
    try:
        row = db.execute("SELECT id, email, password_salt, password_hash FROM users WHERE email = ? COLLATE NOCASE",
                         (email.strip(),)).fetchone()
        if row is None:
            # Spend a comparable amount of time for unknown accounts.
            hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes(16), PBKDF2_ROUNDS)
            return None
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), row["password_salt"], PBKDF2_ROUNDS)
        if not hmac.compare_digest(candidate, row["password_hash"]):
            return None
        return {"id": row["id"], "email": row["email"]}
    finally:
        db.close()


def login_is_limited(client_key: str) -> bool:
    cutoff = _stamp(_now() - timedelta(minutes=15))
    db = _connect()
    try:
        row = db.execute("SELECT window_started_at, failed_attempts FROM login_attempts WHERE client_key = ?",
                         (client_key,)).fetchone()
        return bool(row and row["window_started_at"] > cutoff and row["failed_attempts"] >= 8)
    finally:
        db.close()


def record_login_failure(client_key: str) -> None:
    now = _stamp(_now())
    cutoff = _stamp(_now() - timedelta(minutes=15))
    db = _connect()
    try:
        with db:
            db.execute("""INSERT INTO login_attempts(client_key, window_started_at, failed_attempts)
                VALUES (?, ?, 1)
                ON CONFLICT(client_key) DO UPDATE SET
                    window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at
                                             ELSE window_started_at END,
                    failed_attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE failed_attempts + 1 END""",
                (client_key, now, cutoff, cutoff))
    finally:
        db.close()


def clear_login_failures(client_key: str) -> None:
    db = _connect()
    try:
        with db:
            db.execute("DELETE FROM login_attempts WHERE client_key = ?", (client_key,))
    finally:
        db.close()


def create_session(user_id: int) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expiry = _now() + timedelta(days=SESSION_DAYS)
    db = _connect()
    try:
        with db:
            db.execute("DELETE FROM sessions WHERE expires_at <= ?", (_stamp(_now()),))
            db.execute("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                       (hashlib.sha256(token.encode()).hexdigest(), user_id, _stamp(expiry)))
        return token, expiry
    finally:
        db.close()


def get_session_user(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    digest = hashlib.sha256(token.encode()).hexdigest()
    db = _connect()
    try:
        row = db.execute("""SELECT users.id, users.email FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?""", (digest, _stamp(_now()))).fetchone()
        return {"id": row["id"], "email": row["email"]} if row else None
    finally:
        db.close()


def delete_session(token: str | None) -> None:
    if not token:
        return
    db = _connect()
    try:
        with db:
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (hashlib.sha256(token.encode()).hexdigest(),))
    finally:
        db.close()


def rotate_extension_key(user_id: int) -> str:
    token = "pg_" + secrets.token_urlsafe(32)
    db = _connect()
    try:
        with db:
            db.execute("UPDATE users SET extension_key_hash = ? WHERE id = ?",
                       (hashlib.sha256(token.encode()).hexdigest(), user_id))
        return token
    finally:
        db.close()


def revoke_extension_key(user_id: int) -> None:
    db = _connect()
    try:
        with db:
            db.execute("UPDATE users SET extension_key_hash = NULL WHERE id = ?", (user_id,))
    finally:
        db.close()


def has_extension_key(user_id: int) -> bool:
    db = _connect()
    try:
        row = db.execute("SELECT extension_key_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        return bool(row and row["extension_key_hash"])
    finally:
        db.close()


def get_api_user(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    digest = hashlib.sha256(token.encode()).hexdigest()
    db = _connect()
    try:
        row = db.execute("SELECT id, email FROM users WHERE extension_key_hash = ?", (digest,)).fetchone()
        return {"id": row["id"], "email": row["email"]} if row else None
    finally:
        db.close()


def record_visit(user_id: int, hostname: str, risk_score: int, risk_level: str, tls: str | None) -> None:
    db = _connect()
    try:
        with db:
            db.execute("""INSERT INTO visit_history(user_id, hostname, visited_at, risk_score, risk_level, tls)
                VALUES (?, ?, ?, ?, ?, ?)""",
                (user_id, hostname.lower().rstrip("."), _stamp(_now()), risk_score, risk_level, tls))
    finally:
        db.close()


def read_history(user_id: int, days: int) -> dict[str, Any]:
    start = _now() - timedelta(days=days)
    db = _connect()
    try:
        where = "user_id = ? AND visited_at >= ?"
        params = (user_id, _stamp(start))
        rows = db.execute(f"""SELECT hostname, visited_at, risk_score, risk_level, tls FROM visit_history
            WHERE {where} ORDER BY visited_at DESC LIMIT 500""", params).fetchall()
        total = db.execute(f"SELECT COUNT(*) FROM visit_history WHERE {where}", params).fetchone()[0]
        unique_sites = db.execute(f"SELECT COUNT(DISTINCT hostname) FROM visit_history WHERE {where}", params).fetchone()[0]
        grouped = db.execute(f"""SELECT substr(visited_at, 1, 10) AS date, COUNT(*) AS visits
            FROM visit_history WHERE {where} GROUP BY date ORDER BY date""", params).fetchall()
        sites = db.execute(f"""SELECT hostname, COUNT(*) AS visits, ROUND(AVG(risk_score)) AS average_risk
            FROM visit_history WHERE {where} GROUP BY hostname
            ORDER BY visits DESC, hostname ASC LIMIT 10""", params).fetchall()
        visits = [{"hostname": row["hostname"], "visitedAt": row["visited_at"],
                   "riskScore": row["risk_score"], "riskLevel": row["risk_level"], "tls": row["tls"]}
                  for row in rows]
        return {"totalVisits": total, "uniqueSites": unique_sites, "visits": visits,
                "byDay": [{"date": row["date"], "visits": row["visits"]} for row in grouped],
                "topSites": [{"hostname": row["hostname"], "visits": row["visits"],
                              "averageRisk": row["average_risk"]} for row in sites]}
    finally:
        db.close()


def clear_history(user_id: int) -> None:
    db = _connect()
    try:
        with db:
            db.execute("DELETE FROM visit_history WHERE user_id = ?", (user_id,))
    finally:
        db.close()


init_account_store()
