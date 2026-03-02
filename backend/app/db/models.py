from __future__ import annotations

import enum
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
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


class StockMovementType(str, enum.Enum):
    IN = "IN"
    OUT = "OUT"
    ADJUST = "ADJUST"


class SaleStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    CONFIRMED = "CONFIRMED"
    CANCELLED = "CANCELLED"


class InvoiceStatus(str, enum.Enum):
    ISSUED = "ISSUED"
    PAID = "PAID"
    VOID = "VOID"


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


class Product(TimestampMixin, Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)

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
    stock_movements: Mapped[list[StockMovement]] = relationship(back_populates="product")


class Category(TimestampMixin, Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    sale_order_id: Mapped[int] = mapped_column(ForeignKey("sale_orders.id"), nullable=False, index=True)
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
    sale_order_id: Mapped[int] = mapped_column(ForeignKey("sale_orders.id"), nullable=False, index=True)
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

    sale_order: Mapped[SaleOrder] = relationship(back_populates="invoice")
    lines: Mapped[list[InvoiceLine]] = relationship(
        back_populates="invoice",
        cascade="all, delete-orphan",
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


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)

    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)

    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="Pc")
    line_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    invoice: Mapped[Invoice] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()
