from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


class AmazonWebProductRead(BaseModel):
    id: int
    sku: str
    name: str
    image_url: str | None
    quantity_on_hand: int
    is_sold_on_amazon: bool
    amazon_sku: str | None
    business_unit: str = "TOWEL"


class AmazonMappingUpsert(BaseModel):
    amazon_sku: str = Field(min_length=1, max_length=255)
    product_id: int | None = None
    asin: str | None = Field(default=None, max_length=32)
    fnsku: str | None = Field(default=None, max_length=32)
    title: str | None = None
    unit_weight_lb: Decimal | None = Field(default=None, ge=0, le=10000)


class AmazonMappingRead(BaseModel):
    id: int
    amazon_sku: str
    product_id: int | None
    product_sku: str | None
    product_name: str | None
    quantity_on_hand: int | None
    asin: str | None
    fnsku: str | None
    title: str | None
    unit_weight_lb: float | None


class AmazonCapacityRead(BaseModel):
    id: int
    mapping_id: int
    amazon_sku: str
    units_capacity: int


class AmazonBoxTypeUpsert(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    length_in: Decimal = Field(gt=0, le=1000)
    width_in: Decimal = Field(gt=0, le=1000)
    height_in: Decimal = Field(gt=0, le=1000)
    empty_weight_lb: Decimal = Field(default=Decimal("0"), ge=0, le=10000)
    max_weight_lb: Decimal | None = Field(default=None, gt=0, le=10000)
    is_active: bool = True


class AmazonBoxTypeRead(BaseModel):
    id: int
    name: str
    length_in: float
    width_in: float
    height_in: float
    empty_weight_lb: float
    max_weight_lb: float | None
    is_active: bool
    capacities: list[AmazonCapacityRead]


class AmazonCapacityUpsert(BaseModel):
    box_type_id: int
    mapping_id: int
    units_capacity: int = Field(ge=1, le=1000000)


class AmazonShipmentConfigRead(BaseModel):
    products: list[AmazonWebProductRead]
    mappings: list[AmazonMappingRead]
    box_types: list[AmazonBoxTypeRead]


class AmazonImportedBoxRead(BaseModel):
    number: int
    name: str | None
    weight_lb: float | None
    length_in: float | None
    width_in: float | None
    height_in: float | None


class AmazonImportedItemRead(BaseModel):
    amazon_sku: str
    title: str
    asin: str | None
    fnsku: str | None
    requested_quantity: int
    mapping: AmazonMappingRead | None


class AmazonCsvImportRead(BaseModel):
    pack_group_number: str
    workflow_name: str
    declared_sku_count: int
    declared_unit_count: int
    existing_box_count: int
    items: list[AmazonImportedItemRead]
    boxes: list[AmazonImportedBoxRead]
    warnings: list[str]


class AmazonOptimizeItemInput(BaseModel):
    amazon_sku: str = Field(min_length=1, max_length=255)
    requested_quantity: int = Field(ge=1, le=10000000)
    available_quantity: int = Field(ge=1, le=10000000)


class AmazonOptimizeRequest(BaseModel):
    items: list[AmazonOptimizeItemInput] = Field(min_length=1, max_length=500)
    box_type_ids: list[int] = Field(min_length=1, max_length=100)
    min_box_count: int = Field(default=5, ge=5, le=100)
    max_box_count: int = Field(default=20, ge=5, le=100)

    @model_validator(mode="after")
    def validate_box_range(self) -> "AmazonOptimizeRequest":
        if self.max_box_count < self.min_box_count:
            raise ValueError("max_box_count must be greater than or equal to min_box_count")
        return self


class AmazonPlanItemRead(BaseModel):
    amazon_sku: str
    title: str | None
    requested_quantity: int
    available_quantity: int
    per_box_quantity: int
    adjusted_quantity: int
    quantity_delta: int
    unit_weight_lb: float | None
    capacity_units: int
    capacity_fraction: float


class AmazonFeasibleBoxRead(BaseModel):
    id: int
    name: str
    length_in: float
    width_in: float
    height_in: float
    empty_weight_lb: float
    max_weight_lb: float | None
    capacity_utilization: float
    estimated_weight_lb: float | None


class AmazonOptimizePlanRead(BaseModel):
    key: str
    strategy: str
    box_count: int
    selected_box_type_id: int
    selected_box_type_name: str
    requested_unit_count: int
    adjusted_unit_count: int
    absolute_quantity_change: int
    units_per_box: int
    capacity_utilization: float
    estimated_weight_lb: float | None
    items: list[AmazonPlanItemRead]
    feasible_box_types: list[AmazonFeasibleBoxRead]
    warnings: list[str]


class AmazonOptimizeResponse(BaseModel):
    plans: list[AmazonOptimizePlanRead]
    warnings: list[str]


class AmazonExportItemInput(BaseModel):
    amazon_sku: str = Field(min_length=1, max_length=255)
    per_box_quantity: int = Field(ge=1, le=1000000)


class AmazonExportBoxInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    weight_lb: Decimal = Field(gt=0, le=10000)
    length_in: Decimal = Field(gt=0, le=1000)
    width_in: Decimal = Field(gt=0, le=1000)
    height_in: Decimal = Field(gt=0, le=1000)


class AmazonCsvExportRequest(BaseModel):
    source_csv: str = Field(min_length=1, max_length=10_000_000)
    items: list[AmazonExportItemInput] = Field(min_length=1, max_length=500)
    boxes: list[AmazonExportBoxInput] = Field(min_length=5, max_length=100)


class AmazonPackXlsxExportRequest(BaseModel):
    source_xlsx_base64: str = Field(min_length=1, max_length=20_000_000)
    items: list[AmazonExportItemInput] = Field(min_length=1, max_length=500)
    boxes: list[AmazonExportBoxInput] = Field(min_length=5, max_length=100)


class AmazonManifestItemInput(BaseModel):
    product_id: int = Field(gt=0)
    quantity: int = Field(ge=1, le=10_000_000)


class AmazonManifestExportRequest(BaseModel):
    items: list[AmazonManifestItemInput] = Field(min_length=1, max_length=500)


class AmazonFbaDispatchLine(BaseModel):
    amazon_sku: str | None = None
    sku: str | None = None
    product_id: int | None = None
    quantity: int = Field(gt=0, description="Quantity of units to dispatch")
    box_count: int | None = Field(default=None, description="Optional number of boxes")


class AmazonFbaDispatchRequest(BaseModel):
    shipment_id: str | None = Field(default=None, description="Amazon FBA Shipment ID or Name")
    issued_by: str | None = Field(default=None, description="Who packed/shipped the order")
    note: str | None = Field(default=None, description="Notes, tracking numbers, or carrier details")
    ignore_stock: bool = False
    lines: list[AmazonFbaDispatchLine] = Field(min_length=1)


class AmazonFbaDispatchResponse(BaseModel):
    issue_id: int
    issue_number: str
    issued_at: datetime
    purpose: str
    issued_to: str | None
    total_units: int
    note: str | None
    lines: list[dict]


# --- FBA Live Inventory & Smart Restock Schemas ---

class AmazonFbaItemStock(BaseModel):
    sku: str
    asin: str | None = None
    product_name: str | None = None
    condition: str | None = None
    total_quantity: int = 0
    fulfillable_quantity: int = 0
    inbound_quantity: int = 0
    reserved_quantity: int = 0
    ulink_product_id: int | None = None
    ulink_sku: str | None = None
    ulink_product_name: str | None = None
    ulink_stock: int = 0
    uom: str = "Dozen"
    uom_multiplier: int = 12
    ulink_stock_uom: int = 0
    image_url: str | None = None
    status: str = "HEALTHY"  # OUT_OF_STOCK, LOW_STOCK, HEALTHY
    is_mapped: bool = False


class AmazonFbaInventorySummary(BaseModel):
    total_items: int
    total_fulfillable: int
    total_inbound: int
    total_reserved: int
    low_stock_count: int
    out_of_stock_count: int
    healthy_count: int
    items: list[AmazonFbaItemStock]
    last_updated: datetime


class AmazonRestockSuggestionItem(BaseModel):
    amazon_sku: str
    asin: str | None = None
    ulink_product_id: int | None = None
    ulink_sku: str | None = None
    product_name: str
    image_url: str | None = None
    current_fba_fulfillable: int
    current_fba_inbound: int
    ulink_available_stock: int
    ulink_available_dozens: int = 0
    uom: str = "Dozen"
    uom_multiplier: int = 12
    box_type_id: int | None = None
    box_name: str | None = None
    units_per_box: int
    suggested_boxes: int
    total_units_to_pick: int
    total_pieces_to_pick: int = 0
    ai_reasoning: str
    can_fulfill: bool


class AmazonRestockSuggestionResponse(BaseModel):
    total_boxes: int
    total_units: int
    items: list[AmazonRestockSuggestionItem]
    warnings: list[str] = []

class AmazonRestockSuggestRequest(BaseModel):
    selected_skus: list[str] | None = None
    min_boxes: int = Field(default=5, ge=1, le=100)
    target_boxes_per_sku: int = Field(default=5, ge=1, le=100)

class AmazonShipmentProductTotal(BaseModel):
    amazon_sku: str
    ulink_sku: str | None = None
    product_name: str
    total_shipped: int
    fba_shipped: int = 0
    fbm_shipped: int = 0
    image_url: str | None = None

class AmazonShipmentBatchItem(BaseModel):
    amazon_sku: str
    ulink_sku: str | None = None
    product_name: str
    quantity: int

class AmazonShipmentBatch(BaseModel):
    date: str
    display_date: str
    shipments_count: int
    total_units: int
    issue_number: str | None = None
    issue_id: int | None = None
    is_synced: bool = True
    items: list[AmazonShipmentBatchItem]

class AmazonShipmentsHubResponse(BaseModel):
    total_units_all_time: int
    total_shipments_all_time: int
    total_batches_all_time: int
    fba_units_total: int = 0
    fbm_units_total: int = 0
    fbm_orders_total: int = 0
    combined_total_units: int = 0
    product_totals: list[AmazonShipmentProductTotal]
    batches: list[AmazonShipmentBatch]

class AmazonFbmItem(BaseModel):
    sku: str
    quantity: int
    title: str | None = None
    price: str | None = None
    dozens: int = 0
    pieces: int = 0
    ulink_sku: str | None = None
    ulink_product_name: str | None = None
    product_id: int | None = None

class AmazonFbmOrder(BaseModel):
    order_id: str
    purchase_date: str
    order_status: str
    recipient_name: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    order_total: str | None = None
    currency: str = "USD"
    items: list[AmazonFbmItem]
    issue_number: str | None = None
    issue_id: int | None = None
    is_synced: bool = True

class AmazonFbmOrdersResponse(BaseModel):
    total_orders: int
    shipped_orders_count: int
    unshipped_orders_count: int
    total_packs: int
    total_dozens: int
    total_pieces: int
    orders: list[AmazonFbmOrder]


class CreateFbaInboundLineInput(BaseModel):
    amazon_sku: str
    sku: str | None = None
    product_id: int | None = None
    box_count: int = Field(ge=1)
    units_per_box: int = Field(ge=1)
    quantity: int = Field(ge=1)

class CreateFbaInboundShipmentRequest(BaseModel):
    shipment_name: str | None = None
    source_address: dict | None = None
    create_sp_api_plan: bool = True
    manual_shipment_id: str | None = None
    issued_by: str | None = None
    note: str | None = None
    lines: list[CreateFbaInboundLineInput] = Field(min_length=1)

class CreateFbaInboundShipmentResponse(BaseModel):
    success: bool
    issue_id: int
    issue_number: str
    inbound_plan_id: str | None = None
    shipment_id: str | None = None
    total_boxes: int
    total_units: int
    total_pieces: int
    lines: list[dict]
