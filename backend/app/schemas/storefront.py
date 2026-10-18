from __future__ import annotations

from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class StorefrontCategory(BaseModel):
    id: int
    name: str
    slug: str
    description: str | None = None
    sort_order: int = 0
    product_count: int = 0


class StorefrontProductImage(BaseModel):
    id: int
    image_url: str
    alt_text: str | None = None
    sort_order: int = 0
    is_primary: bool = False


class StorefrontPriceTier(BaseModel):
    min_qty: int
    unit_price: float
    label: str | None = None


class StorefrontProductVariant(BaseModel):
    id: int
    sku: str
    name: str
    color_name: str | None = None
    color_hex: str | None = None
    image_url: str | None = None
    unit_price: float | None = None
    is_in_stock: bool = True


class StorefrontProduct(BaseModel):
    id: int
    sku: str
    name: str
    catalog_short_name: str | None = None
    description: str | None = None
    short_description: str | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    brand: str | None = None
    unit_price: float | None = None
    currency: str = "USD"
    unit_size: str | None = None
    case_pack: int | None = None
    hs_code: str | None = None
    carton_net_weight_kg: float | None = None
    carton_gross_weight_kg: float | None = None
    carton_length_cm: float | None = None
    carton_width_cm: float | None = None
    carton_height_cm: float | None = None
    carton_cbm: float | None = None
    cartons_per_20ft: int | None = None
    cartons_per_40ft: int | None = None
    category_id: int | None = None
    category_name: str | None = None
    category_slug: str | None = None
    image_url: str | None = None
    is_in_stock: bool = True
    upc: str | None = None
    country_of_origin: str | None = None
    badges: list[str] = []
    business_unit: str = "TOWEL"
    is_sold_on_amazon: bool = False
    amazon_sku: str | None = None

    # PDP Rich Experience Fields
    images: list[StorefrontProductImage] = []
    highlights: list[str] = []
    specifications: dict[str, Any] = {}
    show_price: bool = True
    price_label: str | None = None
    min_order_quantity: int = 1
    lead_time: str | None = None

    # Shopify-inspired Extensions
    variant_group_id: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    price_tiers: list[StorefrontPriceTier] = []
    metafields: dict[str, Any] = {}
    related_product_skus: list[str] = []

    # Sibling variants populated if variant_group_id exists
    variants: list[StorefrontProductVariant] = []


class StorefrontProductList(BaseModel):
    items: list[StorefrontProduct]
    total: int
    page: int
    limit: int
    total_pages: int
