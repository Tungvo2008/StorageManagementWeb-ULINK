from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db
from app.db.models import Product
from app.schemas.catalog import (
    CatalogCategoryRead,
    CatalogCompanyRead,
    CatalogDataRead,
    CatalogProductRead,
)
from app.services.catalog_render import (
    PRODUCTS_PER_PAGE,
    CatalogCategory,
    CatalogRenderOptions,
    build_catalog_categories,
    get_catalog_company,
    missing_image_skus,
    paginate_catalog,
    render_catalog_pdf,
)


router = APIRouter(prefix="/catalog")


def _parse_csv(value: str) -> set[str]:
    return {item.strip() for item in (value or "").split(",") if item.strip()}


def _filtered_categories(
    db: Session,
    *,
    category_ids: str,
    brand: str,
    availability: str,
    skus: str,
    include_inactive: bool,
) -> tuple[CatalogCategory, ...]:
    products = db.scalars(
        select(Product)
        .options(selectinload(Product.category))
        .order_by(Product.catalog_sort_order.asc(), Product.sku.asc())
    ).all()
    selected_category_ids = {
        int(value)
        for value in _parse_csv(category_ids)
        if value.isdigit()
    }
    selected_skus = {value.casefold() for value in _parse_csv(skus)}
    brand_filter = brand.strip().casefold()

    filtered: list[Product] = []
    for product in products:
        if not bool(product.catalog_enabled):
            continue
        if not include_inactive and not bool(product.is_active):
            continue
        if selected_category_ids and product.category_id not in selected_category_ids:
            continue
        if selected_skus and product.sku.casefold() not in selected_skus:
            continue
        if brand_filter and (product.brand or "").strip().casefold() != brand_filter:
            continue
        if availability == "in_stock" and int(product.quantity_on_hand or 0) <= 0:
            continue
        if availability == "out_of_stock" and int(product.quantity_on_hand or 0) > 0:
            continue
        filtered.append(product)
    return build_catalog_categories(filtered)


def _catalog_query(
    db: Session,
    category_ids: str,
    brand: str,
    availability: str,
    skus: str,
    include_inactive: bool,
) -> tuple[CatalogCategory, ...]:
    if availability not in {"all", "in_stock", "out_of_stock"}:
        raise HTTPException(status_code=400, detail="Invalid availability filter")
    return _filtered_categories(
        db,
        category_ids=category_ids,
        brand=brand,
        availability=availability,
        skus=skus,
        include_inactive=include_inactive,
    )


@router.get("/data", response_model=CatalogDataRead)
def get_catalog_data(
    category_ids: str = "",
    brand: str = "",
    availability: str = "all",
    skus: str = "",
    include_inactive: bool = False,
    title: str = "",
    version: str = "",
    db: Session = Depends(get_db),
) -> CatalogDataRead:
    categories = _catalog_query(
        db,
        category_ids,
        brand,
        availability,
        skus,
        include_inactive,
    )
    company = get_catalog_company(title=title, version=version)
    pages = paginate_catalog(categories)
    category_payload = [
        CatalogCategoryRead(
            id=category.id,
            name=category.name,
            sort_order=category.sort_order,
            products=[CatalogProductRead(**product.__dict__) for product in category.products],
        )
        for category in categories
    ]
    return CatalogDataRead(
        catalog=CatalogCompanyRead(**company.__dict__),
        categories=category_payload,
        product_count=sum(len(category.products) for category in categories),
        page_count=len(pages),
        missing_image_skus=missing_image_skus(categories),
    )


@router.get("/pdf")
def download_catalog_pdf(
    category_ids: str = "",
    brand: str = "",
    availability: str = "all",
    skus: str = "",
    include_inactive: bool = False,
    title: str = "",
    version: str = "",
    show_price: bool = False,
    show_country_of_origin: bool = False,
    show_upc: bool = False,
    show_badges: bool = True,
    show_availability: bool = False,
    disposition: str = Query(default="attachment", pattern="^(attachment|inline)$"),
    db: Session = Depends(get_db),
) -> Response:
    categories = _catalog_query(
        db,
        category_ids,
        brand,
        availability,
        skus,
        include_inactive,
    )
    if not categories:
        raise HTTPException(status_code=400, detail="No products match the selected catalog filters")
    company = get_catalog_company(title=title, version=version)
    try:
        pdf_bytes, warnings = render_catalog_pdf(
            company=company,
            categories=categories,
            options=CatalogRenderOptions(
                show_price=show_price,
                show_country_of_origin=show_country_of_origin,
                show_upc=show_upc,
                show_badges=show_badges,
                show_availability=show_availability,
            ),
        )
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc

    headers = {
        "Content-Disposition": f'{disposition}; filename="ULINK Product Catalog.pdf"',
        "X-Catalog-Products-Per-Page": str(PRODUCTS_PER_PAGE),
        "X-Catalog-Missing-Images": str(len(warnings)),
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
