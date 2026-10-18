from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, desc, or_
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.db.models import BotInteractionLog, User
from app.schemas.bot_log import BotInteractionLogCreate, BotInteractionLogRead, BotInteractionLogUpdate

router = APIRouter(prefix="/bot-logs")


@router.get("", response_model=List[BotInteractionLogRead])
def list_bot_logs(
    skip: int = 0,
    limit: int = 50,
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[BotInteractionLog]:
    stmt = select(BotInteractionLog)
    if search:
        s = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                BotInteractionLog.user_query.ilike(s),
                BotInteractionLog.bot_response.ilike(s),
                BotInteractionLog.sender.ilike(s),
            )
        )
    stmt = stmt.order_by(desc(BotInteractionLog.id)).offset(skip).limit(limit)
    return db.scalars(stmt).all()


@router.post("", response_model=BotInteractionLogRead, status_code=status.HTTP_201_CREATED)
def create_bot_log(
    body: BotInteractionLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BotInteractionLog:
    log_entry = BotInteractionLog(
        sender=body.sender,
        channel=body.channel,
        user_query=body.user_query,
        bot_response=body.bot_response,
        tools_called=body.tools_called,
        status=body.status,
    )
    db.add(log_entry)
    db.commit()
    db.refresh(log_entry)
    return log_entry


@router.patch("/{log_id}", response_model=BotInteractionLogRead)
def update_bot_log(
    log_id: int,
    body: BotInteractionLogUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BotInteractionLog:
    entry = db.get(BotInteractionLog, log_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Bot log not found")
    if body.bot_response is not None:
        entry.bot_response = body.bot_response
    if body.tools_called is not None:
        entry.tools_called = body.tools_called
    if body.status is not None:
        entry.status = body.status
    db.commit()
    db.refresh(entry)
    return entry



@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bot_log(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    entry = db.get(BotInteractionLog, log_id)
    if entry:
        db.delete(entry)
        db.commit()
