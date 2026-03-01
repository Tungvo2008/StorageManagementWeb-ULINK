from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.security import get_password_hash
from app.db.models import User
from app.schemas.user import UserCreate, UserRead, UserUpdate


router = APIRouter(prefix="/users")


def _active_user_count(db: Session) -> int:
    return int(db.scalar(select(func.count(User.id)).where(User.is_active.is_(True))) or 0)


@router.get("", response_model=list[UserRead])
def list_users(skip: int = 0, limit: int = 200, db: Session = Depends(get_db)) -> list[User]:
    stmt = select(User).order_by(User.id.asc()).offset(skip).limit(limit)
    return db.scalars(stmt).all()


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: int, db: Session = Depends(get_db)) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, db: Session = Depends(get_db)) -> User:
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username must not be empty")

    exists = db.scalar(select(User).where(func.lower(User.username) == username.lower()))
    if exists is not None:
        raise HTTPException(status_code=409, detail="username already exists")

    user = User(
        username=username,
        password_hash=get_password_hash(body.password),
        is_active=bool(body.is_active),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserRead)
def patch_user(
    user_id: int,
    body: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    data = body.model_dump(exclude_unset=True)
    if "username" in data and data["username"] is not None:
        username = data["username"].strip()
        if not username:
            raise HTTPException(status_code=400, detail="username must not be empty")
        dup = db.scalar(
            select(User).where(func.lower(User.username) == username.lower(), User.id != user.id)
        )
        if dup is not None:
            raise HTTPException(status_code=409, detail="username already exists")
        user.username = username

    if "password" in data and data["password"]:
        user.password_hash = get_password_hash(data["password"])

    if "is_active" in data and data["is_active"] is not None:
        next_active = bool(data["is_active"])
        if user.id == current_user.id and not next_active:
            raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
        if user.is_active and not next_active and _active_user_count(db) <= 1:
            raise HTTPException(status_code=400, detail="Cannot deactivate last active user")
        user.is_active = next_active

    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    user = db.get(User, user_id)
    if user is None:
        return
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    if user.is_active and _active_user_count(db) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete last active user")
    db.delete(user)
    db.commit()
