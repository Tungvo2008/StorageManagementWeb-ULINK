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
from app.db.models import (
    Product, ShowcaseItem, WebsiteCategory, WebsiteListing,
    WebsiteListingMedia, WebsiteListingTranslation, WebsitePageBlock,
)

router = APIRouter(prefix="/website-content", tags=["website-content"])
IMAGE_DIR = Path(__file__).resolve().parents[3] / "assets" / "product-images"
IMAGE_URL_PREFIX = "/api/v1/public/product-images/"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
SUFFIXES = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}
SITES = {"ulink", "towels"}
LOCALES = {"vi", "en"}
PAGE_BLOCKS = {
    "ulink": {"home": ("hero", "intro", "wholesale", "final")},
    "towels": {"home": ("hero", "collection", "colors", "final")},
}


def _site(site: str) -> str:
    if site not in SITES:
        raise HTTPException(404, "Unknown website")
    return site


def _locale(locale: str) -> str:
    if locale not in LOCALES:
        raise HTTPException(400, "Language must be vi or en")
    return locale


def _block(site: str, page: str, block_key: str) -> None:
    _site(site)
    if block_key not in PAGE_BLOCKS[site].get(page, ()):
        raise HTTPException(404, "Unknown page block")


def _item(db: Session, site: str, kind: str, item_id: int) -> Product | ShowcaseItem:
    if kind == "product":
        item = db.get(Product, item_id)
        if item is None or not item.is_active or (site == "towels" and item.business_unit != "TOWEL"):
            raise HTTPException(404, "Product not available for this website")
        return item
    if kind == "showcase" and site == "ulink":
        item = db.get(ShowcaseItem, item_id)
        if item is None or not item.is_active:
            raise HTTPException(404, "Showcase item not found")
        return item
    raise HTTPException(404, "Unknown item type")


def _listing(db: Session, site: str, kind: str, item_id: int, create: bool = False) -> WebsiteListing | None:
    condition = WebsiteListing.product_id == item_id if kind == "product" else WebsiteListing.showcase_id == item_id
    listing = db.scalar(select(WebsiteListing).where(WebsiteListing.site == site, condition))
    if listing is None and create:
        listing = WebsiteListing(
            site=site, product_id=item_id if kind == "product" else None,
            showcase_id=item_id if kind == "showcase" else None,
            is_published=False,
        )
        db.add(listing)
        db.flush()
    return listing


def _view(db: Session, site: str, kind: str, item: Product | ShowcaseItem, listing: WebsiteListing | None) -> dict:
    translations = {}
    media = []
    if listing:
        translations = {
            row.locale: {
                "title": row.title, "summary": row.summary, "description": row.description,
                "seo_title": row.seo_title, "seo_description": row.seo_description,
            }
            for row in db.scalars(select(WebsiteListingTranslation).where(
                WebsiteListingTranslation.listing_id == listing.id,
            ))
        }
        media = [
            {
                "id": row.id, "image_url": row.image_url, "alt_text": row.alt_text,
                "sort_order": row.sort_order, "is_primary": row.is_primary,
            }
            for row in db.scalars(select(WebsiteListingMedia).where(
                WebsiteListingMedia.listing_id == listing.id,
            ).order_by(WebsiteListingMedia.sort_order, WebsiteListingMedia.id))
        ]
    return {
        "kind": kind, "item_id": item.id,
        "sku": item.sku if kind == "product" else item.code,
        "inventory_name": item.name,
        "inventory_image_url": item.image_url,
        "listing_id": listing.id if listing else None,
        "is_published": bool(listing.is_published) if listing else False,
        "category_id": listing.category_id if listing else None,
        "sort_order": listing.sort_order if listing else 0,
        "translations": translations,
        "media": media,
    }


class CategoryPayload(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=128)
    name_vi: str | None = Field(default=None, max_length=255)
    name_en: str | None = Field(default=None, max_length=255)
    description_vi: str | None = None
    description_en: str | None = None
    sort_order: int = 0
    is_active: bool = True


