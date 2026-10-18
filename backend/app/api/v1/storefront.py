from __future__ import annotations

from app.services.shipping_service import AddressInput, ParcelInput, ShippingRateResponse, get_shippo_shipping_rates

import json
import re
import unicodedata
from dataclasses import replace
from decimal import Decimal
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db, verify_storefront_access
from app.db.models import Category, Product, ProductImage, ShowcaseItem, TowelWebContent, TowelWebMedia, WebsiteCategory, WebsiteListing, WebsiteListingMedia, WebsiteListingTranslation, WebsitePageBlock
from app.schemas.storefront import (
    StorefrontCategory,
    StorefrontPriceTier,
    StorefrontProduct,
    StorefrontProductImage,
    StorefrontProductList,
    StorefrontProductVariant,
)
from app.services.catalog_render import (
    CatalogCategory,
    CatalogProduct,
    CatalogRenderOptions,
    build_catalog_categories,
    get_catalog_company,
    normalize_catalog_product,
    render_catalog_pdf,
)

router = APIRouter(prefix="/public/store", tags=["storefront"], dependencies=[Depends(verify_storefront_access)])

DEFAULT_IMAGE_BASE_URL = "https://storage.thanhtungvo.id.vn"


def slugify(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "-", text)


def _format_image_url(url: str | None, base_url: str = DEFAULT_IMAGE_BASE_URL) -> str | None:
    if not url:
        return None
    url = url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        if not url.startswith("/"):
            url = f"/{url}"
        url = f"{base_url}{url}"
    return url


def _parse_json_field(val: Any, default: Any) -> Any:
    if not val:
        return default
    if isinstance(val, (list, dict)):
        return val
    try:
        return json.loads(val)
    except Exception:
        return default


def _to_storefront_product(
    p: Product,
    base_url: str = DEFAULT_IMAGE_BASE_URL,
    sibling_variants: list[StorefrontProductVariant] | None = None,
) -> StorefrontProduct:
    primary_img = _format_image_url(p.image_url, base_url)

    images: list[StorefrontProductImage] = []
    if hasattr(p, "images") and p.images:
        for img_obj in p.images:
            images.append(
                StorefrontProductImage(
                    id=img_obj.id,
                    image_url=_format_image_url(img_obj.image_url, base_url) or "",
                    alt_text=img_obj.alt_text or p.name,
                    sort_order=img_obj.sort_order,
                    is_primary=bool(img_obj.is_primary),
                )
            )
    elif primary_img:
        images.append(
            StorefrontProductImage(
                id=0,
                image_url=primary_img,
                alt_text=p.name,
                sort_order=0,
                is_primary=True,
            )
        )

    badges = []
    if p.catalog_badges:
        badges = [b.strip() for b in p.catalog_badges.split(",") if b.strip()]

    cat_name = p.category.name if p.category else None
    cat_slug = slugify(cat_name) if cat_name else None

    # Mặc định ẩn giá toàn hệ thống theo yêu cầu của chủ shop
    # Trả về show_price=False và unit_price=None để khách bắt buộc liên hệ nhận báo giá
    show_price = False
    unit_price = None

    highlights_raw = _parse_json_field(getattr(p, "highlights", None), [])
    highlights = [str(h) for h in highlights_raw] if isinstance(highlights_raw, list) else []

    specs_raw = _parse_json_field(getattr(p, "specifications", None), {})
    specifications = specs_raw if isinstance(specs_raw, dict) else {}
    public_logistics = not specifications.get("_logistics_estimate", False)
    specifications = {k: v for k, v in specifications.items() if not k.startswith("_")}

    metafields_raw = _parse_json_field(getattr(p, "metafields", None), {})
    metafields = metafields_raw if isinstance(metafields_raw, dict) else {}

    related_raw = _parse_json_field(getattr(p, "related_product_skus", None), [])
    related_skus = [str(s) for s in related_raw] if isinstance(related_raw, list) else []

    price_label = getattr(p, "price_label", None) or "Contact for Wholesale Pricing"

    return StorefrontProduct(
        id=p.id,
        sku=p.sku,
        name=p.name,
        catalog_short_name=p.catalog_short_name,
        description=p.description,
        brand=p.brand,
        unit_price=unit_price,
        currency=p.currency or "USD",
        unit_size=p.unit_size,
        case_pack=p.catalog_case_pack if public_logistics else None,
        hs_code=p.hs_code,
        carton_net_weight_kg=float(p.carton_net_weight_kg) if public_logistics and p.carton_net_weight_kg is not None else None,
        carton_gross_weight_kg=float(p.carton_gross_weight_kg) if public_logistics and p.carton_gross_weight_kg is not None else None,
        carton_length_cm=float(p.carton_length_cm) if public_logistics and p.carton_length_cm is not None else None,
        carton_width_cm=float(p.carton_width_cm) if public_logistics and p.carton_width_cm is not None else None,
        carton_height_cm=float(p.carton_height_cm) if public_logistics and p.carton_height_cm is not None else None,
        carton_cbm=round(float(p.carton_length_cm * p.carton_width_cm * p.carton_height_cm) / 1_000_000, 6)
        if public_logistics and all(v is not None for v in (p.carton_length_cm, p.carton_width_cm, p.carton_height_cm)) else None,
        cartons_per_20ft=p.cartons_per_20ft if public_logistics else None,
        cartons_per_40ft=p.cartons_per_40ft if public_logistics else None,
        category_id=p.category_id,
        category_name=cat_name,
        category_slug=cat_slug,
        image_url=primary_img,
        is_in_stock=bool(p.quantity_on_hand and p.quantity_on_hand > 0),
        upc=p.upc,
        country_of_origin=p.country_of_origin,
        badges=badges,
        business_unit=p.business_unit or "TOWEL",
        is_sold_on_amazon=bool(p.is_sold_on_amazon),
        amazon_sku=p.amazon_sku,
        images=images,
        highlights=highlights,
        specifications=specifications,
        show_price=show_price,
        price_label=price_label,
        min_order_quantity=getattr(p, "min_order_quantity", 1) or 1,
        lead_time=getattr(p, "lead_time", None) or "Same Day / Next Day Shipping (Dallas, TX)",
        variant_group_id=getattr(p, "variant_group_id", None),
        color_name=getattr(p, "color_name", None),
        color_hex=getattr(p, "color_hex", None),
        price_tiers=[],
        metafields=metafields,
        related_product_skus=related_skus,
        variants=sibling_variants or [],
    )


