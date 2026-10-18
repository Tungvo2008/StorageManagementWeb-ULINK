from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional, List

from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------------------
# GroceryInboundItem schemas
# ---------------------------------------------------------------------------

class GroceryInboundItemBase(BaseModel):
    item_name: str
    sku: str = ""
    uom: str = "kg"
    initial_quantity: Decimal = Decimal("0")
    cost_price: Decimal = Decimal("0")
    product_id: Optional[int] = None
    notes: Optional[str] = None


class GroceryInboundItemCreate(GroceryInboundItemBase):
    pass


class GroceryInboundItemRead(GroceryInboundItemBase):
    id: int
    batch_id: int
    repacked_quantity: Decimal
    remaining_quantity: Decimal
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# GroceryRepackLog schemas (Nhật ký đóng hũ)
# ---------------------------------------------------------------------------

class GroceryRepackLogCreate(BaseModel):
    inbound_item_id: int
    target_product_id: int
    source_qty_used: Decimal  # Số kg/thùng xá lấy ra
    target_units_produced: int  # Số hũ/gói thành phẩm đóng được
    repacked_at: Optional[datetime] = None
    note: Optional[str] = None


class GroceryRepackLogRead(BaseModel):
    id: int
    batch_id: int
    batch_code: str
    inbound_item_id: int
    inbound_item_name: str
    inbound_item_uom: str
    target_product_id: int
    target_product_name: str
    target_product_sku: str
    source_qty_used: Decimal
    target_units_produced: int
    yield_per_unit: Decimal
    repacked_at: datetime
    note: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# GroceryInboundBatch schemas (Đợt nhập hàng xá)
# ---------------------------------------------------------------------------

class GroceryInboundBatchBase(BaseModel):
    batch_code: str
    received_at: Optional[datetime] = None
    supplier: Optional[str] = None
    notes: Optional[str] = None
    status: str = "OPEN"


class GroceryInboundBatchCreate(BaseModel):
    batch_code: Optional[str] = None
    received_at: Optional[datetime] = None
    supplier: Optional[str] = None
    notes: Optional[str] = None
    items: List[GroceryInboundItemCreate] = []


class GroceryInboundBatchRead(GroceryInboundBatchBase):
    id: int
    item_count: int = 0
    total_initial_qty: Decimal = Decimal("0")
    total_repacked_qty: Decimal = Decimal("0")
    total_remaining_qty: Decimal = Decimal("0")
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class GroceryInboundBatchDetail(GroceryInboundBatchBase):
    id: int
    item_count: int = 0
    total_initial_qty: Decimal = Decimal("0")
    total_repacked_qty: Decimal = Decimal("0")
    total_remaining_qty: Decimal = Decimal("0")
    created_at: datetime
    updated_at: datetime
    items: List[GroceryInboundItemRead] = []
    repack_logs: List[GroceryRepackLogRead] = []
    model_config = ConfigDict(from_attributes=True)
