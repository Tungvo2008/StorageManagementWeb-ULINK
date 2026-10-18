from __future__ import annotations

from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import Product, TowelWebContent, TowelWebMedia


router = APIRouter(prefix="/towel-web", tags=["towel-web"])
IMAGE_DIR = Path(__file__).resolve().parents[3] / "assets" / "product-images"
IMAGE_URL_PREFIX = "/api/v1/public/product-images/"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_FORMATS = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}


class ContentUpdate(BaseModel):
    is_published: bool | None = None
    title: str | None = Field(default=None, max_length=255)
    summary: str | None = Field(default=None, max_length=500)
    description: str | None = None
    seo_title: str | None = Field(default=None, max_length=255)
    seo_description: str | None = Field(default=None, max_length=500)


class MediaUpdate(BaseModel):
    alt_text: str | None = Field(default=None, max_length=255)
    sort_order: int | None = Field(default=None, ge=0)
    is_primary: bool | None = None


def _product(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if product is None or product.business_unit != "TOWEL":
        raise HTTPException(status_code=404, detail="Towel product not found")
    return product


def _media_rows(db: Session, product_id: int) -> list[TowelWebMedia]:
    return list(db.scalars(
        select(TowelWebMedia)
        .where(TowelWebMedia.product_id == product_id)
        .order_by(TowelWebMedia.sort_order, TowelWebMedia.id)
    ))


def _view(db: Session, product: Product) -> dict:
    content = db.get(TowelWebContent, product.id)
    return {
        "product_id": product.id,
        "sku": product.sku,
        "inventory_name": product.name,
        "inventory_image_url": product.image_url,
        "category_id": product.category_id,
        "content": {
            "is_published": bool(content.is_published) if content else False,
            "title": content.title if content else None,
            "summary": content.summary if content else None,
            "description": content.description if content else None,
            "seo_title": content.seo_title if content else None,
            "seo_description": content.seo_description if content else None,
        },
        "media": [
            {
                "id": media.id,
                "image_url": media.image_url,
                "alt_text": media.alt_text,
                "sort_order": media.sort_order,
                "is_primary": media.is_primary,
            }
            for media in _media_rows(db, product.id)
        ],
    }


@router.get("/products")
def list_towel_web_products(db: Session = Depends(get_db)) -> list[dict]:
    products = db.scalars(
        select(Product)
        .where(Product.business_unit == "TOWEL", Product.is_active.is_(True))
        .order_by(Product.category_id, Product.sku)
    ).all()
    return [_view(db, product) for product in products]


@router.get("/products/{product_id}")
def get_towel_web_product(product_id: int, db: Session = Depends(get_db)) -> dict:
    return _view(db, _product(db, product_id))


@router.put("/products/{product_id}/content")
def save_towel_web_content(product_id: int, payload: ContentUpdate, db: Session = Depends(get_db)) -> dict:
    product = _product(db, product_id)
    content = db.get(TowelWebContent, product_id)
    if content is None:
        content = TowelWebContent(product_id=product_id)
        db.add(content)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(content, key, value.strip() or None if isinstance(value, str) else value)
    db.commit()
    return _view(db, product)


@router.post("/products/{product_id}/media")
async def add_towel_web_media(
    product_id: int,
    file: UploadFile = File(...),
    alt_text: str = Form(default=""),
    db: Session = Depends(get_db),
) -> dict:
    product = _product(db, product_id)
    payload = await file.read(MAX_IMAGE_BYTES + 1)
    if not payload or len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image must be between 1 byte and 10 MB")
    try:
        with Image.open(BytesIO(payload)) as image:
            image_format = image.format
            has_alpha = image.mode in ("RGBA", "LA") and image.getchannel("A").getextrema()[0] < 255
            if image.mode == "P" and "transparency" in image.info:
                has_alpha = True
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid image file")
    suffix = ALLOWED_FORMATS.get(image_format or "")
    if suffix is None:
        raise HTTPException(status_code=400, detail="Use PNG, JPEG, or WebP")
    if len(alt_text) > 255:
        raise HTTPException(status_code=400, detail="Alt text is too long")

    rows = _media_rows(db, product_id)
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    image_kind = "cutout" if has_alpha else "photo"
    filename = f"towels-{product_id}-{image_kind}-{uuid4().hex}{suffix}"
    path = IMAGE_DIR / filename
    path.write_bytes(payload)
    try:
        media = TowelWebMedia(
            product_id=product_id,
            image_url=f"{IMAGE_URL_PREFIX}{filename}",
            alt_text=alt_text.strip() or None,
            sort_order=max((row.sort_order for row in rows), default=-1) + 1,
            is_primary=not rows,
        )
        db.add(media)
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    return _view(db, product)


@router.patch("/products/{product_id}/media/{media_id}")
def update_towel_web_media(
    product_id: int, media_id: int, payload: MediaUpdate, db: Session = Depends(get_db)
) -> dict:
    product = _product(db, product_id)
    media = db.get(TowelWebMedia, media_id)
    if media is None or media.product_id != product_id:
        raise HTTPException(status_code=404, detail="Towel image not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_primary") is True:
        for row in _media_rows(db, product_id):
            row.is_primary = row.id == media_id
    elif data.get("is_primary") is False and media.is_primary:
        raise HTTPException(status_code=400, detail="Choose another primary image first")
    for key in ("alt_text", "sort_order"):
        if key in data:
            value = data[key]
            setattr(media, key, value.strip() or None if isinstance(value, str) else value)
    db.commit()
    return _view(db, product)


@router.delete("/products/{product_id}/media/{media_id}")
def delete_towel_web_media(product_id: int, media_id: int, db: Session = Depends(get_db)) -> dict:
    product = _product(db, product_id)
    media = db.get(TowelWebMedia, media_id)
    if media is None or media.product_id != product_id:
        raise HTTPException(status_code=404, detail="Towel image not found")
    url = media.image_url
    was_primary = media.is_primary
    db.delete(media)
    db.flush()
    if was_primary:
        remaining = _media_rows(db, product_id)
        if remaining:
            remaining[0].is_primary = True
    db.commit()
    filename = Path(url.removeprefix(IMAGE_URL_PREFIX)).name
    if url == f"{IMAGE_URL_PREFIX}{filename}" and filename.startswith(f"towels-{product_id}-"):
        (IMAGE_DIR / filename).unlink(missing_ok=True)
    return _view(db, product)
