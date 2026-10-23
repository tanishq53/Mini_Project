import re

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from database.db import get_result

router = APIRouter()

# Unknown report IDs use the existing not-found behavior without disclosing stored details.
NOT_FOUND_CODE = "INVALID_INPUT"


@router.get("/report/{scan_id}")
def report(scan_id: str):
    if not re.fullmatch(r"scan_[0-9a-f]{8}(?:[0-9a-f]{24})?", scan_id):
        return JSONResponse(status_code=404, content={
            "error": True, "code": "INVALID_INPUT", "message": "No report found for that id."})
    result = get_result(scan_id)
    if result is None:
        return JSONResponse(status_code=404, content={
            "error": True, "code": NOT_FOUND_CODE,
            "message": "No report found for that id."})
    return result
