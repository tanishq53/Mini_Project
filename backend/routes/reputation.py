from fastapi import APIRouter
from pydantic import AnyHttpUrl, BaseModel

from services.site_reputation import check_site_reputation

router = APIRouter()


class ReputationRequest(BaseModel):
    url: AnyHttpUrl


@router.post("/reputation")
def reputation(request: ReputationRequest) -> dict:
    return check_site_reputation(str(request.url))
