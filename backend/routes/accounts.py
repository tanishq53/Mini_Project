"""Firebase-authenticated dashboard and per-user Firestore history APIs."""
import logging
from typing import Literal

from fastapi import APIRouter, Header, HTTPException

from services import firebase_store

log = logging.getLogger("privacyguard.firebase")
router = APIRouter(prefix="/api")


def current_user(authorization: str | None) -> dict:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in to PrivacyGuard to continue.")
    try:
        return firebase_store.verify_id_token(token)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Firebase authentication failed")
        raise HTTPException(status_code=503, detail="Firebase authentication is temporarily unavailable.") from exc


@router.get("/firebase-config")
def get_firebase_config():
    config = firebase_store.web_config()
    return {"configured": firebase_store.web_configured(), "config": config if firebase_store.web_configured() else None}


@router.get("/auth/me")
def me(authorization: str | None = Header(default=None)):
    return current_user(authorization)


@router.post("/extension-key")
def create_extension_key(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    try:
        return {"token": firebase_store.rotate_extension_key(user["id"])}
    except Exception as exc:
        log.exception("Could not create Firebase extension key")
        raise HTTPException(status_code=503, detail="Could not reach Firebase. Check the Admin SDK configuration.") from exc


@router.get("/extension-key")
def extension_key_status(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    try:
        return {"connected": firebase_store.has_extension_key(user["id"])}
    except Exception as exc:
        log.exception("Could not read Firebase extension key status")
        raise HTTPException(status_code=503, detail="Could not reach Firebase. Check the Admin SDK configuration.") from exc


@router.delete("/extension-key")
def delete_extension_key(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    try:
        firebase_store.revoke_extension_key(user["id"])
        return {"ok": True}
    except Exception as exc:
        log.exception("Could not revoke Firebase extension key")
        raise HTTPException(status_code=503, detail="Could not reach Firebase. Check the Admin SDK configuration.") from exc


@router.get("/history")
def history(period: Literal["day", "week", "month"] = "week",
            authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    days = {"day": 1, "week": 7, "month": 30}[period]
    try:
        return {"period": period, **firebase_store.read_history(user["id"], days)}
    except Exception as exc:
        log.exception("Could not read Firebase visit history")
        raise HTTPException(status_code=503, detail="Could not load visit history from Firebase.") from exc


@router.delete("/history")
def delete_history(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    try:
        firebase_store.clear_history(user["id"])
        return {"ok": True}
    except Exception as exc:
        log.exception("Could not clear Firebase visit history")
        raise HTTPException(status_code=503, detail="Could not clear visit history from Firebase.") from exc


def authenticate_extension(authorization: str | None) -> dict | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Invalid extension authorization.")
    try:
        if token.startswith("pg_"):
            user = firebase_store.get_api_user(token)
            if not user:
                raise HTTPException(status_code=401, detail="Extension key is invalid or has been replaced.")
            return user
        return firebase_store.verify_id_token(token)
    except HTTPException:
        raise
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Firebase extension authorization failed")
        raise HTTPException(status_code=503, detail="Firebase is temporarily unavailable.") from exc
