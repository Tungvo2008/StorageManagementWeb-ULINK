from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel


class CatalogCompanyRead(BaseModel):
    title: str
    version: str
    company_name: str
    logo_url: str
    website: str
    email: str
    phone: str
    brand_color: str


class CatalogProductRead(BaseModel):
    id: int
    category_id: int | None
    category_name: str
    sku: str
    brand: str
    product_name: str
    catalog_short_name: str
    image_url: str | None
    unit_size: str
    case_pack: int | None
    country_of_origin: str
    upc: str
    wholesale_price: Decimal
    currency: str
    availability: str
    badges: list[str]
    sort_order: int


class CatalogCategoryRead(BaseModel):
    id: int | None
    name: str
    sort_order: int
    products: list[CatalogProductRead]


class CatalogDataRead(BaseModel):
    catalog: CatalogCompanyRead
    categories: list[CatalogCategoryRead]
    product_count: int
    page_count: int
    missing_image_skus: list[str]