class ListingPayload(BaseModel):
    locale: str = "vi"
    is_published: bool = False
    category_id: int | None = None
    sort_order: int = 0
    title: str | None = Field(default=None, max_length=255)
    summary: str | None = Field(default=None, max_length=500)
    description: str | None = None
    seo_title: str | None = Field(default=None, max_length=255)
    seo_description: str | None = Field(default=None, max_length=500)


class MediaPayload(BaseModel):
    alt_text: str | None = Field(default=None, max_length=255)
    sort_order: int | None = Field(default=None, ge=0)
    is_primary: bool | None = None


class PageBlockPayload(BaseModel):
    eyebrow: str | None = Field(default=None, max_length=255)
    title: str | None = Field(default=None, max_length=500)
    body: str | None = None
    image_alt: str | None = Field(default=None, max_length=255)
    cta_label: str | None = Field(default=None, max_length=255)
    is_published: bool = False


def _page_block_view(row: WebsitePageBlock) -> dict:
    return {
        "site": row.site, "page": row.page, "block_key": row.block_key,
        "locale": row.locale, "eyebrow": row.eyebrow, "title": row.title,
        "body": row.body, "image_url": row.image_url, "image_alt": row.image_alt,
        "cta_label": row.cta_label, "is_published": row.is_published,
    }


@router.get("/{site}/pages/{page}")
def page_blocks(site: str, page: str, db: Session = Depends(get_db)) -> list[dict]:
    _site(site)
    if page not in PAGE_BLOCKS[site]:
        raise HTTPException(404, "Unknown page")
    rows = db.scalars(select(WebsitePageBlock).where(
        WebsitePageBlock.site == site, WebsitePageBlock.page == page,
    )).all()
    return [_page_block_view(row) for row in rows]


@router.put("/{site}/pages/{page}/{block_key}/{locale}")
def save_page_block(
    site: str, page: str, block_key: str, locale: str,
    payload: PageBlockPayload, db: Session = Depends(get_db),
) -> dict:
    _block(site, page, block_key)
    _locale(locale)
    row = db.scalar(select(WebsitePageBlock).where(
        WebsitePageBlock.site == site, WebsitePageBlock.page == page,
        WebsitePageBlock.block_key == block_key, WebsitePageBlock.locale == locale,
    ))
    if row is None:
        row = WebsitePageBlock(site=site, page=page, block_key=block_key, locale=locale)
        db.add(row)
    if payload.is_published and not (payload.title or "").strip():
        raise HTTPException(400, "Published blocks need a title")
    for key, value in payload.model_dump().items():
        setattr(row, key, value.strip() or None if isinstance(value, str) else value)
    db.commit()
    return _page_block_view(row)


@router.post("/{site}/pages/{page}/{block_key}/{locale}/image")
async def upload_page_image(
    site: str, page: str, block_key: str, locale: str,
    file: UploadFile = File(...), db: Session = Depends(get_db),
) -> dict:
    _block(site, page, block_key)
    _locale(locale)
    payload = await file.read(MAX_IMAGE_BYTES + 1)
    if not payload or len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "Image must be between 1 byte and 10 MB")
    try:
        with Image.open(BytesIO(payload)) as image:
            image_format = image.format
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, "Invalid image")
    suffix = SUFFIXES.get(image_format or "")
    if suffix is None:
        raise HTTPException(400, "Use PNG, JPEG, or WebP")
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"webpage-{site}-{page}-{block_key}-{locale}-{uuid4().hex}{suffix}"
    path = IMAGE_DIR / filename
    path.write_bytes(payload)
    row = db.scalar(select(WebsitePageBlock).where(
        WebsitePageBlock.site == site, WebsitePageBlock.page == page,
        WebsitePageBlock.block_key == block_key, WebsitePageBlock.locale == locale,
    ))
    if row is None:
        row = WebsitePageBlock(site=site, page=page, block_key=block_key, locale=locale)
        db.add(row)
    row.image_url = f"{IMAGE_URL_PREFIX}{filename}"
    try:
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    return _page_block_view(row)


