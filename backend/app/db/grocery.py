from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional, List

from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------------------
# GroceryRawMaterial schemas
# ---------------------------------------------------------------------------

class GroceryRawMaterialBase(BaseModel):
    sku_raw: str
    name: str
    unit: str = "kg"
    cost_per_unit: Decimal = Decimal("0")
    default_yield_per_unit: Optional[Decimal] = None
    low_stock_threshold: Decimal = Decimal("5")
    notes: Optional[str] = None
    is_active: bool = True


class GroceryRawMaterialCreate(GroceryRawMaterialBase):
    quantity_on_hand: Decimal = Decimal("0")


class GroceryRawMaterialUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    cost_per_unit: Optional[Decimal] = None
    default_yield_per_unit: Optional[Decimal] = None
    low_stock_threshold: Optional[Decimal] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class GroceryRawMaterialRead(GroceryRawMaterialBase):
    id: int
    quantity_on_hand: Decimal
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# GroceryRawReceipt schemas (nhập nguyên liệu xá)
# ---------------------------------------------------------------------------

class GroceryRawReceiptCreate(BaseModel):
    quantity: Decimal
    unit_cost: Decimal = Decimal("0")
    note: Optional[str] = None


class GroceryRawReceiptRead(BaseModel):
    id: int
    raw_material_id: int
    quantity: Decimal
    unit_cost: Decimal
    total_cost: Decimal
    received_at: datetime
    note: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# GroceryPackagingRun schemas (đóng gói)
# ---------------------------------------------------------------------------

class GroceryPackagingRunCreate(BaseModel):
    raw_material_id: int
    finished_product_id: int
    raw_qty_used: Decimal          # kg nguyên liệu tiêu thụ
    units_produced: int            # số hũ/gói thành phẩm
    packaged_at: Optional[datetime] = None
    note: Optional[str] = None


class GroceryPackagingRunRead(BaseModel):
    id: int
    raw_material_id: int
    raw_material_name: str
    raw_material_unit: str
    finished_product_id: int
    finished_product_name: str
    finished_product_sku: str
    raw_qty_used: Decimal
    units_produced: int
    yield_per_unit: Decimal
    packaged_at: datetime
    note: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

class GroceryDashboardItem(BaseModel):
    id: int
    name: str
    sku: str
    quantity_on_hand: Decimal
    unit: str
    low_stock_threshold: Decimal
    is_low: bool


class GroceryFinishedItem(BaseModel):
    id: int
    name: str
    sku: str
    quantity_on_hand: int
    unit_price: Decimal
    is_low: bool  # tồn < 10


class GroceryDashboardRead(BaseModel):
    low_raw_materials: List[GroceryDashboardItem]
    low_finished_products: List[GroceryFinishedItem]
    total_raw_materials: int
    total_finished_products: int
