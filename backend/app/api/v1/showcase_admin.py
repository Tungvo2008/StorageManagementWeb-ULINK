from __future__ import annotations

import json
import re
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from PIL import Image, ImageOps, UnidentifiedImageError

from app.api.deps import get_db
from app.api.v1.storefront import slugify
from app.db.models import Product, ShowcaseItem

router = APIRouter(prefix="/showcase", tags=["showcase-admin"])
IMAGE_DIR = Path(__file__).resolve().parents[3] / "assets" / "product-images"
IMAGE_PREFIX = "/api/v1/public/product-images/"


class ShowcasePayload(BaseModel):
    code: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=2, max_length=255)
    category: str = Field(min_length=2, max_length=128)
    description: str | None = Field(default=None, max_length=10000)
    highlights: list[str] = Field(default_factory=list, max_length=12)
    specifications: dict[str, str] = Field(default_factory=dict)
    image_url: str | None = Field(default=None, max_length=2048)
    images: list[str] = Field(default_factory=list, max_length=12)
    min_order_quantity: int = Field(default=1, ge=1, le=1000000)
    lead_time: str | None = Field(default=None, max_length=128)
    brand: str | None = Field(default="ULINK", max_length=128)
    badges: list[str] = Field(default_factory=list, max_length=10)
    sort_order: int = Field(default=0, ge=0, le=1000000)
    is_active: bool = False

    @field_validator("code")
    @classmethod
    def valid_code(cls, value: str) -> str:
        value = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]*", value):
            raise ValueError("Code must use A-Z, 0-9, underscore or hyphen")
        return value

    @field_validator("name", "category")
    @classmethod
    def required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field is required")
        return value

    @field_validator("image_url")
    @classmethod
    def valid_primary_image(cls, value: str | None) -> str | None:
        return _image_url(value)

    @field_validator("images")
    @classmethod
    def valid_gallery(cls, values: list[str]) -> list[str]:
        return [v for v in (_image_url(x) for x in values) if v]

    @field_validator("highlights", "badges")
    @classmethod
    def clean_tags(cls, values: list[str]) -> list[str]:
        return [v.strip()[:250] for v in values if v.strip()]

    @field_validator("specifications")
    @classmethod
    def clean_specs(cls, values: dict[str, str]) -> dict[str, str]:
        return {k.strip()[:100]: v.strip()[:1000] for k, v in values.items() if k.strip()}


def _image_url(value: str | None) -> str | None:
    if not value or not value.strip():
        return None
    value = value.strip()
    if value.startswith(IMAGE_PREFIX) or value.startswith("https://") or value.startswith("http://"):
        return value
    raise ValueError("Image URL must be https://, http:// or a managed image path")


def _json(value: str | None, fallback):
    try:
        result = json.loads(value or "")
        return result if isinstance(result, type(fallback)) else fallback
    except (ValueError, TypeError):
        return fallback


def _out(item: ShowcaseItem) -> dict:
    return {"id": item.id, "code": item.code, "name": item.name,
            "category": item.category, "category_slug": item.category_slug,
            "description": item.description or "", "highlights": _json(item.highlights, []),
            "specifications": _json(item.specifications, {}), "image_url": item.image_url,
            "images": _json(item.images, []), "min_order_quantity": item.min_order_quantity,
            "lead_time": item.lead_time or "", "brand": item.brand or "",
            "badges": _json(item.badges, []), "sort_order": item.sort_order,
            "is_active": item.is_active, "created_at": item.created_at.isoformat(),
            "updated_at": item.updated_at.isoformat()}


def _check_unique(db: Session, code: str, current_id: int | None = None) -> None:
    existing = db.scalar(select(ShowcaseItem).where(func.lower(ShowcaseItem.code) == code.lower()))
    if existing and existing.id != current_id:
        raise HTTPException(409, "Showcase code already exists")
    inventory = db.scalar(select(Product.id).where(func.lower(Product.sku) == code.lower()))
    if inventory:
        raise HTTPException(409, "Code already exists in inventory")


def _apply(item: ShowcaseItem, data: ShowcasePayload) -> None:
    fields = data.model_dump()
    for key in ("highlights", "specifications", "images", "badges"):
        fields[key] = json.dumps(fields[key], ensure_ascii=False)
    fields["category_slug"] = slugify(data.category)
    if not fields["category_slug"]:
        raise HTTPException(422, "Category needs a valid URL slug")
    for key, value in fields.items():
        setattr(item, key, value)


@router.get("")
def list_items(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(ShowcaseItem).order_by(ShowcaseItem.sort_order, ShowcaseItem.id)).all()
    return [_out(x) for x in rows]


@router.post("", status_code=201)
def create_item(payload: ShowcasePayload, db: Session = Depends(get_db)) -> dict:
    _check_unique(db, payload.code)
    item = ShowcaseItem()
    _apply(item, payload)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _out(item)


@router.put("/{item_id}")
def update_item(item_id: int, payload: ShowcasePayload, db: Session = Depends(get_db)) -> dict:
    item = db.get(ShowcaseItem, item_id)
    if not item:
        raise HTTPException(404, "Showcase item not found")
    _check_unique(db, payload.code, current_id=item_id)
    _apply(item, payload)
    db.commit()
    db.refresh(item)
    return _out(item)


@router.post("/images")
async def upload_image(file: UploadFile = File(...)) -> dict:
    data = await file.read(8 * 1024 * 1024 + 1)
    if not data or len(data) > 8 * 1024 * 1024:
        raise HTTPException(400, "Image must be under 8 MB")
    try:
        image = Image.open(BytesIO(data))
        image.verify()
        image = Image.open(BytesIO(data))
        image = ImageOps.exif_transpose(image)
        if image.width * image.height > 40_000_000:
            raise HTTPException(400, "Image dimensions too large")
        image.thumbnail((2200, 2200))
        if image.mode != "RGB":
            background = Image.new("RGB", image.size, "white")
            if image.mode == "RGBA":
                background.paste(image, mask=image.getchannel("A"))
            else:
                background.paste(image.convert("RGB"))
            image = background
        IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"showcase-{uuid4().hex}.jpg"
        target = IMAGE_DIR / filename
        image.save(target, "JPEG", quality=88, optimize=True)
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, "Invalid image")
    return {"url": f"{IMAGE_PREFIX}{filename}"}
