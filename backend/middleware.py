"""Dependency-free request hardening for the small Phase 1 API."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from collections import defaultdict, deque
from typing import Any, Awaitable, Callable

log = logging.getLogger("privacyguard.audit")
ASGIApp = Callable[..., Awaitable[None]]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]


def _error(status: int, code: str, message: str) -> tuple[int, list[tuple[bytes, bytes]], bytes]:
    body = json.dumps({"error": True, "code": code, "message": message}).encode("utf-8")
    return status, [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())], body


class RequestSecurityMiddleware:
    """Bound request size, throttle API use, enforce bearer auth, and log metadata only."""

    MAX_RATE_LIMIT_KEYS = 20000

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._windows: dict[str, deque[float]] = defaultdict(deque)
        self._last_cleanup = 0.0

    async def _reject(self, send: Send, status: int, code: str, message: str) -> None:
        status, headers, body = _error(status, code, message)
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": body})

    def _limited(self, keys: list[str], limit: int, window: int) -> bool:
        now = time.monotonic()
        cutoff = now - window
        if now - self._last_cleanup > window:
            for key in list(self._windows):
                bucket = self._windows[key]
                while bucket and bucket[0] <= cutoff:
                    bucket.popleft()
                if not bucket:
                    self._windows.pop(key, None)
            self._last_cleanup = now

        buckets = [self._windows.get(key) for key in keys]
        for bucket in buckets:
            if bucket is None:
                continue
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                return True
        for key in keys:
            self._windows[key].append(now)
        if len(self._windows) > self.MAX_RATE_LIMIT_KEYS:
            # Bound memory under high-cardinality source IP/key abuse.
            oldest = sorted(self._windows, key=lambda key: self._windows[key][-1])
            for key in oldest[:len(self._windows) - self.MAX_RATE_LIMIT_KEYS]:
                self._windows.pop(key, None)
        return False

    async def __call__(self, scope: dict[str, Any], receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = scope.get("method", "GET").upper()
        is_scan = path == "/scan" and method == "POST"
        is_report = path.startswith("/report/") and method == "GET"
        is_protected = is_scan or is_report
        safe_endpoint = "/report/{scan_id}" if path.startswith("/report/") else path
        env = os.getenv("APP_ENV", "development").lower()
        production = env == "production"
        headers = {key.lower(): value for key, value in scope.get("headers", [])}

        token = b""
        authorization = headers.get(b"authorization", b"").decode("latin-1")
        if authorization.lower().startswith("bearer "):
            token = authorization[7:].strip().encode("utf-8")
        configured_key = os.getenv("PRIVACYGUARD_API_KEY", "").encode("utf-8")
        key_id = hashlib.sha256(token).hexdigest()[:12] if token else "anonymous"

        start = time.monotonic()
        response_status = 500

        async def send_with_headers(message: dict[str, Any]) -> None:
            nonlocal response_status
            if message["type"] == "http.response.start":
                response_status = message["status"]
                existing = list(message.get("headers", []))
                existing_names = {key.lower() for key, _ in existing}
                security_headers = [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"cache-control", b"no-store"),
                ]
                if not path.startswith(("/docs", "/redoc", "/openapi.json")):
                    security_headers.append((b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"))
                if production and scope.get("scheme") == "https":
                    security_headers.append((b"strict-transport-security", b"max-age=31536000"))
                existing.extend((key, value) for key, value in security_headers if key not in existing_names)
                message["headers"] = existing
            await send(message)

        if production and scope.get("scheme") != "https":
            await self._reject(send_with_headers, 403, "HTTPS_REQUIRED", "Use the HTTPS API endpoint.")
            self._audit(scope, method, safe_endpoint, key_id, 403, start)
            return

        if is_protected:
            client = scope.get("client")
            client_ip = client[0] if client else "unknown"
            try:
                limit = max(1, int(os.getenv("PRIVACYGUARD_RATE_LIMIT", "60")))
                window = max(1, int(os.getenv("PRIVACYGUARD_RATE_WINDOW_SECONDS", "60")))
            except ValueError:
                limit, window = 60, 60
            if self._limited([f"ip:{client_ip}", f"key:{key_id}"], limit, window):
                await self._reject(send_with_headers, 429, "RATE_LIMITED", "Too many requests. Wait before trying again.")
                self._audit(scope, method, safe_endpoint, key_id, 429, start)
                return

        if is_protected and not configured_key:
            await self._reject(send_with_headers, 503, "SERVER_MISCONFIGURED", "The API authentication key is not configured.")
            self._audit(scope, method, safe_endpoint, key_id, 503, start)
            return

        if is_protected and configured_key and not hmac.compare_digest(token, configured_key):
            await self._reject(send_with_headers, 401, "AUTH_REQUIRED", "A valid bearer token is required.")
            self._audit(scope, method, safe_endpoint, key_id, 401, start)
            return

        if is_scan:
            try:
                max_bytes = max(1024, int(os.getenv("PRIVACYGUARD_MAX_BODY_BYTES", "524288")))
            except ValueError:
                max_bytes = 524288
            content_length = headers.get(b"content-length")
            if content_length:
                try:
                    declared_size = int(content_length)
                except ValueError:
                    await self._reject(send_with_headers, 400, "INVALID_INPUT", "Invalid Content-Length header.")
                    self._audit(scope, method, safe_endpoint, key_id, 400, start)
                    return
                if declared_size > max_bytes:
                    await self._reject(send_with_headers, 413, "PAYLOAD_TOO_LARGE", "The scan request exceeds the allowed size.")
                    self._audit(scope, method, safe_endpoint, key_id, 413, start)
                    return

            buffered: list[dict[str, Any]] = []
            total = 0
            while True:
                message = await receive()
                buffered.append(message)
                if message["type"] == "http.disconnect":
                    break
                total += len(message.get("body", b""))
                if total > max_bytes:
                    await self._reject(send_with_headers, 413, "PAYLOAD_TOO_LARGE", "The scan request exceeds the allowed size.")
                    self._audit(scope, method, safe_endpoint, key_id, 413, start)
                    return
                if not message.get("more_body", False):
                    break

            replay = deque(buffered)

            async def receive_buffered() -> dict[str, Any]:
                if replay:
                    return replay.popleft()
                return {"type": "http.disconnect"}

            receive = receive_buffered

        try:
            await self.app(scope, receive, send_with_headers)
        finally:
            if is_protected:
                route = scope.get("route")
                endpoint = getattr(route, "path", safe_endpoint)
                self._audit(scope, method, endpoint, key_id, response_status, start)

    @staticmethod
    def _audit(scope: dict[str, Any], method: str, path: str, key_id: str, status: int, start: float) -> None:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        log.info("api_request method=%s endpoint=%s status=%s key_id=%s elapsed_ms=%s",
                 method, path, status, key_id, elapsed_ms)
