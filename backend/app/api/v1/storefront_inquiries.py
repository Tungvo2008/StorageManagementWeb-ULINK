from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import Product, ShowcaseItem, StorefrontInquiry

public_router = APIRouter(prefix="/public/store", tags=["storefront"])
internal_router = APIRouter(prefix="/internal/store", tags=["storefront-internal"])


class InquiryItem(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    quantity: int = Field(ge=1, le=10000)


class InquiryRequest(BaseModel):
    request_id: uuid.UUID
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    phone: str = Field(min_length=5, max_length=80)
    address: str = Field(min_length=5, max_length=500)
    company: str | None = Field(default=None, max_length=160)
    message: str | None = Field(default=None, max_length=2000)
    website: str = Field(default="", max_length=200)
    items: list[InquiryItem] = Field(min_length=1, max_length=30)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Invalid email address")
        return value


@public_router.post("/inquiries", status_code=201)
def create_inquiry(payload: InquiryRequest, response: Response, db: Session = Depends(get_db)) -> dict:
    response.headers["Cache-Control"] = "no-store"
    if payload.website:
        raise HTTPException(status_code=400, detail="Invalid submission")
    existing = db.scalar(select(StorefrontInquiry).where(StorefrontInquiry.request_id == str(payload.request_id)))
    if existing:
        response.status_code = 200
        return {"reference": existing.reference}
    if len({item.sku.casefold() for item in payload.items}) != len(payload.items):
        raise HTTPException(status_code=422, detail="Duplicate SKU")
    recent = datetime.now(timezone.utc) - timedelta(hours=1)
    count = db.scalar(select(func.count(StorefrontInquiry.id)).where(
        StorefrontInquiry.email == payload.email,
        StorefrontInquiry.created_at >= recent,
    )) or 0
    if count >= 5:
        raise HTTPException(status_code=429, detail="Too many inquiries")
    skus = [item.sku.strip() for item in payload.items]
    products = db.scalars(select(Product).where(
        func.lower(Product.sku).in_([sku.lower() for sku in skus]),
        Product.catalog_enabled.is_(True), Product.is_active.is_(True),
    )).all()
    by_sku = {p.sku.casefold(): (p.sku, p.name) for p in products}
    showcases = db.scalars(select(ShowcaseItem).where(
        func.lower(ShowcaseItem.code).in_([sku.lower() for sku in skus]),
        ShowcaseItem.is_active.is_(True),
    )).all()
    for showcase in showcases:
        by_sku[showcase.code.casefold()] = (showcase.code, showcase.name)
    if len(by_sku) != len(skus):
        raise HTTPException(status_code=422, detail="One or more products are unavailable")
    items = [{"sku": by_sku[item.sku.casefold()][0],
              "name": by_sku[item.sku.casefold()][1],
              "quantity": item.quantity} for item in payload.items]
    inquiry = StorefrontInquiry(
        request_id=str(payload.request_id),
        reference=f"ULQ-{datetime.now(timezone.utc):%Y%m%d}-{uuid.uuid4().hex[:8].upper()}",
        name=payload.name.strip(), email=payload.email,
        phone=(payload.phone or "").strip() or None,
        address=payload.address.strip(),
        company=(payload.company or "").strip() or None,
        message=(payload.message or "").strip() or None,
        items_json=json.dumps(items, ensure_ascii=False),
    )
    db.add(inquiry)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(StorefrontInquiry).where(StorefrontInquiry.request_id == str(payload.request_id)))
        if not existing:
            raise
        response.status_code = 200
        return {"reference": existing.reference}
    return {"reference": inquiry.reference}


def _serialize(inquiry: StorefrontInquiry) -> dict:
    return {
        "id": inquiry.id, "reference": inquiry.reference,
        "name": inquiry.name, "email": inquiry.email,
        "phone": inquiry.phone, "address": inquiry.address, "company": inquiry.company,
        "message": inquiry.message, "items": json.loads(inquiry.items_json),
        "created_at": inquiry.created_at.isoformat(),
        "telegram_notified": inquiry.telegram_notified_at is not None,
        "google_task_id": inquiry.google_task_id,
    }


@internal_router.get("/inquiries/pending")
def pending_inquiries(
    limit: int = Query(default=20, ge=1, le=100),
    channel: str = Query(default="all", pattern="^(all|telegram)$"),
    db: Session = Depends(get_db),
) -> list[dict]:
    pending = StorefrontInquiry.telegram_notified_at.is_(None)
    if channel == "all":
        pending = pending | StorefrontInquiry.google_task_id.is_(None)
    records = db.scalars(select(StorefrontInquiry).where(pending)
                         .order_by(StorefrontInquiry.created_at).limit(limit)).all()
    return [_serialize(row) for row in records]


class InquiryAck(BaseModel):
    channel: str
    google_task_id: str | None = None


@internal_router.post("/inquiries/{inquiry_id}/ack")
def ack_inquiry(inquiry_id: int, payload: InquiryAck, db: Session = Depends(get_db)) -> dict:
    inquiry = db.get(StorefrontInquiry, inquiry_id)
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    if payload.channel == "telegram":
        inquiry.telegram_notified_at = datetime.now(timezone.utc)
    elif payload.channel == "google_task" and payload.google_task_id:
        inquiry.google_task_id = payload.google_task_id
    else:
        raise HTTPException(status_code=422, detail="Invalid channel")
    db.commit()
    return {"ok": True}

