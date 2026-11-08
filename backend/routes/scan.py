import uuid
import ipaddress
import os
import re
from urllib.parse import urlsplit
from fastapi import APIRouter, Header, HTTPException, Request

from database.db import save_scan
from models import ScanRequest, ScanResponse
from services.risk_engine import calculate_risk
from services.tls_checker import check_tls
from services.firebase_store import record_visit
from routes.accounts import authenticate_extension

router = APIRouter()


@router.post("/scan", response_model=ScanResponse)
def scan(request: ScanRequest, http_request: Request,
         authorization: str | None = Header(default=None),
         save_history: str | None = Header(default=None, alias="X-PrivacyGuard-Save-History")) -> dict:
    account = authenticate_extension(authorization)
    if not account and os.getenv("APP_ENV", "development").lower() == "production":
        raise HTTPException(status_code=401, detail="Connect the extension to a PrivacyGuard account to scan.")
    scan_dict = request.model_dump()
    # Never trust a client-supplied TLS claim. The backend checks the URL itself.
    local_client = False
    if http_request.client:
        try:
            local_client = ipaddress.ip_address(http_request.client.host).is_loopback
        except ValueError:
            pass
    origin = urlsplit(http_request.headers.get("origin", ""))
    extension_origin = (
        origin.scheme == "chrome-extension"
        and re.fullmatch(r"[a-p]{32}", origin.hostname or "") is not None
        and origin.path in ("", "/")
    )
    # A reverse proxy can make a remote caller appear local. Do not perform
    # outbound checks when standard proxy headers are present.
    proxied = any(name in http_request.headers for name in ("forwarded", "x-forwarded-for", "x-real-ip"))
    can_probe_tls = local_client and extension_origin and not proxied
    scan_dict["tls"] = check_tls(request.url, allow_private=True) if request.https and can_probe_tls else None
    outcome = calculate_risk(scan_dict)

    # Keep the API invariant explicit even when Python runs with assertions disabled.
    if sum(outcome["breakdown"].values()) != outcome["riskScore"]:
        raise RuntimeError("Risk engine returned an inconsistent breakdown.")

    # Full UUID entropy keeps report identifiers impractical to guess.
    scan_id = "scan_" + uuid.uuid4().hex
    result = {"id": scan_id, "url": request.url, "tls": scan_dict["tls"], **outcome}
    host_for_history = None
    stored_result = result
    if account:
        parsed_url = None
        try:
            parsed_url = urlsplit(request.url)
            host_for_history = parsed_url.hostname
        except ValueError:
            host_for_history = None
        if not parsed_url or parsed_url.scheme not in ("http", "https") or not host_for_history:
            raise HTTPException(status_code=400, detail="Scan URL must be an HTTP or HTTPS URL.")
        # Reports are retained separately from the user-facing history. Redact
        # paths and query strings there too for scans linked to an account.
        safe_authority = f"[{host_for_history}]" if ":" in host_for_history else host_for_history
        safe_url = f"{parsed_url.scheme}://{safe_authority}/"
        stored_result = {**result, "url": safe_url}
    save_scan(scan_id, stored_result)
    if account and host_for_history and save_history == "true":
        # Store only the hostname and summary; discard paths, query strings,
        # page contents, and scan details from account history.
        record_visit(account["id"], host_for_history, outcome["riskScore"],
                     outcome["riskLevel"], scan_dict["tls"], outcome["breakdown"])
    return result