def _to_towel_storefront_product(
    product: Product,
    content: TowelWebContent | None,
    media: list[TowelWebMedia],
) -> StorefrontProduct:
    """Overlay web presentation while keeping SKU, price and stock from inventory."""
    result = _to_storefront_product(product)
    if not result.color_name:
        for color in ("Light Gray", "Light Blue", "Turquoise", "Orange", "Yellow", "Black", "Brown", "Green", "Navy", "Pink", "Teal", "Gray", "White"):
            if re.search(rf"\b{re.escape(color)}\b", product.name, re.IGNORECASE):
                result.color_name = color
                break
    if content:
        result.name = content.title or result.name
        result.short_description = content.summary
        result.description = content.description
        result.seo_title = content.seo_title
        result.seo_description = content.seo_description
    if media:
        ordered = sorted(media, key=lambda item: (item.sort_order, item.id))
        primary = next((item for item in ordered if item.is_primary), ordered[0])
        result.image_url = _format_image_url(primary.image_url)
        result.images = [
            StorefrontProductImage(
                id=item.id,
                image_url=_format_image_url(item.image_url) or "",
                alt_text=item.alt_text or result.name,
                sort_order=item.sort_order,
                is_primary=item.id == primary.id,
            )
            for item in ordered
        ]
    else:
        result.image_url = None
        result.images = []
    return result


