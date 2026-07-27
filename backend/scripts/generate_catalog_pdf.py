from __future__ import annotations

import argparse
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.init_db import init_db
from app.db.models import Product
from app.db.session import SessionLocal
from app.services.catalog_render import (
    CatalogRenderOptions,
    build_catalog_categories,
    get_catalog_company,
    render_catalog_pdf,
)


def _csv_values(values: list[str]) -> set[str]:
    return {
        item.strip().casefold()
        for value in values
        for item in value.split(",")
        if item.strip()
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the standard 12-product Ulink catalog PDF.")
    parser.add_argument(
        "--output",
        default="exports/catalog/ULINK Product Catalog.pdf",
        help="Output PDF path, relative to backend unless absolute.",
    )
    parser.add_argument("--title", default="", help="Catalog title override.")
    parser.add_argument("--version", default="", help="Catalog version/date override.")
    parser.add_argument("--category-id", action="append", default=[], help="Category ID; repeat or comma-separate.")
    parser.add_argument("--brand", default="", help="Exact brand filter.")
    parser.add_argument("--sku", action="append", default=[], help="SKU; repeat or comma-separate.")
    parser.add_argument(
        "--availability",
        choices=("all", "in_stock", "out_of_stock"),
        default="all",
    )
    parser.add_argument("--include-inactive", action="store_true")
    parser.add_argument("--show-price", action="store_true")
    parser.add_argument("--show-origin", action="store_true")
    parser.add_argument("--show-upc", action="store_true")
    parser.add_argument("--hide-badges", action="store_true")
    parser.add_argument("--show-availability", action="store_true")
    args = parser.parse_args()

    init_db()
    category_ids = {int(value) for value in _csv_values(args.category_id) if value.isdigit()}
    selected_skus = _csv_values(args.sku)
    brand = args.brand.strip().casefold()

    with SessionLocal() as db:
        products = db.scalars(
            select(Product)
            .options(selectinload(Product.category))
            .order_by(Product.catalog_sort_order.asc(), Product.sku.asc())
        ).all()
        selected: list[Product] = []
        for product in products:
            if not bool(product.catalog_enabled):
                continue
            if not args.include_inactive and not bool(product.is_active):
                continue
            if category_ids and product.category_id not in category_ids:
                continue
            if selected_skus and product.sku.casefold() not in selected_skus:
                continue
            if brand and (product.brand or "").strip().casefold() != brand:
                continue
            if args.availability == "in_stock" and int(product.quantity_on_hand or 0) <= 0:
                continue
            if args.availability == "out_of_stock" and int(product.quantity_on_hand or 0) > 0:
                continue
            selected.append(product)

        if not selected:
            parser.error("No products match the selected filters.")

        pdf_bytes, missing_images = render_catalog_pdf(
            company=get_catalog_company(title=args.title, version=args.version),
            categories=build_catalog_categories(selected),
            options=CatalogRenderOptions(
                show_price=args.show_price,
                show_country_of_origin=args.show_origin,
                show_upc=args.show_upc,
                show_badges=not args.hide_badges,
                show_availability=args.show_availability,
            ),
        )

    output_path = Path(args.output).expanduser()
    if not output_path.is_absolute():
        output_path = BACKEND_ROOT / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(pdf_bytes)

    print(f"Catalog generated: {output_path}")
    print(f"Products: {len(selected)}")
    print(f"Missing images: {len(missing_images)}")
    if missing_images:
        print("Missing image SKUs: " + ", ".join(missing_images))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
