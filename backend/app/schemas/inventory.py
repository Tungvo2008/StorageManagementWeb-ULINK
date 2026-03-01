from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.db.models import StockMovementType


class LineUnit(str):
    BASE = "BASE"
    SALE = "SALE"


class StockMovementCreate(BaseModel):
    product_id: int
    movement_type: StockMovementType
    quantity_delta: int = Field(..., description="Signed delta: + tăng kho, - giảm kho, không được = 0")
    note: str | None = None


class StockMovementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    receipt_id: int | None = None
    issue_id: int | None = None
    sale_order_id: int | None = None
    movement_type: StockMovementType
    quantity_delta: int
    note: str | None
    created_at: datetime


class InventoryReceiptLineCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    unit: str | None = Field(default=None, description="BASE (stock unit) or SALE (product UOM)")
    unit_cost: Decimal = Decimal("0")
    note: str | None = None


class InventoryReceiptCreate(BaseModel):
    receipt_number: str | None = None
    received_at: datetime | None = None
    received_by: str | None = None
    note: str | None = None
    lines: list[InventoryReceiptLineCreate] = Field(min_length=1)


class InventoryReceiptLineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    sku: str
    product_name: str
    uom: str
    uom_multiplier: int
    quantity: int
    unit_cost: Decimal
    currency: str
    line_total: Decimal
    note: str | None


class InventoryReceiptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    receipt_number: str | None
    received_at: datetime
    received_by: str | None
    note: str | None
    created_at: datetime
    updated_at: datetime
    lines: list[InventoryReceiptLineRead]


class InventoryReceiptSummaryRead(BaseModel):
    product_id: int
    sku: str
    product_name: str
    category_id: int | None
    category_name: str | None
    base_uom: str
    uom: str
    uom_multiplier: int
    currency: str
    quantity_on_hand: int
    receipt_count: int
    line_count: int
    total_received_base_qty: int
    total_received_sale_qty: Decimal
    total_received_amount: Decimal
    last_received_at: datetime | None


class InventoryIssueLineCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    unit: str | None = Field(default=None, description="BASE (stock unit) or SALE (product UOM)")
    note: str | None = None


class InventoryIssueCreate(BaseModel):
    issue_number: str | None = None
    issued_at: datetime | None = None
    issued_by: str | None = None
    issued_to: str | None = None
    purpose: str = "OTHER"
    note: str | None = None
    sale_order_id: int | None = None
    lines: list[InventoryIssueLineCreate] = Field(min_length=1)


class InventoryIssueUpdate(BaseModel):
    issue_number: str | None = None
    issued_at: datetime | None = None
    issued_to: str | None = None
    purpose: str | None = None
    note: str | None = None
    lines: list[InventoryIssueLineCreate] | None = None


class InventoryIssueLineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    sku: str
    product_name: str
    uom: str
    uom_multiplier: int
    quantity: int
    note: str | None


class InventoryIssueRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    issue_number: str | None
    issued_at: datetime
    issued_by: str | None
    issued_to: str | None
    purpose: str
    note: str | None
    sale_order_id: int | None
    created_at: datetime
    updated_at: datetime
    lines: list[InventoryIssueLineRead]