def _showcase_to_storefront(s: ShowcaseItem, base_url: str = DEFAULT_IMAGE_BASE_URL) -> StorefrontProduct:
    primary_img = _format_image_url(s.image_url, base_url)
    
    images_raw = _parse_json_field(s.images, [])
    images: list[StorefrontProductImage] = []
    if isinstance(images_raw, list) and images_raw:
        for idx, img in enumerate(images_raw):
            url = img if isinstance(img, str) else img.get("image_url", "")
            alt = s.name if isinstance(img, str) else img.get("alt_text", s.name)
            images.append(
                StorefrontProductImage(
                    id=idx + 1,
                    image_url=_format_image_url(url, base_url) or "",
                    alt_text=alt,
                    sort_order=idx,
                    is_primary=(idx == 0),
                )
            )
    elif primary_img:
        images.append(
            StorefrontProductImage(
                id=1,
                image_url=primary_img,
                alt_text=s.name,
                sort_order=0,
                is_primary=True,
            )
        )

    highlights_raw = _parse_json_field(s.highlights, [])
    highlights = [str(h) for h in highlights_raw] if isinstance(highlights_raw, list) else []

    specs_raw = _parse_json_field(s.specifications, {})
    specifications = specs_raw if isinstance(specs_raw, dict) else {}

    badges_raw = _parse_json_field(s.badges, ["CUSTOM IMPORT"])
    badges = [str(b) for b in badges_raw] if isinstance(badges_raw, list) else ["CUSTOM IMPORT"]

    return StorefrontProduct(
        id=s.id + 100000,  # Offset ID để không trùng sản phẩm kho
        sku=s.code,
        name=s.name,
        catalog_short_name=None,
        description=s.description,
        brand=s.brand or None,
        unit_price=None,
        currency="USD",
        unit_size=specifications.get("unit_size") or None,
        case_pack=specifications.get("case_pack") or None,
        category_id=None,
        category_name=s.category,
        category_slug=s.category_slug,
        image_url=primary_img,
        is_in_stock=False,
        upc=None,
        country_of_origin=None,
        badges=badges,
        business_unit="SHOWCASE",
        is_sold_on_amazon=False,
        amazon_sku=None,
        images=images,
        highlights=highlights,
        specifications=specifications,
        show_price=False,
        price_label="Contact for Wholesale Pricing",
        min_order_quantity=s.min_order_quantity or 1,
        lead_time=s.lead_time or None,
        variant_group_id=None,
        color_name=None,
        color_hex=None,
        price_tiers=[],
        metafields={},
        related_product_skus=[],
        variants=[],
    )


def _published_listing_rows(db: Session, site: str) -> list[WebsiteListing]:
    rows = db.scalars(select(WebsiteListing).where(
        WebsiteListing.site == site, WebsiteListing.is_published.is_(True),
    ).order_by(WebsiteListing.sort_order, WebsiteListing.id)).all()
    result = []
    for listing in rows:
        if listing.product_id is not None:
            product = db.get(Product, listing.product_id)
            if product is None or not product.is_active:
                continue
            if site == "towels" and product.business_unit != "TOWEL":
                continue
        else:
            showcase = db.get(ShowcaseItem, listing.showcase_id)
            if site != "ulink" or showcase is None or not showcase.is_active:
                continue
        result.append(listing)
    return result


def _website_translation(db: Session, listing_id: int, locale: str, site: str) -> WebsiteListingTranslation | None:
    translations = list(db.scalars(select(WebsiteListingTranslation).where(
        WebsiteListingTranslation.listing_id == listing_id,
    )))
    fallback_locale = "en" if site == "towels" else "vi"
    return next((row for row in translations if row.locale == locale and row.title), None) or next(
        (row for row in translations if row.locale == fallback_locale and row.title), None
    )


def _website_media(db: Session, listing_id: int) -> list[WebsiteListingMedia]:
    return list(db.scalars(select(WebsiteListingMedia).where(
        WebsiteListingMedia.listing_id == listing_id,
    ).order_by(WebsiteListingMedia.sort_order, WebsiteListingMedia.id)))


def _render_website_listing(db: Session, listing: WebsiteListing, locale: str) -> StorefrontProduct:
    if listing.product_id is not None:
        product = db.get(Product, listing.product_id)
        result = _to_storefront_product(product)
        if listing.site == "towels" and not result.color_name:
            for color in ("Light Gray", "Light Blue", "Turquoise", "Orange", "Yellow", "Black", "Brown", "Green", "Navy", "Pink", "Teal", "Gray", "White"):
                if re.search(rf"\b{re.escape(color)}\b", product.name, re.IGNORECASE):
                    result.color_name = color
                    break
    else:
        result = _showcase_to_storefront(db.get(ShowcaseItem, listing.showcase_id))
    content = _website_translation(db, listing.id, locale, listing.site)
    if content is not None:
        result.name = content.title or result.name
        result.catalog_short_name = content.title
        result.short_description = content.summary
        result.description = content.description
        result.seo_title = content.seo_title
        result.seo_description = content.seo_description
    category = db.get(WebsiteCategory, listing.category_id) if listing.category_id else None
    if category is not None:
        result.category_id = category.id
        result.category_slug = category.slug
        result.category_name = (
            category.name_en or category.name_vi if locale == "en"
            else category.name_vi or category.name_en
        )
    media = _website_media(db, listing.id)
    if media:
        primary = next((row for row in media if row.is_primary), media[0])
        result.image_url = _format_image_url(primary.image_url)
        result.images = [
            StorefrontProductImage(
                id=row.id,
                image_url=_format_image_url(row.image_url) or "",
                alt_text=row.alt_text or result.name,
                sort_order=row.sort_order,
                is_primary=row.id == primary.id,
            )
            for row in media
        ]
    else:
        result.image_url = None
        result.images = []
    return result