@router.get("/{site}/categories")
def categories(site: str, db: Session = Depends(get_db)) -> list[dict]:
    _site(site)
    rows = db.scalars(select(WebsiteCategory).where(
        WebsiteCategory.site == site,
    ).order_by(WebsiteCategory.sort_order, WebsiteCategory.id)).all()
    return [
        {
            "id": row.id, "site": row.site, "slug": row.slug,
            "name_vi": row.name_vi, "name_en": row.name_en,
            "description_vi": row.description_vi, "description_en": row.description_en,
            "sort_order": row.sort_order, "is_active": row.is_active,
        }
        for row in rows
    ]


@router.post("/{site}/categories")
def create_category(site: str, payload: CategoryPayload, db: Session = Depends(get_db)) -> dict:
    _site(site)
    if db.scalar(select(WebsiteCategory).where(
        WebsiteCategory.site == site, WebsiteCategory.slug == payload.slug,
    )):
        raise HTTPException(409, "Category slug already exists")
    row = WebsiteCategory(site=site, **payload.model_dump())
    db.add(row)
    db.commit()
    return {"id": row.id}


@router.put("/{site}/categories/{category_id}")
def update_category(site: str, category_id: int, payload: CategoryPayload, db: Session = Depends(get_db)) -> dict:
    _site(site)
    row = db.get(WebsiteCategory, category_id)
    if row is None or row.site != site:
        raise HTTPException(404, "Category not found")
    if payload.slug != row.slug:
        raise HTTPException(400, "Slug cannot change after creation; existing links must remain stable")
    for key, value in payload.model_dump().items():
        setattr(row, key, value.strip() or None if isinstance(value, str) and key != "slug" else value)
    db.commit()
    return {"id": row.id}


@router.get("/{site}/items")
def items(site: str, db: Session = Depends(get_db)) -> list[dict]:
    _site(site)
    products = db.scalars(select(Product).where(
        Product.is_active.is_(True),
        *([Product.business_unit == "TOWEL"] if site == "towels" else []),
    ).order_by(Product.sku)).all()
    result = []
    for item in products:
        result.append(_view(db, site, "product", item, _listing(db, site, "product", item.id)))
    if site == "ulink":
        for item in db.scalars(select(ShowcaseItem).where(
            ShowcaseItem.is_active.is_(True),
        ).order_by(ShowcaseItem.code)):
            result.append(_view(db, site, "showcase", item, _listing(db, site, "showcase", item.id)))
    return result


@router.get("/{site}/items/{kind}/{item_id}")
def get_item(site: str, kind: str, item_id: int, db: Session = Depends(get_db)) -> dict:
    _site(site)
    item = _item(db, site, kind, item_id)
    return _view(db, site, kind, item, _listing(db, site, kind, item_id))


@router.put("/{site}/items/{kind}/{item_id}")
def save_item(site: str, kind: str, item_id: int, payload: ListingPayload, db: Session = Depends(get_db)) -> dict:
    _site(site)
    _locale(payload.locale)
    item = _item(db, site, kind, item_id)
    if payload.category_id is not None:
        category = db.get(WebsiteCategory, payload.category_id)
        if category is None or category.site != site:
            raise HTTPException(400, "Category belongs to another website")
    listing = _listing(db, site, kind, item_id, create=True)
    assert listing is not None
    required_locale = "en" if site == "towels" else "vi"
    required_title = payload.title if payload.locale == required_locale else None
    if required_title is None:
        existing = db.scalar(select(WebsiteListingTranslation).where(
            WebsiteListingTranslation.listing_id == listing.id,
            WebsiteListingTranslation.locale == required_locale,
        ))
        required_title = existing.title if existing else None
    if payload.is_published and (not required_title or not required_title.strip() or payload.category_id is None):
        raise HTTPException(400, "Publishing requires a title in the main language and a public category")
    listing.is_published = payload.is_published
    listing.category_id = payload.category_id
    listing.sort_order = payload.sort_order
    translation = db.scalar(select(WebsiteListingTranslation).where(
        WebsiteListingTranslation.listing_id == listing.id,
        WebsiteListingTranslation.locale == payload.locale,
    ))
    if translation is None:
        translation = WebsiteListingTranslation(listing_id=listing.id, locale=payload.locale)
        db.add(translation)
    for key in ("title", "summary", "description", "seo_title", "seo_description"):
        value = getattr(payload, key)
        setattr(translation, key, value.strip() or None if isinstance(value, str) else value)
    db.commit()
    return _view(db, site, kind, item, listing)


