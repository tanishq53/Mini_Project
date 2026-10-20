from fastapi import APIRouter
from fastapi.responses import JSONResponse

from database.db import get_result

router = APIRouter()

# OPEN: the contract has no "not found" code yet. Ask Tanishq, then change this.
NOT_FOUND_CODE = "INVALID_INPUT"


@router.get("/report/{scan_id}")
def report(scan_id: str):
    result = get_result(scan_id)
    if result is None:
        return JSONResponse(status_code=404, content={
            "error": True, "code": NOT_FOUND_CODE,
            "message": f"No report found for id {scan_id}."})
    return result