def _website_categories(db: Session, site: str, locale: str) -> list[StorefrontCategory]:
    counts: dict[int, int] = {}
    for listing in _published_listing_rows(db, site):
        if listing.category_id:
            counts[listing.category_id] = counts.get(listing.category_id, 0) + 1
    categories = db.scalars(select(WebsiteCategory).where(
        WebsiteCategory.site == site, WebsiteCategory.is_active.is_(True),
    ).order_by(WebsiteCategory.sort_order, WebsiteCategory.id)).all()
    return [
        StorefrontCategory(
            id=category.id,
            name=(category.name_en or category.name_vi) if locale == "en" else (category.name_vi or category.name_en),
            slug=category.slug,
            description=(category.description_en or category.description_vi) if locale == "en" else (category.description_vi or category.description_en),
            sort_order=category.sort_order,
            product_count=counts.get(category.id, 0),
        )
        for category in categories
    ]


def _website_products(
    db: Session, site: str, locale: str, category_slug: str | None,
    category_id: int | None, search: str | None, brand: str | None,
    business_unit: str | None, variant_group_id: str | None, in_stock: bool | None,
    sort_by: str, page: int, limit: int,
) -> StorefrontProductList:
    rows = _published_listing_rows(db, site)
    if category_slug or category_id is not None:
        categories = db.scalars(select(WebsiteCategory).where(WebsiteCategory.site == site)).all()
        ids = {c.id for c in categories if (category_slug and c.slug == category_slug) or (category_id is not None and c.id == category_id)}
        rows = [row for row in rows if row.category_id in ids]
    items = []
    for row in rows:
        item = _render_website_listing(db, row, locale)
        if business_unit and item.business_unit != business_unit.strip().upper():
            continue
        if variant_group_id and item.variant_group_id != variant_group_id:
            continue
        if brand and (item.brand or "").lower() != brand.strip().lower():
            continue
        if in_stock and not item.is_in_stock:
            continue
        if search:
            needle = search.strip().casefold()
            haystack = " ".join(filter(None, (
                item.name, item.description, item.brand, item.sku, item.upc,
                item.category_name,
            ))).casefold()
            if needle not in haystack:
                continue
        items.append(item)
    if sort_by == "name_asc":
        items.sort(key=lambda item: item.name.casefold())
    elif sort_by == "price_asc":
        items.sort(key=lambda item: (item.unit_price is None, item.unit_price or 0))
    elif sort_by == "price_desc":
        items.sort(key=lambda item: -(item.unit_price or 0))
    elif sort_by == "newest":
        items.reverse()
    total = len(items)
    return StorefrontProductList(
        items=items[(page - 1) * limit:page * limit],
        total=total, page=page, limit=limit,
        total_pages=(total + limit - 1) // limit,
    )


def _website_detail(db: Session, site: str, locale: str, identifier: str) -> StorefrontProduct:
    clean = identifier.strip().lower()
    for listing in _published_listing_rows(db, site):
        product = db.get(Product, listing.product_id) if listing.product_id is not None else None
        showcase = db.get(ShowcaseItem, listing.showcase_id) if listing.showcase_id is not None else None
        keys = (
            (product.sku.lower(), str(product.id)) if product
            else (showcase.code.lower(), str(showcase.id + 100000))
        )
        if clean not in keys:
            continue
        result = _render_website_listing(db, listing, locale)
        if product and product.variant_group_id:
            siblings = db.scalars(select(Product).where(
                Product.variant_group_id == product.variant_group_id,
                Product.is_active.is_(True),
            ).order_by(Product.catalog_sort_order, Product.id)).all()
            variants = []
            for sibling in siblings:
                sibling_listing = db.scalar(select(WebsiteListing).where(
                    WebsiteListing.site == site,
                    WebsiteListing.product_id == sibling.id,
                    WebsiteListing.is_published.is_(True),
                ))
                if sibling_listing is None:
                    continue
                view = _render_website_listing(db, sibling_listing, locale)
                variants.append(StorefrontProductVariant(
                    id=sibling.id, sku=sibling.sku, name=view.name,
                    color_name=view.color_name, color_hex=view.color_hex,
                    image_url=view.image_url, unit_price=view.unit_price,
                    is_in_stock=view.is_in_stock,
                ))
            result.variants = variants
        return result
    raise HTTPException(404, "Product is not published on this website")


