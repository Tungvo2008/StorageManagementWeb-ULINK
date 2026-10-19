from __future__ import annotations

import enum
from datetime import datetime, timezone, date
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, Date, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )


class StorefrontInquiry(TimestampMixin, Base):
    __tablename__ = "storefront_inquiries"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False, index=True)
    reference: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, index=True)
    phone: Mapped[str | None] = mapped_column(String(80))
    address: Mapped[str | None] = mapped_column(String(500))
    company: Mapped[str | None] = mapped_column(String(160))
    message: Mapped[str | None] = mapped_column(Text)
    items_json: Mapped[str] = mapped_column(Text, nullable=False)
    telegram_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    google_task_id: Mapped[str | None] = mapped_column(String(255))


class StorefrontQuote(TimestampMixin, Base):
    __tablename__ = "storefront_quotes"

    id: Mapped[int] = mapped_column(primary_key=True)
    inquiry_id: Mapped[int] = mapped_column(ForeignKey("storefront_inquiries.id"), nullable=False, index=True)
    reference: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    customer_name: Mapped[str] = mapped_column(String(120), nullable=False)
    customer_email: Mapped[str] = mapped_column(String(254), nullable=False)
    customer_phone: Mapped[str | None] = mapped_column(String(80))
    customer_address: Mapped[str | None] = mapped_column(String(500))
    company: Mapped[str | None] = mapped_column(String(160))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    valid_until: Mapped[date | None] = mapped_column(Date)
    incoterm: Mapped[str] = mapped_column(String(80), nullable=False)
    payment_terms: Mapped[str] = mapped_column(String(300), nullable=False)
    delivery_terms: Mapped[str] = mapped_column(String(300), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    lines_json: Mapped[str] = mapped_column(Text, nullable=False)


class StockMovementType(str, enum.Enum):
    IN = "IN"
    OUT = "OUT"
    ADJUST = "ADJUST"


class SaleStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    CONFIRMED = "CONFIRMED"
    CANCELLED = "CANCELLED"


class InvoiceStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ISSUED = "ISSUED"
    PAID = "PAID"
    VOID = "VOID"


class InvoicePaymentStatus(str, enum.Enum):
    UNPAID = "UNPAID"
    PARTIAL = "PARTIAL"
    PAID = "PAID"
    VOID = "VOID"


class InvoiceLineType(str, enum.Enum):
    PRODUCT = "PRODUCT"
    FREE = "FREE"


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Customer(TimestampMixin, Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    city: Mapped[str | None] = mapped_column(String(255), nullable=True)
    zip_code: Mapped[str | None] = mapped_column(String(32), nullable=True)

    sale_orders: Mapped[list[SaleOrder]] = relationship(back_populates="customer")


class CustomerProductPrice(TimestampMixin, Base):
    __tablename__ = "customer_product_prices"
    __table_args__ = (
        UniqueConstraint("customer_id", "product_id", name="uq_customer_product_price"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    last_sold_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_invoice_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    customer: Mapped["Customer"] = relationship()
    product: Mapped["Product"] = relationship()


class Product(TimestampMixin, Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    brand: Mapped[str | None] = mapped_column(String(128), nullable=True)
    catalog_short_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    unit_size: Mapped[str | None] = mapped_column(String(64), nullable=True)
    catalog_case_pack: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hs_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    carton_net_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 3), nullable=True)
    carton_gross_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 3), nullable=True)
    carton_length_cm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    carton_width_cm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    carton_height_cm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    cartons_per_20ft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cartons_per_40ft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    country_of_origin: Mapped[str | None] = mapped_column(String(128), nullable=True)
    upc: Mapped[str | None] = mapped_column(String(64), nullable=True)
    catalog_badges: Mapped[str | None] = mapped_column(String(255), nullable=True)
    catalog_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    catalog_sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_sold_on_amazon: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    amazon_sku: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True, index=True)
    business_unit: Mapped[str] = mapped_column(String(32), nullable=False, default="TOWEL")

    # Rich PDP & Storefront features
    highlights: Mapped[str | None] = mapped_column(Text, nullable=True, default="[]")
    specifications: Mapped[str | None] = mapped_column(Text, nullable=True, default="{}")
    show_price: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    price_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    min_order_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True, default=1)
    lead_time: Mapped[str | None] = mapped_column(String(64), nullable=True)
    variant_group_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    color_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    color_hex: Mapped[str | None] = mapped_column(String(16), nullable=True)
    price_tiers: Mapped[str | None] = mapped_column(Text, nullable=True, default="[]")
    metafields: Mapped[str | None] = mapped_column(Text, nullable=True, default="{}")
    related_product_skus: Mapped[str | None] = mapped_column(Text, nullable=True, default="[]")

    # Base unit used for stock counting (smallest unit, vd: Pc).
    base_uom: Mapped[str] = mapped_column(String(32), nullable=False, default="Pc")

    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="Pc")
    # Quy ước: tồn kho lưu theo "base units". Ví dụ UOM=Dozen thì base units = pcs, multiplier=12.
    # Với các UOM không có quy đổi (Pc/Case/...), multiplier=1.
    uom_multiplier: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    cost_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")

    quantity_on_hand: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    category: Mapped["Category"] = relationship(back_populates="products")
    images: Mapped[list["ProductImage"]] = relationship(
        "ProductImage",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductImage.sort_order.asc()",
    )
    stock_movements: Mapped[list[StockMovement]] = relationship(back_populates="product")
    amazon_mappings: Mapped[list["AmazonProductMapping"]] = relationship(back_populates="product")
    repack_logs: Mapped[list["GroceryRepackLog"]] = relationship(
        "GroceryRepackLog",
        foreign_keys="[GroceryRepackLog.target_product_id]",
        back_populates="target_product",
    )
    batches: Mapped[list["InventoryBatch"]] = relationship(
        "InventoryBatch",
        back_populates="product",
        cascade="all, delete-orphan",
    )




