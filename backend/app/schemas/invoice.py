from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.db.models import InvoiceStatus


class InvoiceCreateFromSale(BaseModel):
    due_days: int = Field(default=0, ge=0, le=365)


class InvoiceUpdate(BaseModel):
    invoice_number: str | None = Field(default=None, min_length=1, max_length=64)
    issued_at: datetime | None = None
    due_at: datetime | None = None
    status: InvoiceStatus | None = None


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
    invoice_number: str
    customer_name: str | None = None
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
    created_at: datetime
    updated_at: datetime
    lines: list[InvoiceLineRead]