@router.get("/pages/{page}")
def get_website_page_blocks(
    page: str,
    site: Literal["ulink", "towels"] = Query(...),
    lang: Literal["vi", "en"] = Query(default="vi"),
    db: Session = Depends(get_db),
) -> dict[str, dict]:
    if page != "home":
        raise HTTPException(404, "Page not found")
    rows = db.scalars(select(WebsitePageBlock).where(
        WebsitePageBlock.site == site,
        WebsitePageBlock.page == page,
        WebsitePageBlock.is_published.is_(True),
    )).all()
    by_key: dict[str, WebsitePageBlock] = {}
    for row in rows:
        if row.locale == lang:
            by_key[row.block_key] = row
    fallback_locale = "en" if site == "towels" else "vi"
    for row in rows:
        if row.locale == fallback_locale and row.block_key not in by_key:
            by_key[row.block_key] = row
    return {
        key: {
            "eyebrow": row.eyebrow, "title": row.title, "body": row.body,
            "image_url": _format_image_url(row.image_url),
            "image_alt": row.image_alt, "cta_label": row.cta_label,
        }
        for key, row in by_key.items()
    }


@router.get("/categories", response_model=list[StorefrontCategory])
def list_store_categories(
    site: Literal["ulink", "towels"] | None = Query(default=None),
    lang: Literal["vi", "en"] = Query(default="vi"),
    db: Session = Depends(get_db),
) -> list[StorefrontCategory]:
    """Danh mục sản phẩm công khai theo website."""
    if site is not None:
        return _website_categories(db, site, lang)
    # 1. Categories từ kho
    categories = db.scalars(
        select(Category).order_by(Category.catalog_sort_order.asc(), Category.id.asc())
    ).all()

    counts = dict(
        db.execute(
            select(Product.category_id, func.count(Product.id))
            .where(Product.catalog_enabled.is_(True), Product.is_active.is_(True))
            .group_by(Product.category_id)
        ).all()
    )

    result = []
    cat_idx = 1
    for cat in categories:
        count = counts.get(cat.id, 0)
        result.append(
            StorefrontCategory(
                id=cat.id,
                name=cat.name,
                slug=slugify(cat.name),
                description=cat.description,
                sort_order=cat.catalog_sort_order or 0,
                product_count=count,
            )
        )
        cat_idx += 1

    # 2. Categories từ bảng Showcase
    showcase_cats = db.execute(
        select(ShowcaseItem.category, ShowcaseItem.category_slug, func.count(ShowcaseItem.id))
        .where(ShowcaseItem.is_active.is_(True))
        .group_by(ShowcaseItem.category, ShowcaseItem.category_slug)
        .order_by(ShowcaseItem.category.asc())
    ).all()

    for sc_name, sc_slug, sc_count in showcase_cats:
        result.append(
            StorefrontCategory(
                id=1000 + cat_idx,
                name=sc_name,
                slug=sc_slug,
                description=f"Hàng nhập khẩu theo đơn & Bán buôn {sc_name}",
                sort_order=50 + cat_idx,
                product_count=sc_count,
            )
        )
        cat_idx += 1

    return result


