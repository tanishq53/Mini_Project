"""Pydantic models that mirror docs/contract.md (version 1.2) exactly.
Field names are camelCase and case-sensitive, so we use them as-is."""
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Loose(BaseModel):
    # Ignore extra fields so a harmless addition by another module never breaks /scan.
    model_config = ConfigDict(extra="ignore")


class FieldTypes(Loose):
    # All eight keys are required, even when the count is 0.
    name: int = Field(ge=0)
    email: int = Field(ge=0)
    phone: int = Field(ge=0)
    address: int = Field(ge=0)
    dob: int = Field(ge=0)
    password: int = Field(ge=0)
    financial: int = Field(ge=0)
    governmentId: int = Field(ge=0)


class Scanner(Loose):
    forms: int = Field(ge=0)
    personalDataFields: int = Field(ge=0)
    fieldTypes: FieldTypes
    fields: Optional[List[Dict[str, Any]]] = None  # optional detail list, never user-typed values

    @model_validator(mode="after")
    def check_sum(self):
        # Contract rule: personalDataFields equals the sum of fieldTypes.
        if self.personalDataFields != sum(self.fieldTypes.model_dump().values()):
            raise ValueError("personalDataFields must equal the sum of fieldTypes")
        return self


class Cookies(Loose):
    total: int = Field(ge=0)
    firstParty: int = Field(ge=0)
    thirdParty: int = Field(ge=0)

    @model_validator(mode="after")
    def check_total(self):
        if self.total != self.firstParty + self.thirdParty:
            raise ValueError("cookies.total must equal firstParty + thirdParty")
        return self


class Trackers(Loose):
    analytics: int = Field(ge=0)
    advertising: int = Field(ge=0)
    social: int = Field(ge=0)
    unknown: int = Field(ge=0)


class Tracking(Loose):
    cookies: Cookies
    thirdPartyScripts: int = Field(ge=0)
    trackers: Trackers
    trackerList: Optional[List[Dict[str, Any]]] = None


class Policy(Loose):
    # Phase 1: accepted but ignored by the risk engine.
    found: bool = False
    url: Optional[str] = None
    candidates: List[Dict[str, Any]] = Field(default_factory=list)


class ScanRequest(Loose):
    url: str
    hostname: str
    scannedAt: str
    https: Optional[bool] = None  # only an explicit false is penalised
    scanner: Scanner
    tracking: Tracking
    policy: Policy = Field(default_factory=Policy)


class Breakdown(Loose):
    personalData: int = Field(ge=0)
    trackers: int = Field(ge=0)
    security: int = Field(ge=0)


class ScanResponse(Loose):
    id: str
    url: str
    riskScore: int = Field(ge=0, le=100)
    riskLevel: Literal["Low", "Moderate", "High", "Very High"]
    breakdown: Breakdown
    recommendations: List[str] = Field(max_length=5)

    @model_validator(mode="after")
    def check_score(self):
        if sum(self.breakdown.model_dump().values()) != self.riskScore:
            raise ValueError("breakdown must sum to riskScore")
        expected = next(
            level for upper, level in [(25, "Low"), (50, "Moderate"), (75, "High"), (100, "Very High")]
            if self.riskScore <= upper
        )
        if self.riskLevel != expected:
            raise ValueError("riskLevel must match riskScore")
        return self
