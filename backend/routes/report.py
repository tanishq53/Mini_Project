import os
import re

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

from database.db import get_result
from routes.accounts import authenticate_extension

router = APIRouter()

# Unknown report IDs use the existing not-found behavior without disclosing stored details.
NOT_FOUND_CODE = "INVALID_INPUT"


@router.get("/report/{scan_id}")
def report(scan_id: str, authorization: str | None = Header(default=None)):
    account = authenticate_extension(authorization)
    if not account and os.getenv("APP_ENV", "development").lower() == "production":
        raise HTTPException(status_code=401, detail="Connect the extension to a PrivacyGuard account to read reports.")
    if not re.fullmatch(r"scan_[0-9a-f]{8}(?:[0-9a-f]{24})?", scan_id):
        return JSONResponse(status_code=404, content={
            "error": True, "code": "INVALID_INPUT", "message": "No report found for that id."})
    result = get_result(scan_id)
    if result is None:
        return JSONResponse(status_code=404, content={
            "error": True, "code": NOT_FOUND_CODE,
            "message": "No report found for that id."})
    return result