# Service consultations reuse the durable inquiry queue and its private Zen delivery.
# They deliberately contain no invented SKU and never generate/send a priced quote.
from typing import Literal

SERVICE_NAMES = {
    'not-sure': 'Tư vấn chọn dịch vụ', 'fda-us-agent': 'FDA & US Agent',
    'fulfillment': 'Fulfillment tại Mỹ', 'vietnam-us-shipping': 'Vận chuyển Việt–Mỹ',
    'warehousing': 'Kho bãi tại Mỹ', 'distribution': 'Phân phối hàng hóa',
    'wholesale': 'Nguồn hàng & Wholesale',
}


class ConsultationRequest(BaseModel):
    request_id: uuid.UUID
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    phone: str = Field(min_length=5, max_length=80)
    service: Literal['not-sure', 'fda-us-agent', 'fulfillment', 'vietnam-us-shipping', 'warehousing', 'distribution', 'wholesale']
    need: str = Field(min_length=5, max_length=1200)
    country: Literal['', 'US', 'VN', 'OTHER'] = ''
    goods: str = Field(default='', max_length=160)
    quantity: str = Field(default='', max_length=120)
    company: str = Field(default='', max_length=160)
    origin: str = Field(default='', max_length=160)
    destination: str = Field(default='', max_length=160)
    shipping_method: Literal['', 'air', 'sea', 'not-sure'] = ''
    timeline: str = Field(default='', max_length=160)
    journey: Literal['', 'export-to-usa', 'sell-in-usa'] = ''
    locale: Literal['vi', 'en'] = 'vi'
    consent: Literal[True]
    website: str = Field(default='', max_length=200)

    @field_validator('name', 'phone', 'need', mode='before')
    @classmethod
    def trim_required(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator('email')
    @classmethod
    def valid_email(cls, value):
        return InquiryRequest.valid_email(value)


@public_router.post('/consultations', status_code=201)
def create_consultation(payload: ConsultationRequest, response: Response, db: Session = Depends(get_db)) -> dict:
    response.headers['Cache-Control'] = 'no-store'
    if payload.website:
        raise HTTPException(status_code=400, detail='Invalid submission')
    existing = db.scalar(select(StorefrontInquiry).where(StorefrontInquiry.request_id == str(payload.request_id)))
    if existing:
        if not existing.reference.startswith('ULC-'):
            raise HTTPException(status_code=409, detail='Request ID already used')
        response.status_code = 200
        return {'reference': existing.reference}
    recent = datetime.now(timezone.utc) - timedelta(hours=1)
    count = db.scalar(select(func.count(StorefrontInquiry.id)).where(
        StorefrontInquiry.email == payload.email, StorefrontInquiry.created_at >= recent,
    )) or 0
    if count >= 5:
        raise HTTPException(status_code=429, detail='Too many inquiries')
    country = {'US': 'Mỹ', 'VN': 'Việt Nam', 'OTHER': 'Nơi khác', '': 'Chưa cung cấp'}[payload.country]
    journey = {'export-to-usa': 'Đưa hàng Việt sang Mỹ', 'sell-in-usa': 'Bán hàng tại Mỹ', '': 'Chưa chọn'}[payload.journey]
    message = '\n'.join([
        '[ULINK SERVICE CONSULTATION]', 'Dịch vụ: ' + SERVICE_NAMES[payload.service],
        'Hành trình: ' + journey, 'Khách ở: ' + country,
        'Loại hàng: ' + (payload.goods.strip() or 'Chưa cung cấp'),
        'Số lượng/trọng lượng: ' + (payload.quantity.strip() or 'Chưa cung cấp'),
        'Nơi gửi: ' + (payload.origin.strip() or 'Chưa cung cấp'),
        'Nơi nhận: ' + (payload.destination.strip() or 'Chưa cung cấp'),
        'Phương thức: ' + ({'air':'Air', 'sea':'Sea', 'not-sure':'Nhờ tư vấn', '':'Chưa cung cấp'}[payload.shipping_method]),
        'Thời gian dự kiến: ' + (payload.timeline.strip() or 'Chưa cung cấp'),
        'Ngôn ngữ: ' + payload.locale, 'Nhu cầu: ' + payload.need,
        'Khách đồng ý ULINK liên hệ về yêu cầu này.',
    ])
    inquiry = StorefrontInquiry(
        request_id=str(payload.request_id),
        reference=f'ULC-{datetime.now(timezone.utc):%Y%m%d}-{uuid.uuid4().hex[:8].upper()}',
        name=payload.name, email=payload.email, phone=payload.phone,
        address=country, company=payload.company.strip() or None, message=message, items_json='[]',
    )
    db.add(inquiry)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(StorefrontInquiry).where(StorefrontInquiry.request_id == str(payload.request_id)))
        if not existing or not existing.reference.startswith('ULC-'):
            raise
        response.status_code = 200
        return {'reference': existing.reference}
    return {'reference': inquiry.reference}
