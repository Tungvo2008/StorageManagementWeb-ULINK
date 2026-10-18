from __future__ import annotations

import json

from sqlalchemy import select

from app.db.models import (
    Product, ProductImage, ShowcaseItem, TowelWebContent, TowelWebMedia,
    WebsiteCategory, WebsiteListing, WebsiteListingMedia, WebsiteListingTranslation,
)
from app.db.session import SessionLocal

ULINK_CATEGORIES = [
    ("towels", "Khăn", "Towels"),
    ("nail-supplies", "Dụng cụ nail", "Nail supplies"),
    ("food-drinks", "Thực phẩm & đồ uống", "Food & drinks"),
    ("equipment", "Thiết bị thương mại", "Commercial equipment"),
    ("packaging", "Bao bì", "Packaging"),
    ("decor", "Trang trí", "Decor"),
]
TOWEL_CATEGORIES = [
    ("washcloth-13x13", "Khăn 13 × 13", "Wash Cloth 13 × 13", 2),
    ("hand-towel-500gsm", "Khăn tay 16 × 28 · 500 GSM", "Hand Towel 16 × 28 · 500 GSM", 1),
    ("hand-towel-600gsm", "Khăn tay 16 × 28 · 600 GSM", "Hand Towel 16 × 28 · 600 GSM", 5),
]


def add_media(db, listing, image_url, alt_text, order, primary):
    if image_url:
        db.add(WebsiteListingMedia(
            listing_id=listing.id, image_url=image_url, alt_text=alt_text,
            sort_order=order, is_primary=primary,
        ))


def main() -> None:
    with SessionLocal() as db:
        categories = {}
        for site, rows in (
            ("ulink", ULINK_CATEGORIES),
            ("towels", [(slug, vi, en) for slug, vi, en, _ in TOWEL_CATEGORIES]),
        ):
            for order, (slug, vi, en) in enumerate(rows):
                category = db.scalar(select(WebsiteCategory).where(
                    WebsiteCategory.site == site, WebsiteCategory.slug == slug,
                ))
                if category is None:
                    category = WebsiteCategory(
                        site=site, slug=slug, name_vi=vi, name_en=en,
                        sort_order=order, is_active=True,
                    )
                    db.add(category)
                    db.flush()
                categories[(site, slug)] = category.id

        counts = {"ulink": 0, "towels": 0, "showcase": 0}
        products = db.scalars(select(Product).where(Product.is_active.is_(True))).all()
        towel_content = {
            row.product_id: row for row in db.scalars(select(TowelWebContent)).all()
        }
        for product in products:
            if product.catalog_enabled:
                listing = db.scalar(select(WebsiteListing).where(
                    WebsiteListing.site == "ulink", WebsiteListing.product_id == product.id,
                ))
                if listing is None:
                    slug = (
                        "towels" if product.business_unit == "TOWEL"
                        else "nail-supplies" if product.category_id in (3, 4)
                        else "food-drinks" if product.business_unit == "GROCERY"
                        else "equipment"
                    )
                    listing = WebsiteListing(
                        site="ulink", product_id=product.id, is_published=True,
                        category_id=categories["ulink", slug],
                        sort_order=product.catalog_sort_order or 0,
                    )
                    db.add(listing)
                    db.flush()
                    db.add(WebsiteListingTranslation(
                        listing_id=listing.id, locale="vi",
                        title=product.catalog_short_name or product.name,
                        description=product.description,
                    ))
                    images = db.scalars(select(ProductImage).where(
                        ProductImage.product_id == product.id,
                    ).order_by(ProductImage.sort_order, ProductImage.id)).all()
                    if images:
                        for index, image in enumerate(images):
                            add_media(db, listing, image.image_url, image.alt_text,
                                      image.sort_order, image.is_primary or (index == 0 and not any(i.is_primary for i in images)))
                    else:
                        add_media(db, listing, product.image_url, product.name, 0, True)
                    counts["ulink"] += 1

            old = towel_content.get(product.id)
            if old and product.business_unit == "TOWEL":
                listing = db.scalar(select(WebsiteListing).where(
                    WebsiteListing.site == "towels", WebsiteListing.product_id == product.id,
                ))
                if listing is None:
                    slug = next((slug for slug, _, _, category_id in TOWEL_CATEGORIES
                                 if category_id == product.category_id), None)
                    listing = WebsiteListing(
                        site="towels", product_id=product.id,
                        is_published=bool(old.is_published),
                        category_id=categories.get(("towels", slug)),
                        sort_order=product.catalog_sort_order or 0,
                    )
                    db.add(listing)
                    db.flush()
                    db.add(WebsiteListingTranslation(
                        listing_id=listing.id, locale="en",
                        title=old.title or product.name, summary=old.summary,
                        description=old.description, seo_title=old.seo_title,
                        seo_description=old.seo_description,
                    ))
                    old_media = db.scalars(select(TowelWebMedia).where(
                        TowelWebMedia.product_id == product.id,
                    ).order_by(TowelWebMedia.sort_order, TowelWebMedia.id)).all()
                    for index, image in enumerate(old_media):
                        add_media(db, listing, image.image_url, image.alt_text,
                                  image.sort_order, image.is_primary or (index == 0 and not any(i.is_primary for i in old_media)))
                    counts["towels"] += 1

        showcases = db.scalars(select(ShowcaseItem).where(ShowcaseItem.is_active.is_(True))).all()
        for showcase in showcases:
            listing = db.scalar(select(WebsiteListing).where(
                WebsiteListing.site == "ulink", WebsiteListing.showcase_id == showcase.id,
            ))
            if listing is not None:
                continue
            slug = (
                "equipment" if showcase.code.startswith("EQ-")
                else "packaging" if showcase.code.startswith("PKG-")
                else "decor" if showcase.code.startswith("ART-")
                else "food-drinks"
            )
            listing = WebsiteListing(
                site="ulink", showcase_id=showcase.id, is_published=True,
                category_id=categories["ulink", slug],
                sort_order=showcase.sort_order or 0,
            )
            db.add(listing)
            db.flush()
            db.add(WebsiteListingTranslation(
                listing_id=listing.id, locale="en", title=showcase.name,
                description=showcase.description,
            ))
            try:
                images = json.loads(showcase.images or "[]")
            except (TypeError, ValueError):
                images = []
            if images:
                for index, item in enumerate(images):
                    url = item if isinstance(item, str) else item.get("image_url")
                    alt = showcase.name if isinstance(item, str) else item.get("alt_text")
                    add_media(db, listing, url, alt, index, index == 0)
            else:
                add_media(db, listing, showcase.image_url, showcase.name, 0, True)
            counts["showcase"] += 1
        db.commit()
        print(counts)


if __name__ == "__main__":
    main()
