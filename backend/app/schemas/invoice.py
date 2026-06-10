from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.db.models import InvoicePaymentStatus, InvoiceStatus


class InvoiceCreateFromSale(BaseModel):
    due_days: int = Field(default=0, ge=0, le=365)


class InvoiceMergeCreate(BaseModel):
    invoice_ids: list[int] = Field(min_length=2)
    invoice_number: str | None = Field(default=None, min_length=1, max_length=64)
    issued_at: datetime | None = None
    due_at: datetime | None = None


class InvoiceUpdate(BaseModel):
    invoice_number: str | None = Field(default=None, min_length=1, max_length=64)
    issued_at: datetime | None = None
    due_at: datetime | None = None
    status: InvoiceStatus | None = None
    client_name_snapshot: str | None = Field(default=None, max_length=255)
    tele_snapshot: str | None = Field(default=None, max_length=64)
    address_snapshot: str | None = None
    city_snapshot: str | None = Field(default=None, max_length=255)
    zip_code_snapshot: str | None = Field(default=None, max_length=32)
    tax_rate: Decimal | None = Field(default=None, ge=0)
    order_discount_amount: Decimal | None = Field(default=None, ge=0)
    shipping_amount: Decimal | None = Field(default=None, ge=0)
    lines: list["InvoiceLineUpdate"] | None = None


class InvoiceLineUpdate(BaseModel):
    id: int
    sku: str = Field(min_length=1, max_length=64)
    product_name: str = Field(min_length=1, max_length=255)
    uom: str = Field(min_length=1, max_length=32)
    quantity: int = Field(ge=1)
    unit_price: Decimal = Field(ge=0)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)


class InvoicePaymentCreate(BaseModel):
    paid_at: datetime | None = None
    amount: Decimal = Field(gt=0)
    method: str | None = Field(default=None, max_length=64)
    note: str | None = None


class InvoicePaymentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    invoice_id: int
    paid_at: datetime
    amount: Decimal
    method: str | None
    note: str | None
    created_by: str | None
    created_at: datetime
    updated_at: datetime


class InvoiceLineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    sku: str
    product_name: str
    uom: str
    quantity: int
    unit_price: Decimal
    discount_amount: Decimal
    line_total: Decimal


class InvoiceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sale_order_id: int
    merged_into_invoice_id: int | None = None
    invoice_number: str
    customer_name: str | None = None
    client_name_snapshot: str | None = None
    tele_snapshot: str | None = None
    address_snapshot: str | None = None
    city_snapshot: str | None = None
    zip_code_snapshot: str | None = None
    issued_at: datetime
    due_at: datetime | None
    status: InvoiceStatus
    currency: str
    tax_rate: Decimal
    subtotal_amount: Decimal
    order_discount_amount: Decimal
    discount_amount: Decimal
    shipping_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    amount_paid: Decimal
    balance_due: Decimal
    payment_status: InvoicePaymentStatus
    created_at: datetime
    updated_at: datetime
    lines: list[InvoiceLineRead]
    payments: list[InvoicePaymentRead]


InvoiceUpdate.model_rebuild()
