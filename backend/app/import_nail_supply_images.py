"""Attach reviewed nail supply photos to Ulink website listings.

Run on ERP host from backend directory after copying WebP files to
assets/product-images. This only edits website media, not ERP products.
"""

from pathlib import Path
from sqlalchemy import select

from app.db.models import Product, WebsiteListing, WebsiteListingMedia
from app.db.session import SessionLocal


PHOTOS = {
    "ULPL03": [("nail-header-bag.webp", "Ảnh tham khảo túi paraffin dạng header; mẫu và quy cách xác nhận trong báo giá")],
    "ULPL04": [("nail-produce-bag.webp", "Ảnh tham khảo túi PE 12 × 17 inch; số lượng và độ dày xác nhận trong báo giá")],
    "ULMBUFFER": [("nail-buffer.webp", "Ảnh tham khảo khối buffer mini; màu và quy cách xác nhận trong báo giá")],
    "ULPUMICE": [("nail-pumice.webp", "Ảnh tham khảo đá chà chân; màu và quy cách xác nhận trong báo giá")],
    "ULPL01": [("nail-paraffin.webp", "Ảnh tham khảo túi paraffin 12 × 17 inch; vật liệu và quy cách xác nhận trong báo giá")],
    "ULPL02": [("nail-paraffin.webp", "Ảnh tham khảo túi paraffin 12 × 17 inch; vật liệu và quy cách xác nhận trong báo giá")],
    "ULNND01": [
        ("nghia-d01.webp", "Kềm Nghĩa D-01, ảnh tham khảo phiên bản Jaw 14"),
    ],
    "ULF01J14": [
        ("flash-cuticle-base.webp", "Kềm FLASH F-01 Jaw 14, ảnh sản phẩm"),
        ("flash-cuticle-use.webp", "Kềm FLASH trong quá trình chăm sóc móng"),
        ("flash-cuticle-jaw14.webp", "Kềm FLASH F-01 Jaw 14, thông tin lưỡi kềm"),
        ("flash-cuticle-edge.webp", "Kềm FLASH F-01 Jaw 14, chi tiết lưỡi cắt"),
        ("flash-cuticle-spring.webp", "Kềm FLASH F-01 Jaw 14, chi tiết lò xo"),
    ],
    "ULF01J16": [
        ("flash-cuticle-base.webp", "Ảnh tham khảo dòng kềm FLASH; kích thước Jaw 16 xác nhận khi báo giá"),
    ],
    "ULF03J14": [
        ("flash-cuticle-base.webp", "Ảnh tham khảo dòng kềm FLASH; mẫu F-03 Jaw 14 xác nhận khi báo giá"),
    ],
    "ULF03J16": [
        ("flash-cuticle-base.webp", "Ảnh tham khảo dòng kềm FLASH; mẫu F-03 Jaw 16 xác nhận khi báo giá"),
    ],
    "ULBL01": [
        ("nail-spa-liner.webp", "Ảnh minh họa lớp lót bồn spa màu xanh; kích thước 45 × 45 inch xác nhận khi báo giá"),
    ],
    "ULSLIPPER": [
        ("nail-slippers.webp", "Ảnh tham khảo dép dùng một lần cho tiệm nail; độ dày 2,5 mm xác nhận khi báo giá"),
    ],
    "ULTS01": [
        ("nail-eva-separator.webp", "Ảnh tham khảo miếng tách ngón chân EVA"),
    ],
    "ULTS02": [
        ("nail-eva-separator.webp", "Ảnh minh họa kiểu miếng tách ngón chân; vật liệu PE và mẫu thực tế xác nhận khi báo giá"),
    ],
    "ULBL02": [
        ("nail-spa-liner.webp", "Ảnh minh họa lớp lót bồn spa; mẫu và kích thước 48 × 48 inch xác nhận khi báo giá"),
    ],
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
    print(f"Added {added} nail supply website photos")


if __name__ == "__main__":
    main()
