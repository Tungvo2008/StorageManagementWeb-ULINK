from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, model_validator
from app.db.models import CargoBatchStatus, CargoBoxType


class CargoBillBase(BaseModel):
    invoice_no: str = ""
    bill_date: Optional[datetime] = None
    packed_date: Optional[datetime] = None
    billing_type: str = "MARKET"  # MARKET, DIRECT, SELF
    shipper_name: str = ""
    shipper_phone: str = ""
    shipper_address: str = ""
    consignee_name: str
    consignee_phone: str = ""
    consignee_address: str = ""
    weight_lbs: Decimal = Decimal("0")
    declared_value: Decimal = Decimal("0")
    commodities: str = ""
    rate_per_lb: Decimal = Decimal("0")
    extra_fee: Decimal = Decimal("0")
    total_amount: Decimal = Decimal("0")
    bill_image_url: Optional[str] = None
    market_name: str = "World Market"
    is_paid: bool = False
    cali_tracking_code: Optional[str] = None
    cali_weight_lbs: Optional[Decimal] = None
    cali_amount: Optional[Decimal] = None
    reconcile_is_hub_box: Optional[bool] = False
    sub_recipients: Optional[List[str]] = None
    status: str = "PENDING"
    hub_consignee_name: Optional[str] = None
    is_hub_item: bool = False
    notes: Optional[str] = None
    is_hub: bool = False
    hub_consignee_name: Optional[str] = None


class CargoBillCreate(CargoBillBase):
    batch_id: int
    box_id: Optional[int] = None

    @model_validator(mode="after")
    def validate_strict_bill(self) -> "CargoBillCreate":
        # 1. Bắt buộc thông tin người nhận
        if not self.consignee_name or not self.consignee_name.strip():
            raise ValueError("Bắt buộc phải có Tên người nhận (consignee_name)")
        if not self.consignee_phone or not self.consignee_phone.strip():
            raise ValueError("Bắt buộc phải có Số điện thoại người nhận (consignee_phone)")
        if not self.consignee_address or not self.consignee_address.strip():
            raise ValueError("Bắt buộc phải có Địa chỉ người nhận tại VN (consignee_address)")

        # 2. Bắt buộc cân nặng > 0
        if self.weight_lbs is None or self.weight_lbs <= Decimal("0"):
            raise ValueError("Cân nặng (weight_lbs) bắt buộc phải lớn hơn 0")

        # 3. Ngày đóng hàng mặc định hiện tại nếu chưa có
        if not self.packed_date:
            self.packed_date = datetime.now(timezone.utc)

        # 4. Ràng buộc theo billing_type
        b_type = (self.billing_type or "MARKET").upper().strip()
        if b_type not in ("MARKET", "DIRECT", "SELF"):
            raise ValueError("Loại bill (billing_type) phải là MARKET (Chợ), DIRECT (Khách ngoài) hoặc SELF (Tự gửi)")
        self.billing_type = b_type

        if b_type == "DIRECT":
            if not self.shipper_name or not self.shipper_name.strip():
                raise ValueError("Đơn khách ngoài (DIRECT) bắt buộc phải có Tên người gửi (shipper_name) để xuất bill thu tiền")

            if self.total_amount <= Decimal("0") and (self.rate_per_lb is None or self.rate_per_lb <= Decimal("0")):
                raise ValueError("Đơn khách ngoài (DIRECT) bắt buộc phải có cước vận chuyển (rate_per_lb hoặc total_amount > 0)")
        elif b_type == "SELF":
            self.total_amount = Decimal("0")
            self.rate_per_lb = Decimal("0")
            self.extra_fee = Decimal("0")
        elif b_type == "MARKET":
            if not self.bill_image_url and not self.invoice_no:
                raise ValueError("Đơn hàng Chợ (MARKET) bắt buộc phải có ảnh chụp bill chợ hoặc số hóa đơn (invoice_no)")

        return self


class CargoBillUpdate(BaseModel):
    invoice_no: Optional[str] = None
    bill_date: Optional[datetime] = None
    packed_date: Optional[datetime] = None
    billing_type: Optional[str] = None
    shipper_name: Optional[str] = None
    shipper_phone: Optional[str] = None
    shipper_address: Optional[str] = None
    consignee_name: Optional[str] = None
    consignee_phone: Optional[str] = None
    consignee_address: Optional[str] = None
    weight_lbs: Optional[Decimal] = None
    declared_value: Optional[Decimal] = None
    commodities: Optional[str] = None
    rate_per_lb: Optional[Decimal] = None
    extra_fee: Optional[Decimal] = None
    total_amount: Optional[Decimal] = None
    bill_image_url: Optional[str] = None
    box_id: Optional[int] = None
    is_paid: Optional[bool] = None
    cali_tracking_code: Optional[str] = None
    cali_weight_lbs: Optional[Decimal] = None
    cali_amount: Optional[Decimal] = None
    reconcile_status: Optional[str] = None
    notes: Optional[str] = None


