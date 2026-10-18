"""Attach reviewed tea photos to Ulink website listings.

Run on ERP host from backend directory after copying WebP files to
assets/product-images. This only edits website media, not ERP products.
"""

from pathlib import Path
from sqlalchemy import select

from app.db.models import Product, WebsiteListing, WebsiteListingMedia
from app.db.session import SessionLocal


PHOTOS = {
    "TRA_ATISO_NGOC_DUY_GOI_CAM": [("atiso-ngocduy-cam.webp", "Trà atiso Ngọc Duy gói cam, ảnh bao bì tham khảo")],
    "TRA_ATISO_NGOC_DUY_GOI_XANH": [("atiso-ngocduy-xanh.webp", "Trà atiso Ngọc Duy gói xanh, ảnh bao bì tham khảo")],
    "TRA_ATISO_LADOPHAR_TRA_ATISO": [("atiso-ladophar-pouch.webp", "Trà atiso Ladophar dạng bịch, ảnh bao bì tham khảo")],
    "TRA_ATISO_LADOPHAR_TRA_DUONG_SINH": [("atiso-ladophar-duongsinh.webp", "Trà dưỡng sinh Ladophar, ảnh bao bì tham khảo")],
    "TRA_MANG_CAU_LADOPHAR": [("mangcau-ladophar.webp", "Trà lá mãng cầu Ladophar, ảnh bao bì tham khảo")],
}


def main() -> None:
    image_dir = Path(__file__).resolve().parents[1] / "assets" / "product-images"
    added = 0
    with SessionLocal() as db:
        for sku, photos in PHOTOS.items():
            product = db.scalar(select(Product).where(Product.sku == sku))
            if product is None:
                raise RuntimeError(f"Missing product: {sku}")
            listing = db.scalar(select(WebsiteListing).where(
                WebsiteListing.site == "ulink", WebsiteListing.product_id == product.id,
            ))
            if listing is None:
                raise RuntimeError(f"Missing Ulink listing: {sku}")
            existing = list(db.scalars(select(WebsiteListingMedia).where(
                WebsiteListingMedia.listing_id == listing.id,
            )))
            for filename, alt_text in photos:
                if not (image_dir / filename).is_file():
                    raise FileNotFoundError(image_dir / filename)
                url = f"/api/v1/public/product-images/{filename}"
                if any(row.image_url == url for row in existing):
                    continue
                row = WebsiteListingMedia(
                    listing_id=listing.id, image_url=url, alt_text=alt_text,
                    sort_order=max((m.sort_order for m in existing), default=-1) + 1,
                    is_primary=not existing,
                )
                db.add(row)
                existing.append(row)
                added += 1
        db.commit()
    print(f"Added {added} tea website photos")


if __name__ == "__main__":
    main()
