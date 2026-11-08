import uuid
from fastapi import APIRouter

from database.db import save_scan
from models import ScanRequest, ScanResponse
from services.risk_engine import calculate_risk

router = APIRouter()


@router.post("/scan", response_model=ScanResponse)
def scan(request: ScanRequest) -> dict:
    scan_dict = request.model_dump()
    outcome = calculate_risk(scan_dict)

    # Keep the API invariant explicit even when Python runs with assertions disabled.
    if sum(outcome["breakdown"].values()) != outcome["riskScore"]:
        raise RuntimeError("Risk engine returned an inconsistent breakdown.")

    # Full UUID entropy keeps report identifiers impractical to guess.
    scan_id = "scan_" + uuid.uuid4().hex
    result = {"id": scan_id, "url": request.url, **outcome}
    save_scan(scan_id, result)
    return result