class CargoBillRead(CargoBillBase):
    id: int
    batch_id: int
    box_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CargoBoxBase(BaseModel):
    box_code: str
    box_type: CargoBoxType = CargoBoxType.SINGLE
    label_text: str = ""
    box_image_url: Optional[str] = None
    weight_lbs: Optional[Decimal] = None
    is_hub: bool = False
    hub_consignee_name: Optional[str] = None
    notes: Optional[str] = None


class CargoBoxCreate(CargoBoxBase):
    batch_id: int


class CargoBoxUpdate(BaseModel):
    box_code: Optional[str] = None
    box_type: Optional[CargoBoxType] = None
    label_text: Optional[str] = None
    box_image_url: Optional[str] = None
    weight_lbs: Optional[Decimal] = None
    is_hub: Optional[bool] = None
    hub_consignee_name: Optional[str] = None
    notes: Optional[str] = None


class CargoBoxRead(CargoBoxBase):
    id: int
    batch_id: int
    created_at: datetime
    updated_at: datetime
    bills: List[CargoBillRead] = []
    model_config = ConfigDict(from_attributes=True)


class CargoBatchBase(BaseModel):
    batch_code: str
    ship_date: datetime
    market_name: str = "World Market"
    status: CargoBatchStatus = CargoBatchStatus.OPEN
    notes: Optional[str] = None


class CargoBatchCreate(BaseModel):
    batch_code: Optional[str] = None
    ship_date: Optional[datetime] = None
    market_name: str = "World Market"
    notes: Optional[str] = None


class CargoBatchUpdate(BaseModel):
    batch_code: Optional[str] = None
    ship_date: Optional[datetime] = None
    market_name: Optional[str] = None
    status: Optional[CargoBatchStatus] = None
    notes: Optional[str] = None


class CargoBatchRead(CargoBatchBase):
    id: int
    created_at: datetime
    updated_at: datetime
    box_count: int = 0
    bill_count: int = 0
    total_weight_lbs: Decimal = Decimal("0")
    total_amount: Decimal = Decimal("0")
    model_config = ConfigDict(from_attributes=True)


class CargoBatchDetail(CargoBatchBase):
    id: int
    created_at: datetime
    updated_at: datetime
    boxes: List[CargoBoxRead] = []
    unassigned_bills: List[CargoBillRead] = []
    model_config = ConfigDict(from_attributes=True)


class QuickEntryBillData(BaseModel):
    invoice_no: Optional[str] = ""
    bill_date: Optional[datetime] = None
    packed_date: Optional[datetime] = None
    billing_type: str = "MARKET"
    shipper_name: Optional[str] = ""
    shipper_phone: Optional[str] = ""
    shipper_address: Optional[str] = ""
    consignee_name: str
    consignee_phone: Optional[str] = ""
    consignee_address: Optional[str] = ""
    weight_lbs: Decimal = Decimal("0")
    declared_value: Decimal = Decimal("0")
    commodities: Optional[str] = ""
    rate_per_lb: Decimal = Decimal("0")
    extra_fee: Decimal = Decimal("0")
    total_amount: Decimal = Decimal("0")
    bill_image_url: Optional[str] = None
    market_name: Optional[str] = "World Market"
    notes: Optional[str] = None
    box_id: Optional[int] = None
    hub_consignee_name: Optional[str] = None
    is_hub_item: Optional[bool] = False


class QuickEntryLineItem(BaseModel):
    consignee_name: str
    consignee_phone: str = ""
    consignee_address: str = ""
    weight_lbs: Decimal = Decimal("0")
    billing_type: str = "MARKET"  # MARKET, DIRECT, SELF
    shipper_name: Optional[str] = ""
    shipper_phone: Optional[str] = ""
    rate_per_lb: Optional[Decimal] = Decimal("0")
    extra_fee: Optional[Decimal] = Decimal("0")
    total_amount: Optional[Decimal] = Decimal("0")
    commodities: Optional[str] = ""
    invoice_no: Optional[str] = ""
    bill_image_url: Optional[str] = None
    notes: Optional[str] = None


class QuickEntryBoxData(BaseModel):
    box_code: Optional[str] = None
    box_type: CargoBoxType = CargoBoxType.SINGLE
    label_text: str = ""
    box_image_url: Optional[str] = None
    weight_lbs: Optional[Decimal] = None
    is_hub: Optional[bool] = False
    hub_consignee_name: Optional[str] = None
    lines: Optional[List[QuickEntryLineItem]] = None
    notes: Optional[str] = None


class QuickEntryRequest(BaseModel):
    entry_type: str  # "BILL", "BOX", or "BOX_LINES"
    batch_date: Optional[str] = None  # YYYY-MM-DD
    market_name: Optional[str] = "World Market"
    bill: Optional[QuickEntryBillData] = None
    box: Optional[QuickEntryBoxData] = None


class CargoStatementItem(BaseModel):
    bill_id: int
    stt: int
    consignee_name: str
    ship_date: str
    weight_lbs: Decimal
    rate_per_lb: Decimal
    extra_fee: Decimal
    total_amount: Decimal


class CargoStatementCreate(BaseModel):
    market_name: str = "World Market"
    statement_date: Optional[datetime] = None
    bill_ids: List[int] = []
    notes: Optional[str] = None


