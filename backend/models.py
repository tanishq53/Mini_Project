"""Validated request/response models for the Phase 1 API."""
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class FieldTypes(StrictInput):
    # All eight keys are required, even when the count is 0.
    name: int = Field(ge=0, le=5000)
    email: int = Field(ge=0, le=5000)
    phone: int = Field(ge=0, le=5000)
    address: int = Field(ge=0, le=5000)
    dob: int = Field(ge=0, le=5000)
    password: int = Field(ge=0, le=5000)
    financial: int = Field(ge=0, le=5000)
    governmentId: int = Field(ge=0, le=5000)


class FieldDetail(BaseModel):
    # Forbid extra keys such as `value`, so raw form contents cannot be persisted.
    model_config = ConfigDict(extra="forbid", strict=True)

    category: Literal["name", "email", "phone", "address", "dob", "password", "financial", "governmentId"]
    name: str = Field(max_length=256)
    type: str = Field(max_length=64)
    formIndex: int = Field(ge=-1, le=5000)


class TrackerDetail(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    domain: str = Field(min_length=1, max_length=253)
    category: Literal["analytics", "advertising", "social", "unknown"]

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, value: str) -> str:
        if any(char.isspace() for char in value) or "/" in value or "@" in value:
            raise ValueError("tracker domain must be a hostname")
        try:
            hostname = urlsplit(f"//{value}").hostname
        except ValueError as exc:
            raise ValueError("tracker domain must be a hostname") from exc
        if not hostname or hostname.lower().rstrip(".") != value.lower().rstrip(".").strip("[]"):
            raise ValueError("tracker domain must be a hostname")
        return value


class Scanner(StrictInput):
    forms: int = Field(ge=0, le=5000)
    personalDataFields: int = Field(ge=0, le=5000)
    fieldTypes: FieldTypes
    fields: Optional[List[FieldDetail]] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def check_sum(self):
        # Contract rule: personalDataFields equals the sum of fieldTypes.
        if self.personalDataFields != sum(self.fieldTypes.model_dump().values()):
            raise ValueError("personalDataFields must equal the sum of fieldTypes")
        return self


class Cookies(StrictInput):
    total: int = Field(ge=0, le=20000)
    firstParty: int = Field(ge=0, le=20000)
    thirdParty: int = Field(ge=0, le=20000)

    @model_validator(mode="after")
    def check_total(self):
        if self.total != self.firstParty + self.thirdParty:
            raise ValueError("cookies.total must equal firstParty + thirdParty")
        return self


class Trackers(StrictInput):
    analytics: int = Field(ge=0, le=5000)
    advertising: int = Field(ge=0, le=5000)
    social: int = Field(ge=0, le=5000)
    unknown: int = Field(ge=0, le=5000)


class Tracking(StrictInput):
    cookies: Cookies
    thirdPartyScripts: int = Field(ge=0, le=1000)
    trackers: Trackers
    trackerList: Optional[List[TrackerDetail]] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def check_tracker_details(self):
        actual = self.trackers.model_dump()
        if sum(actual.values()) != self.thirdPartyScripts:
            raise ValueError("thirdPartyScripts must equal the sum of tracker categories")
        if self.trackerList is not None:
            if len(self.trackerList) != self.thirdPartyScripts:
                raise ValueError("thirdPartyScripts must match trackerList length when trackerList is supplied")
            listed = {key: 0 for key in actual}
            for tracker in self.trackerList:
                listed[tracker.category] += 1
            if listed != actual:
                raise ValueError("trackers must match trackerList categories")
        return self


class Policy(StrictInput):
    # Phase 1: accepted but ignored by the risk engine.
    found: bool = False
    url: Optional[str] = None
    candidates: List[Dict[str, Any]] = Field(default_factory=list)


class ScanRequest(StrictInput):
    url: str = Field(min_length=8, max_length=2048)
    hostname: str = Field(min_length=1, max_length=253)
    scannedAt: str = Field(min_length=20, max_length=64)
    https: Optional[bool] = None  # only an explicit false is penalised
    scanner: Scanner
    tracking: Tracking
    policy: Policy = Field(default_factory=Policy)

    @field_validator("url")
    @classmethod
    def validate_and_reduce_url(cls, value: str) -> str:
        try:
            parsed = urlsplit(value)
            hostname = parsed.hostname
            _ = parsed.port
        except ValueError as exc:
            raise ValueError("url must be a valid HTTP or HTTPS URL") from exc
        if parsed.scheme not in {"http", "https"} or not hostname:
            raise ValueError("url must be a valid HTTP or HTTPS URL")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("url must not contain credentials")
        # Paths, query strings, and fragments can identify a user or contain session data.
        return urlunsplit((parsed.scheme, parsed.netloc, "/", "", ""))

    @field_validator("scannedAt")
    @classmethod
    def validate_timestamp(cls, value: str) -> str:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("scannedAt must be an ISO 8601 timestamp") from exc
        if parsed.tzinfo is None:
            raise ValueError("scannedAt must include a timezone")
        return value

    @model_validator(mode="after")
    def check_hostname_matches_url(self):
        url_host = (urlsplit(self.url).hostname or "").lower().rstrip(".").strip("[]")
        supplied_host = self.hostname.lower().rstrip(".").strip("[]")
        if supplied_host != url_host:
            raise ValueError("hostname must match url")
        return self


class Breakdown(StrictInput):
    personalData: int = Field(ge=0)
    trackers: int = Field(ge=0)
    security: int = Field(ge=0)


class ScanResponse(StrictInput):
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