def _media(db: Session, listing: WebsiteListing | None, media_id: int) -> WebsiteListingMedia:
    row = db.get(WebsiteListingMedia, media_id)
    if listing is None or row is None or row.listing_id != listing.id:
        raise HTTPException(404, "Website image not found")
    return row


@router.post("/{site}/items/{kind}/{item_id}/media")
async def upload_media(
    site: str, kind: str, item_id: int, file: UploadFile = File(...),
    alt_text: str = Form(default=""), db: Session = Depends(get_db),
) -> dict:
    _site(site)
    item = _item(db, site, kind, item_id)
    payload = await file.read(MAX_IMAGE_BYTES + 1)
    if not payload or len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "Image must be between 1 byte and 10 MB")
    try:
        with Image.open(BytesIO(payload)) as image:
            image_format = image.format
            has_alpha = image.mode in ("RGBA", "LA") and image.getchannel("A").getextrema()[0] < 255
            if image.mode == "P" and "transparency" in image.info:
                has_alpha = True
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, "Invalid image")
    suffix = SUFFIXES.get(image_format or "")
    if suffix is None:
        raise HTTPException(400, "Use PNG, JPEG, or WebP")
    if len(alt_text) > 255:
        raise HTTPException(400, "Alt text too long")
    listing = _listing(db, site, kind, item_id, create=True)
    assert listing is not None
    current = db.scalars(select(WebsiteListingMedia).where(
        WebsiteListingMedia.listing_id == listing.id,
    )).all()
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{site}-{listing.id}-{'cutout' if has_alpha else 'photo'}-{uuid4().hex}{suffix}"
    path = IMAGE_DIR / name
    path.write_bytes(payload)
    try:
        db.add(WebsiteListingMedia(
            listing_id=listing.id, image_url=f"{IMAGE_URL_PREFIX}{name}",
            alt_text=alt_text.strip() or None,
            sort_order=max((row.sort_order for row in current), default=-1) + 1,
            is_primary=not current,
        ))
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    return _view(db, site, kind, item, listing)


@router.patch("/{site}/items/{kind}/{item_id}/media/{media_id}")
def update_media(
    site: str, kind: str, item_id: int, media_id: int,
    payload: MediaPayload, db: Session = Depends(get_db),
) -> dict:
    _site(site)
    item = _item(db, site, kind, item_id)
    listing = _listing(db, site, kind, item_id)
    row = _media(db, listing, media_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_primary") is True:
        for current in db.scalars(select(WebsiteListingMedia).where(
            WebsiteListingMedia.listing_id == listing.id,
        )):
            current.is_primary = current.id == media_id
    elif data.get("is_primary") is False and row.is_primary:
        raise HTTPException(400, "Choose another primary image first")
    for key in ("alt_text", "sort_order"):
        if key in data:
            value = data[key]
            setattr(row, key, value.strip() or None if isinstance(value, str) else value)
    db.commit()
    return _view(db, site, kind, item, listing)


@router.delete("/{site}/items/{kind}/{item_id}/media/{media_id}")
def delete_media(site: str, kind: str, item_id: int, media_id: int, db: Session = Depends(get_db)) -> dict:
    _site(site)
    item = _item(db, site, kind, item_id)
    listing = _listing(db, site, kind, item_id)
    row = _media(db, listing, media_id)
    url = row.image_url
    was_primary = row.is_primary
    db.delete(row)
    db.flush()
    remaining = db.scalars(select(WebsiteListingMedia).where(
        WebsiteListingMedia.listing_id == listing.id,
    ).order_by(WebsiteListingMedia.sort_order, WebsiteListingMedia.id)).all()
    if was_primary and remaining:
        remaining[0].is_primary = True
    db.commit()
    # Imported inventory/towel images can still be used elsewhere. Only remove files uploaded here.
    if url.startswith(f"{IMAGE_URL_PREFIX}{site}-{listing.id}-"):
        (IMAGE_DIR / url.rsplit("/", 1)[-1]).unlink(missing_ok=True)
    return _view(db, site, kind, item, listing)