class ProductImage(TimestampMixin, Base):
    __tablename__ = "product_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    alt_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    product: Mapped[Product] = relationship(back_populates="images")


class TowelWebContent(TimestampMixin, Base):
    """Storefront copy for The Towels Haven; inventory data remains on Product."""

    __tablename__ = "towel_web_content"

    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), primary_key=True)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    seo_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    seo_description: Mapped[str | None] = mapped_column(String(500), nullable=True)


class TowelWebMedia(TimestampMixin, Base):
    """Ordered web-only product media, independent of ERP/POS imagery."""

    __tablename__ = "towel_web_media"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    image_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    alt_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class WebsiteCategory(TimestampMixin, Base):
    __tablename__ = "website_categories"
    __table_args__ = (UniqueConstraint("site", "slug"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    site: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(128), nullable=False)
    name_vi: Mapped[str | None] = mapped_column(String(255))
    name_en: Mapped[str | None] = mapped_column(String(255))
    description_vi: Mapped[str | None] = mapped_column(Text)
    description_en: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class WebsiteListing(TimestampMixin, Base):
    __tablename__ = "website_listings"
    __table_args__ = (
        UniqueConstraint("site", "product_id"),
        UniqueConstraint("site", "showcase_id"),
        CheckConstraint("(product_id IS NOT NULL AND showcase_id IS NULL) OR (product_id IS NULL AND showcase_id IS NOT NULL)"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    site: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    showcase_id: Mapped[int | None] = mapped_column(ForeignKey("showcase_items.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("website_categories.id"), index=True)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class WebsiteListingTranslation(TimestampMixin, Base):
    __tablename__ = "website_listing_translations"
    __table_args__ = (UniqueConstraint("listing_id", "locale"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("website_listings.id", ondelete="CASCADE"), nullable=False, index=True)
    locale: Mapped[str] = mapped_column(String(5), nullable=False)
    title: Mapped[str | None] = mapped_column(String(255))
    summary: Mapped[str | None] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    seo_title: Mapped[str | None] = mapped_column(String(255))
    seo_description: Mapped[str | None] = mapped_column(String(500))


class WebsiteListingMedia(TimestampMixin, Base):
    __tablename__ = "website_listing_media"

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("website_listings.id", ondelete="CASCADE"), nullable=False, index=True)
    image_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    alt_text: Mapped[str | None] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class WebsitePageBlock(TimestampMixin, Base):
    __tablename__ = "website_page_blocks"
    __table_args__ = (UniqueConstraint("site", "page", "block_key", "locale"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    site: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    page: Mapped[str] = mapped_column(String(64), nullable=False)
    block_key: Mapped[str] = mapped_column(String(64), nullable=False)
    locale: Mapped[str] = mapped_column(String(5), nullable=False)
    eyebrow: Mapped[str | None] = mapped_column(String(255))
    title: Mapped[str | None] = mapped_column(String(500))
    body: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(String(2048))
    image_alt: Mapped[str | None] = mapped_column(String(255))
    cta_label: Mapped[str | None] = mapped_column(String(255))
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

class AmazonProductMapping(TimestampMixin, Base):
    __tablename__ = "amazon_product_mappings"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True, index=True)
    amazon_sku: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    asin: Mapped[str | None] = mapped_column(String(32), nullable=True)
    fnsku: Mapped[str | None] = mapped_column(String(32), nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit_weight_lb: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)

    product: Mapped[Product | None] = relationship(back_populates="amazon_mappings")
    capacities: Mapped[list["AmazonBoxCapacity"]] = relationship(
        back_populates="mapping",
        cascade="all, delete-orphan",
    )


class AmazonBoxType(TimestampMixin, Base):
    __tablename__ = "amazon_box_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    length_in: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    width_in: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    height_in: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    empty_weight_lb: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False, default=Decimal("0"))
    max_weight_lb: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    capacities: Mapped[list["AmazonBoxCapacity"]] = relationship(
        back_populates="box_type",
        cascade="all, delete-orphan",
    )


class AmazonBoxCapacity(TimestampMixin, Base):
    __tablename__ = "amazon_box_capacities"
    __table_args__ = (
        UniqueConstraint("box_type_id", "mapping_id", name="uq_amazon_box_capacity_profile"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    box_type_id: Mapped[int] = mapped_column(ForeignKey("amazon_box_types.id"), nullable=False, index=True)
    mapping_id: Mapped[int] = mapped_column(ForeignKey("amazon_product_mappings.id"), nullable=False, index=True)
    units_capacity: Mapped[int] = mapped_column(Integer, nullable=False)

    box_type: Mapped[AmazonBoxType] = relationship(back_populates="capacities")
    mapping: Mapped[AmazonProductMapping] = relationship(back_populates="capacities")


class Category(TimestampMixin, Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    catalog_sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    products: Mapped[list[Product]] = relationship(back_populates="category")


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    # Optional: link movements to a form (receipt/issue) or sale order for traceability.
    receipt_id: Mapped[int | None] = mapped_column(ForeignKey("inventory_receipts.id"), nullable=True, index=True)
    receipt_line_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_receipt_lines.id"),
        nullable=True,
        index=True,
    )
    issue_id: Mapped[int | None] = mapped_column(ForeignKey("inventory_issues.id"), nullable=True, index=True)
    issue_line_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_issue_lines.id"),
        nullable=True,
        index=True,
    )
    sale_order_id: Mapped[int | None] = mapped_column(ForeignKey("sale_orders.id"), nullable=True, index=True)
    invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), nullable=True, index=True)
    invoice_line_id: Mapped[int | None] = mapped_column(
        ForeignKey("invoice_lines.id"),
        nullable=True,
        index=True,
    )
    movement_type: Mapped[StockMovementType] = mapped_column(
        Enum(StockMovementType, name="stock_movement_type"),
        nullable=False,
    )
    # Signed delta: + tăng kho, - giảm kho
    quantity_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    product: Mapped[Product] = relationship(back_populates="stock_movements")


class InventoryReceipt(TimestampMixin, Base):
    __tablename__ = "inventory_receipts"

    id: Mapped[int] = mapped_column(primary_key=True)
    receipt_number: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    received_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    receipt_type: Mapped[str] = mapped_column(String(32), nullable=False, default="STANDARD")
    supplier_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    container_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    container_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))

    lines: Mapped[list["InventoryReceiptLine"]] = relationship(
        back_populates="receipt",
        cascade="all, delete-orphan",
    )


class InventoryReceiptLine(Base):
    __tablename__ = "inventory_receipt_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    receipt_id: Mapped[int] = mapped_column(ForeignKey("inventory_receipts.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)

    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="Pc")
    uom_multiplier: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    lot_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    carton_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pieces_per_carton: Mapped[int | None] = mapped_column(Integer, nullable=True)
    allocated_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))

    receipt: Mapped[InventoryReceipt] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()