class CargoStatementRead(BaseModel):
    id: int
    statement_code: str
    statement_date: datetime
    market_name: str
    total_weight_lbs: Decimal
    total_extra_fee: Decimal
    total_amount: Decimal
    is_paid: bool
    paid_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime
    bills: List[CargoBillRead] = []
    model_config = ConfigDict(from_attributes=True)


# ==================== CALI RECONCILIATION SCHEMAS ====================
class CaliReconcileItem(BaseModel):
    tracking_code: str  # e.g. TA0092
    consignee_name: str  # e.g. MY TRINH
    weight_lbs: Decimal  # e.g. 13.7
    amount: Decimal  # e.g. 42.47
    notes: Optional[str] = None


class CaliReconcileRequest(BaseModel):
    batch_id: Optional[int] = None
    batch_ids: Optional[List[int]] = None  # Đối soát đồng thời 4-5 đợt chưa đối soát
    items: List[CaliReconcileItem]
    auto_apply: bool = False  # Lưu mã TA và cân nặng Cali vào database nếu khớp


class CaliReconcileResultItem(BaseModel):
    cali_tracking: str
    cali_name: str
    cali_weight: Decimal
    cali_amount: Decimal
    matched_bill_id: Optional[int] = None
    warehouse_name: Optional[str] = None
    warehouse_weight: Optional[Decimal] = None
    warehouse_box: Optional[str] = None
    billing_type: Optional[str] = None
    weight_diff: Optional[Decimal] = None  # cali_weight - warehouse_weight
    is_hub_box: Optional[bool] = False
    sub_recipients: Optional[List[str]] = None
    status: str  # "MATCHED", "WEIGHT_DIFF", "MISSING_IN_WAREHOUSE"


class CaliReconcileResponse(BaseModel):
    total_cali_rows: int
    matched_rows: int
    weight_diff_rows: int
    missing_in_warehouse_rows: int
    warehouse_bills_unmatched: int
    total_cali_amount: Decimal
    total_warehouse_amount: Decimal
    details: List[CaliReconcileResultItem]
    unmatched_warehouse_bills: List[CargoBillRead] = []


# ==================== DASHBOARD SUMMARY SCHEMAS ====================
class DashboardKpis(BaseModel):
    total_batches: int = 0
    total_boxes: int = 0
    total_bills: int = 0
    total_weight_lbs: Decimal = Decimal("0")
    total_revenue: Decimal = Decimal("0")
    total_unpaid_balance: Decimal = Decimal("0")
    market_revenue: Decimal = Decimal("0")
    market_unpaid_balance: Decimal = Decimal("0")
    direct_revenue: Decimal = Decimal("0")
    direct_unpaid_balance: Decimal = Decimal("0")
    self_packages_count: int = 0
    self_total_weight_lbs: Decimal = Decimal("0")
    hub_boxes_count: int = 0


class DashboardMarketItem(BaseModel):
    market_name: str
    bill_count: int = 0
    total_weight_lbs: Decimal = Decimal("0")
    total_amount: Decimal = Decimal("0")
    paid_amount: Decimal = Decimal("0")
    balance: Decimal = Decimal("0")
    bills: List[CargoBillRead] = []


class DashboardDirectCustomer(BaseModel):
    shipper_name: str
    shipper_phone: str = ""
    bill_count: int = 0
    total_weight_lbs: Decimal = Decimal("0")
    total_amount: Decimal = Decimal("0")
    paid_amount: Decimal = Decimal("0")
    balance: Decimal = Decimal("0")
    bills: List[CargoBillRead] = []


class DashboardSelfItem(BaseModel):
    bill_id: int
    batch_id: int
    batch_code: str
    box_id: Optional[int] = None
    box_code: Optional[str] = None
    packed_date: Optional[datetime] = None
    consignee_name: str
    consignee_phone: str = ""
    consignee_address: str = ""
    commodities: str = ""
    weight_lbs: Decimal = Decimal("0")
    cali_tracking_code: Optional[str] = None
    cali_weight_lbs: Optional[Decimal] = None
    cali_amount: Optional[Decimal] = None
    notes: Optional[str] = None


class DashboardShipmentLogBox(BaseModel):
    id: int
    box_code: str
    box_type: str
    is_hub: bool = False
    hub_consignee_name: Optional[str] = None
    weight_lbs: Optional[Decimal] = None
    label_text: str = ""
    bills: List[CargoBillRead] = []


class DashboardShipmentLogBatch(BaseModel):
    id: int
    batch_code: str
    ship_date: datetime
    market_name: str
    status: str
    box_count: int = 0
    bill_count: int = 0
    total_weight_lbs: Decimal = Decimal("0")
    boxes: List[DashboardShipmentLogBox] = []


class TrustCargoDashboardSummary(BaseModel):
    kpis: DashboardKpis
    shipment_logs: List[DashboardShipmentLogBatch]
    market_billing: List[DashboardMarketItem]
    direct_billing: List[DashboardDirectCustomer]
    self_billing: List[DashboardSelfItem]
