"""Private CRM state, separate from public inquiry and product data."""
from datetime import datetime, timezone
from typing import Literal
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import String, Text, Integer, ForeignKey, select, update
from sqlalchemy.orm import Mapped, mapped_column, Session
from sqlalchemy.exc import IntegrityError
from app.api.deps import get_db, get_current_user
from app.db.base import Base
from app.db.models import StorefrontInquiry, User

class LeadState(Base):
    __tablename__ = 'storefront_lead_states'
    inquiry_id: Mapped[int] = mapped_column(ForeignKey('storefront_inquiries.id'), primary_key=True)
    stage: Mapped[str] = mapped_column(String(24), default='new')
    follow_up_at: Mapped[str | None] = mapped_column(String(40))
    version: Mapped[int] = mapped_column(Integer, default=1)

class LeadEvent(Base):
    __tablename__ = 'storefront_lead_events'
    id: Mapped[int] = mapped_column(primary_key=True)
    inquiry_id: Mapped[int] = mapped_column(ForeignKey('storefront_inquiries.id'), index=True)
    actor: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[str] = mapped_column(String(40))
    detail: Mapped[str] = mapped_column(Text)

Stage = Literal['new', 'contacted', 'consulting', 'quoted', 'won', 'lost']
class LeadUpdate(BaseModel):
    stage: Stage
    follow_up_at: datetime | None = None
    note: str = Field(default='', max_length=2000)
    version: int = Field(ge=0)

    @field_validator('follow_up_at')
    @classmethod
    def require_timezone(cls, value):
        if value and value.tzinfo is None:
            raise ValueError('Timezone required')
        return value

router = APIRouter(prefix='/quotes/leads', tags=['leads'])

def state_data(row):
    return {'stage': row.stage if row else 'new', 'follow_up_at': row.follow_up_at if row else None, 'version': row.version if row else 0}

@router.get('')
def list_leads(db: Session = Depends(get_db)):
    inquiries = db.scalars(select(StorefrontInquiry).order_by(StorefrontInquiry.created_at.desc())).all()
    states = {s.inquiry_id:s for s in db.scalars(select(LeadState)).all()}
    return [dict(id=i.id, reference=i.reference, name=i.name, email=i.email, phone=i.phone,
                 address=i.address, company=i.company, message=i.message, items=json.loads(i.items_json),
                 kind='consultation' if i.reference.startswith('ULC-') else 'wholesale',
                 created_at=i.created_at.isoformat(), **state_data(states.get(i.id))) for i in inquiries]

@router.get('/{inquiry_id}/history')
def history(inquiry_id:int, db:Session=Depends(get_db)):
    if not db.get(StorefrontInquiry, inquiry_id): raise HTTPException(404, 'Inquiry not found')
    return [dict(id=e.id, actor=e.actor, created_at=e.created_at, **json.loads(e.detail)) for e in db.scalars(
        select(LeadEvent).where(LeadEvent.inquiry_id==inquiry_id).order_by(LeadEvent.id.desc())).all()]

@router.patch('/{inquiry_id}')
def update_lead(inquiry_id:int, payload:LeadUpdate, db:Session=Depends(get_db), user:User=Depends(get_current_user)):
    if not db.get(StorefrontInquiry, inquiry_id): raise HTTPException(404, 'Inquiry not found')
    row = db.get(LeadState, inquiry_id)
    before = state_data(row)
    if before['version'] != payload.version: raise HTTPException(409, 'Lead changed. Refresh before saving.')
    due = payload.follow_up_at.astimezone(timezone.utc).isoformat() if payload.follow_up_at else None
    if before['stage']==payload.stage and before['follow_up_at']==due and not payload.note.strip(): return before
    try:
        if row:
            changed = db.execute(update(LeadState).where(LeadState.inquiry_id==inquiry_id, LeadState.version==payload.version)
                .values(stage=payload.stage, follow_up_at=due, version=payload.version+1))
            if changed.rowcount!=1: raise HTTPException(409, 'Lead changed. Refresh before saving.')
        else:
            db.add(LeadState(inquiry_id=inquiry_id, stage=payload.stage, follow_up_at=due, version=1))
        db.add(LeadEvent(inquiry_id=inquiry_id, actor=str(getattr(user,'username',None) or user.id),
            created_at=datetime.now(timezone.utc).isoformat(), detail=json.dumps({
                'from_stage':before['stage'], 'to_stage':payload.stage, 'follow_up_at':due, 'note':payload.note.strip()},ensure_ascii=False)))
        db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409, 'Lead changed. Refresh before saving.')
    return state_data(db.get(LeadState,inquiry_id))