class InventoryIssue(TimestampMixin, Base):
    __tablename__ = "inventory_issues"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_number: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    issued_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    issued_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    purpose: Mapped[str] = mapped_column(String(255), nullable=False, default="OTHER")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Optional linkage to sale order (for out movements coming from sales).
    sale_order_id: Mapped[int | None] = mapped_column(ForeignKey("sale_orders.id"), nullable=True, index=True)
    invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), nullable=True, index=True)

    lines: Mapped[list["InventoryIssueLine"]] = relationship(
        back_populates="issue",
        cascade="all, delete-orphan",
    )


class InventoryIssueLine(Base):
    __tablename__ = "inventory_issue_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("inventory_issues.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)

    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="Pc")
    uom_multiplier: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    issue: Mapped[InventoryIssue] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()


class SaleOrder(TimestampMixin, Base):
    __tablename__ = "sale_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    status: Mapped[SaleStatus] = mapped_column(Enum(SaleStatus, name="sale_status"), nullable=False)

    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(6, 4), nullable=False, default=Decimal("0"))
    subtotal_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    # Discount entered at the order level (separate from per-line discounts).
    order_discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    # Total discount (order + lines). Kept for invoices/summary.
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    shipping_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))

    customer: Mapped[Customer | None] = relationship(back_populates="sale_orders")
    lines: Mapped[list[SaleOrderLine]] = relationship(
        back_populates="sale_order",
        cascade="all, delete-orphan",
    )
    invoice: Mapped[Invoice | None] = relationship(back_populates="sale_order")


