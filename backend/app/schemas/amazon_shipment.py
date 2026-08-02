from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


class AmazonWebProductRead(BaseModel):
    id: int
    sku: str
    name: str
    quantity_on_hand: int


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
