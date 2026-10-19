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

    # Contract rule: the three parts add up EXACTLY to riskScore.
    assert sum(outcome["breakdown"].values()) == outcome["riskScore"]

    scan_id = "scan_" + uuid.uuid4().hex[:8]
    result = {"id": scan_id, "url": request.url, **outcome}
    save_scan(scan_id, scan_dict, result)
    return result
