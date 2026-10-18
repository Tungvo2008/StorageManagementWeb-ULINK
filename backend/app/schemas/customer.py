from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CustomerBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    city: str | None = None
    zip_code: str | None = None


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    city: str | None = None
    zip_code: str | None = None


class CustomerRead(CustomerBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime

from decimal import Decimal

class CustomerPriceItem(BaseModel):
    product_id: int
    sku: str
    product_name: str
    product_image_url: str | None = None
    category_name: str | None = None
    default_price: Decimal
    custom_price: Decimal | None = None
    effective_price: Decimal
    last_sold_at: datetime | None = None
    last_invoice_number: str | None = None
    notes: str | None = None

class CustomerPriceUpdate(BaseModel):
    product_id: int
    price: Decimal
    notes: str | None = None

class CustomerPriceBulkUpdate(BaseModel):
    prices: list[CustomerPriceUpdate]