class SaleOrderLine(Base):
    __tablename__ = "sale_order_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_order_id: Mapped[int | None] = mapped_column(ForeignKey("sale_orders.id"), nullable=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)

    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)

    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    sale_order: Mapped[SaleOrder] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()


class Invoice(TimestampMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (
        UniqueConstraint("invoice_number", name="uq_invoice_invoice_number"),
        UniqueConstraint("sale_order_id", name="uq_invoice_sale_order_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_order_id: Mapped[int | None] = mapped_column(ForeignKey("sale_orders.id"), nullable=True, index=True)
    merged_into_invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), nullable=True, index=True)
    invoice_number: Mapped[str] = mapped_column(String(64), nullable=False)
    gin_number: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Import snapshot fields (from Issue Log / legacy Excel). Helps keep invoices stable
    # even if customer info changes later, and enables exporting back to Issue Log CSV.
    issue_log_no: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    client_code_snapshot: Mapped[str | None] = mapped_column(String(32), nullable=True)
    client_name_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tele_snapshot: Mapped[str | None] = mapped_column(String(64), nullable=True)
    address_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    city_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    zip_code_snapshot: Mapped[str | None] = mapped_column(String(32), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[InvoiceStatus] = mapped_column(Enum(InvoiceStatus, name="invoice_status"), nullable=False)

    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(6, 4), nullable=False, default=Decimal("0"))
    subtotal_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    order_discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    shipping_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))

    sale_order: Mapped[SaleOrder | None] = relationship(back_populates="invoice")
    stock_movements: Mapped[list["StockMovement"]] = relationship(
        foreign_keys="[StockMovement.invoice_id]",
        cascade="all, delete-orphan",
    )
    inventory_issues: Mapped[list["InventoryIssue"]] = relationship(
        foreign_keys="[InventoryIssue.invoice_id]",
    )
    merged_into_invoice: Mapped["Invoice | None"] = relationship(
        remote_side="Invoice.id",
        back_populates="merged_source_invoices",
    )
    merged_source_invoices: Mapped[list["Invoice"]] = relationship(back_populates="merged_into_invoice")
    lines: Mapped[list[InvoiceLine]] = relationship(
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceLine.order_index, InvoiceLine.id",
    )
    payments: Mapped[list["InvoicePayment"]] = relationship(
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoicePayment.paid_at",
    )

    @property
    def customer_name(self) -> str | None:
        if self.client_name_snapshot and self.client_name_snapshot.strip():
            return self.client_name_snapshot.strip()
        sale = getattr(self, "sale_order", None)
        if sale is None:
            return None
        customer = getattr(sale, "customer", None)
        if customer is None or not customer.name:
            return None
        return customer.name

    @property
    def amount_paid(self) -> Decimal:
        total = Decimal("0")
        for payment in getattr(self, "payments", []) or []:
            total += Decimal(payment.amount or 0)
        return total.quantize(Decimal("0.01"))

    @property
    def balance_due(self) -> Decimal:
        return (Decimal(self.total_amount or 0) - self.amount_paid).quantize(Decimal("0.01"))

    @property
    def payment_status(self) -> InvoicePaymentStatus:
        if self.status == InvoiceStatus.VOID:
            return InvoicePaymentStatus.VOID
        if self.amount_paid <= Decimal("0"):
            return InvoicePaymentStatus.UNPAID
        if self.balance_due <= Decimal("0"):
            return InvoicePaymentStatus.PAID
        return InvoicePaymentStatus.PARTIAL


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), nullable=False, index=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True, index=True)
    line_type: Mapped[InvoiceLineType] = mapped_column(
        Enum(InvoiceLineType, name="invoice_line_type"),
        nullable=False,
        default=InvoiceLineType.PRODUCT,
    )

    sku: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)

    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="Pc")
    line_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    invoice: Mapped[Invoice] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()