@router.get("/filters")
def storefront_filters(
    site: Literal["ulink", "towels"] = Query(...),
    category_slug: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    """Public brand facet for the currently selected website category."""
    category_id = None
    if category_slug:
        category = db.scalar(select(WebsiteCategory).where(
            WebsiteCategory.site == site,
            WebsiteCategory.slug == category_slug,
            WebsiteCategory.is_active.is_(True),
        ))
        if category is None:
            return {"brands": []}
        category_id = category.id
    brands: dict[str, dict] = {}
    for listing in _published_listing_rows(db, site):
        if category_id is not None and listing.category_id != category_id:
            continue
        item = db.get(Product, listing.product_id) if listing.product_id is not None else db.get(ShowcaseItem, listing.showcase_id)
        brand = (item.brand or "").strip() if item is not None else ""
        if not brand:
            continue
        key = brand.casefold()
        if key not in brands:
            brands[key] = {"name": brand, "count": 0}
        brands[key]["count"] += 1
    return {"brands": sorted(brands.values(), key=lambda row: row["name"].casefold())}


@router.get("/products", response_model=StorefrontProductList)
def list_store_products(
    category_id: Optional[int] = Query(default=None, description="Lọc theo ID danh mục kho"),
    category_slug: Optional[str] = Query(default=None, description="Lọc theo slug danh mục"),
    search: Optional[str] = Query(default=None, description="Tìm kiếm theo Tên, SKU, Mô tả, Brand, UPC"),
    brand: Optional[str] = Query(default=None, description="Lọc theo thương hiệu"),
    business_unit: Optional[str] = Query(default=None, description="Lọc theo ngành hàng (TOWEL, GROCERY, SUPPLY, SHOWCASE)"),
    site: Literal["ulink", "towels"] | None = Query(default=None, description="Website nhận nội dung công khai"),
    lang: Literal["vi", "en"] = Query(default="vi"),
    variant_group_id: Optional[str] = Query(default=None, description="Lọc theo nhóm biến thể"),
    in_stock: Optional[bool] = Query(default=None, description="Chỉ lấy sản phẩm còn hàng"),
    sort_by: str = Query(
        default="sort_order",
        description="Sắp xếp: sort_order, name_asc, newest",
    ),
    page: int = Query(default=1, ge=1, description="Số trang (bắt đầu từ 1)"),
    limit: int = Query(default=50, ge=1, le=100, description="Số sản phẩm mỗi trang (tối đa 100)"),
    db: Session = Depends(get_db),
) -> StorefrontProductList:
    """Danh sách sản phẩm công khai cho website ulink-llc.com & thetowelshaven.com hợp nhất."""
    if site is not None:
        return _website_products(db, site, lang, category_slug, category_id, search, brand, business_unit, variant_group_id, in_stock, sort_by, page, limit)
    all_items: list[StorefrontProduct] = []

    # 1. Query từ kho products
    if business_unit != "SHOWCASE":
        query = (
            select(Product)
            .options(selectinload(Product.category), selectinload(Product.images))
            .where(Product.is_active.is_(True))
        )
        if site != "towels":
            query = query.where(Product.catalog_enabled.is_(True))

        if category_id is not None:
            query = query.where(Product.category_id == category_id)
        elif category_slug:
            cats = db.scalars(select(Category)).all()
            matching_cat_ids = [c.id for c in cats if slugify(c.name) == category_slug.strip().lower()]
            if matching_cat_ids:
                query = query.where(Product.category_id.in_(matching_cat_ids))
            else:
                # Nếu không khớp category kho, có thể là category của showcase -> không lấy kho
                query = query.where(Product.id == -1)

        if brand:
            query = query.where(func.lower(Product.brand) == brand.strip().lower())

        if business_unit:
            query = query.where(Product.business_unit == business_unit.strip().upper())
        if site == "towels":
            query = query.where(Product.business_unit == "TOWEL")

        if variant_group_id:
            query = query.where(Product.variant_group_id == variant_group_id.strip())

        if search:
            s = f"%{search.strip().lower()}%"
            query = query.where(
                or_(
                    func.lower(Product.sku).like(s),
                    func.lower(Product.name).like(s),
                    func.lower(Product.description).like(s),
                    func.lower(Product.brand).like(s),
                    func.lower(Product.upc).like(s),
                )
            )

        products = db.scalars(query.order_by(Product.catalog_sort_order.asc(), Product.sku.asc())).all()
        towel_content: dict[int, TowelWebContent] = {}
        towel_media: dict[int, list[TowelWebMedia]] = {}
        if site == "towels" and products:
            product_ids = [p.id for p in products if p.business_unit == "TOWEL"]
            if product_ids:
                towel_content = {
                    item.product_id: item
                    for item in db.scalars(select(TowelWebContent).where(TowelWebContent.product_id.in_(product_ids)))
                }
                for item in db.scalars(select(TowelWebMedia).where(TowelWebMedia.product_id.in_(product_ids))):
                    towel_media.setdefault(item.product_id, []).append(item)
        for p in products:
            if site == "towels" and (p.id not in towel_content or not towel_content[p.id].is_published):
                continue
            all_items.append(
                _to_towel_storefront_product(p, towel_content.get(p.id), towel_media.get(p.id, []))
                if site == "towels" and p.business_unit == "TOWEL"
                else _to_storefront_product(p)
            )

    # 2. Query từ bảng showcase_items (Chỉ khi không bị filter loại trừ)
    if site != "towels" and not variant_group_id and business_unit in (None, "", "SHOWCASE"):
        sc_query = select(ShowcaseItem).where(ShowcaseItem.is_active.is_(True))

        if category_slug:
            sc_query = sc_query.where(ShowcaseItem.category_slug == category_slug.strip().lower())

        if search:
            s = f"%{search.strip().lower()}%"
            sc_query = sc_query.where(
                or_(
                    func.lower(ShowcaseItem.code).like(s),
                    func.lower(ShowcaseItem.name).like(s),
                    func.lower(ShowcaseItem.description).like(s),
                    func.lower(ShowcaseItem.category).like(s),
                )
            )

        showcases = db.scalars(sc_query.order_by(ShowcaseItem.sort_order.asc())).all()
        for s in showcases:
            all_items.append(_showcase_to_storefront(s))

    total = len(all_items)
    total_pages = (total + limit - 1) // limit if limit > 0 else 1

    offset = (page - 1) * limit
    paged_items = all_items[offset : offset + limit]

    return StorefrontProductList(
        items=paged_items,
        total=total,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


@router.get("/products/{id_or_sku}", response_model=StorefrontProduct)
def get_store_product_detail(
    id_or_sku: str,
    site: Literal["ulink", "towels"] | None = Query(default=None),
    lang: Literal["vi", "en"] = Query(default="vi"),
    db: Session = Depends(get_db),
) -> StorefrontProduct:
    """Chi tiết sản phẩm (Tìm trong kho trước, nếu không có tìm tiếp trong Showcase)."""
    if site is not None:
        return _website_detail(db, site, lang, id_or_sku)
    clean_val = id_or_sku.strip()

    # 1. Tìm trong kho Products
    query = (
        select(Product)
        .options(selectinload(Product.category), selectinload(Product.images))
        .where(Product.is_active.is_(True))
    )
    if site != "towels":
        query = query.where(Product.catalog_enabled.is_(True))

    if clean_val.isdigit():
        prod = db.scalar(query.where(or_(Product.id == int(clean_val), func.lower(Product.sku) == clean_val.lower())))
    else:
        prod = db.scalar(query.where(func.lower(Product.sku) == clean_val.lower()))

    if prod:
        if site == "towels":
            content = db.get(TowelWebContent, prod.id)
            if prod.business_unit != "TOWEL" or content is None or not content.is_published:
                raise HTTPException(status_code=404, detail="Towel product is not published")
        sibling_variants: list[StorefrontProductVariant] = []
        if prod.variant_group_id:
            sibling_query = select(Product).where(
                Product.variant_group_id == prod.variant_group_id,
                Product.is_active.is_(True),
            )
            if site != "towels":
                sibling_query = sibling_query.where(Product.catalog_enabled.is_(True))
            siblings = db.scalars(
                sibling_query.order_by(Product.catalog_sort_order.asc(), Product.id.asc())
            ).all()
            for sib in siblings:
                variant_name = sib.name
                variant_image = sib.image_url
                if site == "towels":
                    variant_content = db.get(TowelWebContent, sib.id)
                    if variant_content is None or not variant_content.is_published:
                        continue
                    variant_name = variant_content.title or sib.name
                    variant_media = list(db.scalars(
                        select(TowelWebMedia)
                        .where(TowelWebMedia.product_id == sib.id)
                        .order_by(TowelWebMedia.sort_order, TowelWebMedia.id)
                    ))
                    featured = next((item for item in variant_media if item.is_primary), variant_media[0] if variant_media else None)
                    variant_image = featured.image_url if featured else None
                sibling_variants.append(
                    StorefrontProductVariant(
                        id=sib.id,
                        sku=sib.sku,
                        name=variant_name,
                        color_name=sib.color_name,
                        color_hex=sib.color_hex,
                        image_url=_format_image_url(variant_image),
                        unit_price=None,
                        is_in_stock=bool(sib.quantity_on_hand and sib.quantity_on_hand > 0),
                    )
                )
        if site == "towels" and prod.business_unit == "TOWEL":
            media = list(db.scalars(select(TowelWebMedia).where(TowelWebMedia.product_id == prod.id)))
            result = _to_towel_storefront_product(prod, content, media)
            result.variants = sibling_variants
            return result
        return _to_storefront_product(prod, sibling_variants=sibling_variants)

    # 2. Tìm trong bảng ShowcaseItem
    if site == "towels":
        raise HTTPException(status_code=404, detail="Towel product not found")
    sc_item = db.scalar(
        select(ShowcaseItem).where(
            ShowcaseItem.is_active.is_(True),
            or_(
                func.lower(ShowcaseItem.code) == clean_val.lower(),
                ShowcaseItem.id == (int(clean_val) - 100000) if clean_val.isdigit() else False,
            )
        )
    )
    if sc_item:
        return _showcase_to_storefront(sc_item)

    raise HTTPException(status_code=404, detail="Sản phẩm không tồn tại hoặc đã ngừng kinh doanh")


@router.get("/featured", response_model=list[StorefrontProduct])
def list_featured_products(
    limit: int = Query(default=12, ge=1, le=50),
    site: Literal["ulink", "towels"] | None = Query(default=None),
    lang: Literal["vi", "en"] = Query(default="vi"),
    db: Session = Depends(get_db),
) -> list[StorefrontProduct]:
    """Danh sách sản phẩm nổi bật cho trang chủ."""
    if site is not None:
        return [_render_website_listing(db, row, lang) for row in _published_listing_rows(db, site)[:limit]]
    items: list[StorefrontProduct] = []

    # Lấy hàng kho nổi bật
    products = db.scalars(
        select(Product)
        .options(selectinload(Product.category), selectinload(Product.images))
        .where(Product.catalog_enabled.is_(True), Product.is_active.is_(True))
        .order_by(Product.catalog_sort_order.asc())
        .limit(limit // 2)
    ).all()
    for p in products:
        items.append(_to_storefront_product(p))

    # Lấy showcase tiêu biểu
    showcases = db.scalars(
        select(ShowcaseItem)
        .where(ShowcaseItem.is_active.is_(True))
        .order_by(ShowcaseItem.sort_order.asc())
        .limit(limit - len(items))
    ).all()
    for s in showcases:
        items.append(_showcase_to_storefront(s))

    return items


@router.get("/catalog.pdf")
def download_public_catalog_pdf(
    show_price: bool = False,
    db: Session = Depends(get_db),
) -> Response:
    """Tải file PDF Catalog ULINK (mặc định ẩn giá)."""
    grouped: dict[int, list[CatalogProduct]] = {}
    public_categories: dict[int, WebsiteCategory] = {}
    for listing in _published_listing_rows(db, "ulink"):
        if listing.category_id is None:
            continue
        category = db.get(WebsiteCategory, listing.category_id)
        if category is None or not category.is_active:
            continue
        public_categories[category.id] = category
        view = _render_website_listing(db, listing, "vi")
        if listing.product_id is not None:
            product = db.get(Product, listing.product_id)
            item = replace(
                normalize_catalog_product(product),
                category_id=category.id,
                category_name=view.category_name or "",
                product_name=view.name,
                catalog_short_name=view.catalog_short_name or view.name,
                image_url=view.image_url,
                sort_order=listing.sort_order,
            )
        else:
            item = CatalogProduct(
                id=view.id, category_id=category.id, category_name=view.category_name or "",
                sku=view.sku, brand=view.brand or "", product_name=view.name,
                catalog_short_name=view.catalog_short_name or view.name,
                image_url=view.image_url, unit_size=view.unit_size or "",
                case_pack=view.case_pack, country_of_origin=view.country_of_origin or "",
                upc=view.upc or "", wholesale_price=Decimal(0), currency=view.currency,
                availability="in_stock", badges=tuple(view.badges), sort_order=listing.sort_order,
            )
        grouped.setdefault(category.id, []).append(item)
    categories = tuple(
        CatalogCategory(
            id=category.id,
            name=category.name_vi or category.name_en or "Products",
            sort_order=category.sort_order,
            products=tuple(sorted(grouped[category.id], key=lambda item: (item.sort_order, item.product_name.casefold()))),
        )
        for category in sorted(public_categories.values(), key=lambda row: (row.sort_order, row.id))
    )
    company = get_catalog_company(title="ULINK LLC Product Catalog", version="Official")
    pdf_bytes, _ = render_catalog_pdf(
        company=company,
        categories=categories,
        options=CatalogRenderOptions(
            show_price=False,
            show_badges=True,
            show_country_of_origin=True,
            show_upc=True,
            show_availability=True,
        ),
    )
    headers = {
        "Content-Disposition": 'inline; filename="ULINK_Product_Catalog.pdf"',
        "Content-Type": "application/pdf",
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


class ShippingRateEstimateRequest(BaseModel):
    zip: str
    city: Optional[str] = None
    state: Optional[str] = None
    street1: Optional[str] = "Customer Address"
    weight_lb: float = 5.0
    length_in: float = 12.0
    width_in: float = 10.0
    height_in: float = 6.0


@router.post("/estimate-shipping", response_model=ShippingRateResponse)
def estimate_shipping_cost(req: ShippingRateEstimateRequest) -> ShippingRateResponse:
    """
    Ước tính phí vận chuyển nhanh tức thì qua Shippo API (USPS Commercial & UPS Ground/Air).
    Hỗ trợ tính phí cho khách hàng trên website và kiểm tra nhanh.
    """
    to_addr = AddressInput(
        name="Customer",
        street1=req.street1 or "123 Main St",
        city=req.city or "",
        state=req.state or "",
        zip=req.zip.strip(),
    )
    parcel = ParcelInput(
        length=req.length_in,
        width=req.width_in,
        height=req.height_in,
        weight=req.weight_lb,
    )
    return get_shippo_shipping_rates(address_to=to_addr, parcel=parcel)
