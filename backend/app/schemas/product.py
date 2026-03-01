from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ProductBase(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    image_url: str | None = Field(default=None, max_length=2048, description="Optional image URL")
    base_uom: str | None = Field(default=None, max_length=32, description="Base stock unit (vd: Pc)")
    category_id: int | None = None
    uom: str | None = Field(default=None, max_length=32, description="Unit of measurement (vd: Pc, Pcs, Dozen, Case)")
    uom_multiplier: int | None = Field(
        default=None,
        ge=1,
        le=1000000,
        description="Số base-units trên 1 đơn vị UOM (vd: Dozen = 12)",
    )
    cost_price: Decimal = Decimal("0")
    unit_price: Decimal = Decimal("0")
    currency: str | None = None
    is_active: bool = True


class ProductCreate(ProductBase):
    quantity_on_hand: int = 0


class ProductUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    image_url: str | None = Field(default=None, max_length=2048)
    base_uom: str | None = Field(default=None, max_length=32)
    category_id: int | None = None
    uom: str | None = Field(default=None, max_length=32)
    uom_multiplier: int | None = Field(default=None, ge=1, le=1000000)
    cost_price: Decimal | None = None
    unit_price: Decimal | None = None
    currency: str | None = None
    quantity_on_hand: int | None = None
    is_active: bool | None = None


class ProductRead(ProductBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int | None
    base_uom: str
    uom: str
    uom_multiplier: int
    currency: str
    quantity_on_hand: int
    created_at: datetime
    updated_at: datetime


class ProductImportResult(BaseModel):
    created: int
    updated: int
