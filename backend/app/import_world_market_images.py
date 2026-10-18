"""Attach reviewed World Market product photos to Ulink website listings.

Run on the ERP host from the backend directory after copying the images to
assets/product-images/worldmarket-<invoice-line>.webp.
"""

from pathlib import Path

from sqlalchemy import select

from app.db.models import ShowcaseItem, WebsiteListing, WebsiteListingMedia
from app.db.session import SessionLocal


PHOTOS = {
    "SC-UL0045-167": ("worldmarket-167.webp", "Sting Gold lon cao, ảnh sản phẩm tham khảo"),
    "SC-UL0045-168": ("worldmarket-168.webp", "Sting dâu lon cao, ảnh sản phẩm tham khảo"),
    "SC-UL0045-170": ("worldmarket-170.webp", "Nước tăng lực Warrior vị dâu dạng lon"),
    "SC-UL0045-171": ("worldmarket-171.webp", "Nước tăng lực Warrior vị nho dạng lon"),
    "SC-UL0045-172": ("worldmarket-172.webp", "Trà ô long TEA+ Plus, ảnh sản phẩm tham khảo"),
    "SC-UL0045-173": ("worldmarket-173-tac.webp", "Trà mật ong BONCHA vị tắc, ảnh sản phẩm tham khảo"),
    "SC-UL0045-174": ("worldmarket-174-chanh.webp", "Trà C2 vị chanh, ảnh sản phẩm tham khảo"),
    "SC-UL0045-176": ("worldmarket-176.webp", "Trà xanh Không Độ, ảnh sản phẩm tham khảo"),
    "SC-UL0045-177": ("worldmarket-177.webp", "Nước tăng lực Red Bull, ảnh sản phẩm tham khảo"),
    "SC-UL0045-179": ("worldmarket-179.webp", "Mì chay Safoco, ảnh sản phẩm tham khảo"),
    "SC-UL0045-180": ("worldmarket-180.webp", "Bún tươi Safoco, ảnh sản phẩm tham khảo"),
    "SC-UL0045-181": ("worldmarket-181.webp", "Nui Meizan, ảnh sản phẩm tham khảo; xác nhận hình dạng và quy cách khi báo giá"),
    "SC-UL0045-182": ("worldmarket-182.webp", "Nui Safoco, ảnh sản phẩm tham khảo"),
    "SC-UL0045-183": ("worldmarket-183.webp", "Bánh đa khô Vifon, ảnh sản phẩm tham khảo"),
    "SC-UL0045-184": ("worldmarket-184.webp", "Miến Phú Hương, ảnh sản phẩm tham khảo"),
    "SC-UL0045-185": ("worldmarket-185.webp", "Bún gạo Safoco, ảnh sản phẩm tham khảo"),
    "SC-UL0045-191": ("worldmarket-191.webp", "Tương ớt Cholimex, ảnh sản phẩm tham khảo; quy cách xác nhận khi báo giá"),
    "SC-UL0045-192": ("worldmarket-192.webp", "Tương ớt CHIN-SU, ảnh sản phẩm tham khảo; quy cách xác nhận khi báo giá"),
    "SC-UL0045-195": ("worldmarket-195.webp", "Muối chấm Hảo Hảo, ảnh sản phẩm tham khảo"),
    "SC-UL0045-196": ("worldmarket-196.webp", "Nước mắm CHIN-SU, ảnh sản phẩm tham khảo; quy cách xác nhận khi báo giá"),
}

EXTRA_PHOTOS = [
    ("SC-UL0045-173", "worldmarket-173-vietquat.webp", "Trà mật ong BONCHA vị việt quất, ảnh sản phẩm tham khảo"),
    ("SC-UL0045-174", "worldmarket-174-dao.webp", "Trà C2 vị đào, ảnh sản phẩm tham khảo"),
]


def main() -> None:
    image_dir = Path(__file__).resolve().parents[1] / "assets" / "product-images"
    with SessionLocal() as db:
        added = 0
        rows = [(code, filename, alt) for code, (filename, alt) in PHOTOS.items()]
        rows.extend(EXTRA_PHOTOS)
        for code, filename, alt_text in rows:
            if not (image_dir / filename).is_file():
                raise FileNotFoundError(image_dir / filename)
            item = db.scalar(select(ShowcaseItem).where(ShowcaseItem.code == code))
            if item is None:
                raise RuntimeError(f"Missing showcase item: {code}")
            listing = db.scalar(select(WebsiteListing).where(
                WebsiteListing.site == "ulink", WebsiteListing.showcase_id == item.id,
            ))
            if listing is None:
                raise RuntimeError(f"Missing Ulink listing: {code}")
            url = f"/api/v1/public/product-images/{filename}"
            exists = db.scalar(select(WebsiteListingMedia).where(
                WebsiteListingMedia.listing_id == listing.id,
                WebsiteListingMedia.image_url == url,
            ))
            if exists:
                continue
            current = list(db.scalars(select(WebsiteListingMedia).where(
                WebsiteListingMedia.listing_id == listing.id,
            )))
            db.add(WebsiteListingMedia(
                listing_id=listing.id, image_url=url, alt_text=alt_text,
                sort_order=max((row.sort_order for row in current), default=-1) + 1,
                is_primary=not current,
            ))
            added += 1
        db.commit()
    print(f"Added {added} website product photos")


if __name__ == "__main__":
    main()