class InvoicePayment(TimestampMixin, Base):
    __tablename__ = "invoice_payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), nullable=False, index=True)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    method: Mapped[str | None] = mapped_column(String(64), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    invoice: Mapped[Invoice] = relationship(back_populates="payments")


class CargoBatchStatus(str, enum.Enum):
    OPEN = "OPEN"
    PACKED = "PACKED"
    SHIPPED = "SHIPPED"
    COMPLETED = "COMPLETED"


class CargoBoxType(str, enum.Enum):
    SINGLE = "SINGLE"
    GROUPED = "GROUPED"


class CargoStatement(TimestampMixin, Base):
    __tablename__ = "cargo_statements"

    id: Mapped[int] = mapped_column(primary_key=True)
    statement_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    statement_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    market_name: Mapped[str] = mapped_column(String(128), nullable=False, default="Chợ Đầu Mối")
    total_weight_lbs: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0"))
    total_extra_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    is_paid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


    bills: Mapped[list["CargoBill"]] = relationship(
        "CargoBill",
        back_populates="statement",
        foreign_keys="CargoBill.statement_id",
    )


class CargoBatch(TimestampMixin, Base):
    __tablename__ = "cargo_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    ship_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    market_name: Mapped[str] = mapped_column(String(128), nullable=False, default="Chợ Đầu Mối")
    status: Mapped[CargoBatchStatus] = mapped_column(
        Enum(CargoBatchStatus, name="cargo_batch_status"),
        nullable=False,
        default=CargoBatchStatus.OPEN,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    boxes: Mapped[list["CargoBox"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
    )
    bills: Mapped[list["CargoBill"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
    )


class CargoBox(TimestampMixin, Base):
    __tablename__ = "cargo_boxes"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("cargo_batches.id"), nullable=False, index=True)
    box_code: Mapped[str] = mapped_column(String(64), nullable=False)
    box_type: Mapped[CargoBoxType] = mapped_column(
        Enum(CargoBoxType, name="cargo_box_type"),
        nullable=False,
        default=CargoBoxType.SINGLE,
    )
    label_text: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    box_image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    weight_lbs: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_hub: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    hub_consignee_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tracking_number: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    delivery_status: Mapped[str | None] = mapped_column(String(32), nullable=True, default="PENDING")
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cali_code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)

    batch: Mapped[CargoBatch] = relationship(back_populates="boxes")
    bills: Mapped[list["CargoBill"]] = relationship(back_populates="box")


class CargoBill(TimestampMixin, Base):
    __tablename__ = "cargo_bills"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("cargo_batches.id"), nullable=False, index=True)
    box_id: Mapped[int | None] = mapped_column(ForeignKey("cargo_boxes.id"), nullable=True, index=True)
    invoice_no: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    bill_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    shipper_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    shipper_phone: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    shipper_address: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    consignee_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    consignee_phone: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    consignee_address: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    weight_lbs: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0"))
    declared_value: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0"))
    commodities: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    rate_per_lb: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0"))
    extra_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    bill_image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    market_name: Mapped[str] = mapped_column(String(128), nullable=False, default="Chợ Đầu Mối")
    is_paid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    billing_type: Mapped[str] = mapped_column(String(32), nullable=False, default="MARKET")
    packed_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cali_tracking_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cali_weight_lbs: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    cali_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    reconcile_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    hub_consignee_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_hub_item: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    batch: Mapped[CargoBatch] = relationship(back_populates="bills")
    statement_id: Mapped[int | None] = mapped_column(ForeignKey("cargo_statements.id"), nullable=True, index=True)
    statement: Mapped[CargoStatement | None] = relationship(
        back_populates="bills",
        foreign_keys=[statement_id],
    )
    box: Mapped[CargoBox | None] = relationship(back_populates="bills")


class BotInteractionLog(TimestampMixin, Base):
    __tablename__ = "bot_interaction_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    sender: Mapped[str] = mapped_column(String(128), nullable=False, default="telegram_user")
    channel: Mapped[str] = mapped_column(String(64), nullable=False, default="telegram")
    user_query: Mapped[str] = mapped_column(Text, nullable=False)
    bot_response: Mapped[str] = mapped_column(Text, nullable=False)
    tools_called: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="SUCCESS")


