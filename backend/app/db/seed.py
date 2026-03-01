from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_password_hash
from app.db.models import User
from app.db.session import engine


def ensure_admin_user() -> None:
    username = (settings.ADMIN_USERNAME or "").strip()
    password = settings.ADMIN_PASSWORD or ""
    if not username or not password:
        return

    with Session(engine) as db:
        existing = db.scalar(select(User).where(User.username == username))
        if existing is not None:
            return
        admin = User(username=username, password_hash=get_password_hash(password), is_active=True)
        db.add(admin)
        db.commit()

