from __future__ import annotations

import os
from collections.abc import Generator
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.models import User
from app.db.session import SessionLocal

BOT_API_KEY = os.environ.get("CARGO_BOT_KEY", "trustcargo_bot_secret_2026")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    # 1. Check Bot API Key header
    bot_key = request.headers.get("X-Bot-Key") or request.headers.get("X-API-Key")
    if bot_key and bot_key == BOT_API_KEY:
        user = db.scalar(select(User).where(User.is_active == True).order_by(User.id.asc()))
        if user is not None:
            return user

    # 2. Check Bearer Token
    if not creds or not creds.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    token = creds.credentials
    try:
        payload = decode_token(token)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    try:
        user_id = int(sub)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.scalar(select(User).where(User.id == user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user



from app.core.config import settings

def verify_storefront_access(request: Request) -> None:
    secret_header = request.headers.get("X-Storefront-Secret")
    valid_secrets = {
        getattr(settings, "STOREFRONT_SECRET_KEY", None),
        getattr(settings, "TOWELSHAVEN_SECRET_KEY", None),
    }
    # Filter None and empty strings
    valid_secrets = {s for s in valid_secrets if s}
    if not secret_header or secret_header not in valid_secrets:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Valid X-Storefront-Secret header is required.",
        )