# =============================================================================
# GROCERY / BÁCH HÓA MODULE (ĐỢT NHẬP HÀNG XÁ & NHẬT KÝ ĐÓNG HŨ / ĐỐI CHIẾU)
# =============================================================================

class GroceryInboundBatch(TimestampMixin, Base):
    """
    Đợt nhập hàng xá / Lô hàng về từ VN (ví dụ: Chuyến Tháng 9, Lô 18/09/2024...).
    """
    __tablename__ = "grocery_inbound_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    supplier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="OPEN")  # OPEN, COMPLETED

    items: Mapped[list["GroceryInboundItem"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="GroceryInboundItem.id",
    )
    repack_logs: Mapped[list["GroceryRepackLog"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="GroceryRepackLog.repacked_at.desc()",
    )


class GroceryInboundItem(TimestampMixin, Base):
    """
    Từng mặt hàng xá trong một đợt nhập:
    - initial_quantity: TỔNG TOÀN BỘ NHẬP VỀ
    - repacked_quantity: ĐÃ MÚC RA ĐÓNG HŨ
    - remaining_quantity: TỔNG HIỆN TẠI CÒN LẠI (dùng để đối chiếu)
    """
    __tablename__ = "grocery_inbound_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("grocery_inbound_batches.id"), nullable=False, index=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True, index=True)

    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="kg")  # kg, thùng, bao...

    initial_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=Decimal("0"))
    repacked_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=Decimal("0"))
    remaining_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=Decimal("0"))

    cost_price: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False, default=Decimal("0"))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    batch: Mapped[GroceryInboundBatch] = relationship(back_populates="items")
    repack_logs: Mapped[list["GroceryRepackLog"]] = relationship(back_populates="inbound_item")


class GroceryRepackLog(TimestampMixin, Base):
    """
    Nhật ký đóng hũ / chia nhỏ hàng:
    Mỗi lần lấy hàng xá ra đóng hũ thành phẩm sẽ ghi lại ở đây.
    """
    __tablename__ = "grocery_repack_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("grocery_inbound_batches.id"), nullable=False, index=True)
    inbound_item_id: Mapped[int] = mapped_column(ForeignKey("grocery_inbound_items.id"), nullable=False, index=True)
    target_product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)

    source_qty_used: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)  # Số lượng xá lấy ra (kg/thùng)
    target_units_produced: Mapped[int] = mapped_column(Integer, nullable=False)  # Số hũ/gói thành phẩm tạo ra
    yield_per_unit: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False, default=Decimal("0"))  # Tỷ lệ g/hũ

    repacked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    stock_movement_id: Mapped[int | None] = mapped_column(ForeignKey("stock_movements.id"), nullable=True)

    batch: Mapped[GroceryInboundBatch] = relationship(back_populates="repack_logs")
    inbound_item: Mapped[GroceryInboundItem] = relationship(back_populates="repack_logs")
    target_product: Mapped[Product] = relationship(foreign_keys=[target_product_id])




class InventoryBatch(TimestampMixin, Base):
    """Quản lý Date (Hạn sử dụng) và Lô hàng (Batch/Lot) của Sản Phẩm."""
    __tablename__ = "inventory_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    expiration_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    manufacture_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    initial_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity_on_hand: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    inbound_reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    storage_location: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_batch_id: Mapped[int | None] = mapped_column(ForeignKey("inventory_batches.id"), nullable=True, index=True)

    product: Mapped["Product"] = relationship(back_populates="batches")
    parent_batch: Mapped[InventoryBatch | None] = relationship(
        "InventoryBatch",
        remote_side=[id],
        foreign_keys=[parent_batch_id],
    )


class ShowcaseItem(TimestampMixin, Base):
    __tablename__ = "showcase_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(128), nullable=False)
    category_slug: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    highlights: Mapped[str | None] = mapped_column(Text, nullable=True, default="[]")
    specifications: Mapped[str | None] = mapped_column(Text, nullable=True, default="{}")
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    images: Mapped[str | None] = mapped_column(Text, nullable=True, default="[]")
    min_order_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    lead_time: Mapped[str | None] = mapped_column(String(128), nullable=True)
    brand: Mapped[str | None] = mapped_column(String(128), nullable=True, default="ULINK")
    badges: Mapped[str | None] = mapped_column(Text, nullable=True, default="[]")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
