from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.db.models import SaleStatus


class SaleOrderLineCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    discount_amount: float | None = Field(default=0, ge=0, description="Line discount (amount)")


class SaleOrderCreate(BaseModel):
    customer_id: int | None = None
    status: SaleStatus = SaleStatus.CONFIRMED
    currency: str | None = None
    discount_amount: float | None = Field(default=0, ge=0)
    shipping_amount: float | None = Field(default=0, ge=0)
    tax_rate: float | None = Field(default=None, ge=0, le=1)
    lines: list[SaleOrderLineCreate] = Field(min_length=1)


class SaleOrderLineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    sku: str
    product_name: str
    quantity: int
    unit_price: Decimal
    discount_amount: Decimal
    line_total: Decimal


class SaleOrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_id: int | None
    status: SaleStatus
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
    lines: list[SaleOrderLineRead]
