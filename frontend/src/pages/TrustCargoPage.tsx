import { useEffect, useState, useMemo } from "react";
import { apiJson, apiUpload, assetUrl, downloadFile } from "../api/client";

interface CargoBill {
  id: number;
  batch_id: number;
  box_id?: number | null;
  invoice_no: string;
  bill_date: string;
  packed_date?: string | null;
  billing_type?: "MARKET" | "DIRECT" | "SELF" | string;
  shipper_name: string;
  shipper_phone: string;
  shipper_address: string;
  consignee_name: string;
  consignee_phone: string;
  consignee_address: string;
  weight_lbs: number | string;
  declared_value: number | string;
  commodities: string;
  rate_per_lb: number | string;
  extra_fee: number | string;
  total_amount: number | string;
  bill_image_url?: string | null;
  market_name: string;
  is_paid: boolean;
  cali_tracking_code?: string | null;
  cali_weight_lbs?: number | string | null;
  cali_amount?: number | string | null;
  is_hub_item?: boolean;
  hub_consignee_name?: string | null;
  notes?: string | null;
  statement_id?: number | null;
}

interface CargoBox {
  id: number;
  batch_id: number;
  box_code: string;
  box_type: "SINGLE" | "GROUPED";
  label_text: string;
  box_image_url?: string | null;
  weight_lbs?: number | string | null;
  is_hub?: boolean;
  hub_consignee_name?: string | null;
  notes?: string | null;
  bills: CargoBill[];
}

interface CargoBatch {
  id: number;
  batch_code: string;
  ship_date: string;
  market_name: string;
  status: string;
  notes?: string | null;
  box_count: number;
  bill_count: number;
  total_weight_lbs: number | string;
  total_amount: number | string;
}

interface CargoBatchDetail extends CargoBatch {
  boxes: CargoBox[];
  unassigned_bills: CargoBill[];
}

interface StatementReportItem {
  stt: number;
  id: number;
  date: string;
  consignee_name: string;
  weight_lbs: number;
  rate_per_lb: number; // Đơn giá đã trừ 1
  original_rate: number;
  extra_fee: number;
  total_amount: number;
  market_name: string;
  bill_image_url?: string | null;
  is_billed: boolean;
  statement_id?: number | null;
}

interface StatementReportResponse {
  market_name: string;
  filter_mode: string;
  date_title: string;
  total_bills: number;
  total_weight_lbs: number;
  total_extra_fee: number;
  total_amount: number;
  bills: StatementReportItem[];
}

interface SavedStatement {
  id: number;
  statement_code: string;
  statement_date: string;
  market_name: string;
  total_weight_lbs: number;
  total_extra_fee: number;
  total_amount: number;
  is_paid: boolean;
  paid_at?: string | null;
  notes?: string | null;
  bills?: CargoBill[];
}

interface DashboardKpis {
  total_batches: number;
  total_boxes: number;
  total_bills: number;
  total_weight_lbs: number | string;
  total_revenue: number | string;
  total_unpaid_balance: number | string;
  market_revenue: number | string;
  market_unpaid_balance: number | string;
  direct_revenue: number | string;
  direct_unpaid_balance: number | string;
  self_packages_count: number;
  self_total_weight_lbs: number | string;
  hub_boxes_count: number;
}

interface DashboardShipmentLogBox {
  id: number;
  box_code: string;
  box_type: string;
  is_hub: boolean;
  hub_consignee_name?: string | null;
  weight_lbs?: number | string | null;
  label_text: string;
  bills: CargoBill[];
}

interface DashboardShipmentLogBatch {
  id: number;
  batch_code: string;
  ship_date: string;
  market_name: string;
  status: string;
  box_count: number;
  bill_count: number;
  total_weight_lbs: number | string;
  boxes: DashboardShipmentLogBox[];
}

interface DashboardMarketItem {
  market_name: string;
  bill_count: number;
  total_weight_lbs: number | string;
  total_amount: number | string;
  paid_amount: number | string;
  balance: number | string;
  bills: CargoBill[];
}

interface DashboardDirectCustomer {
  shipper_name: string;
  shipper_phone: string;
  bill_count: number;
  total_weight_lbs: number | string;
  total_amount: number | string;
  paid_amount: number | string;
  balance: number | string;
  bills: CargoBill[];
}

interface DashboardSelfItem {
  bill_id: number;
  batch_id: number;
  batch_code: string;
  box_id?: number | null;
  box_code?: string | null;
  packed_date?: string | null;
  consignee_name: string;
  consignee_phone: string;
  consignee_address: string;
  commodities: string;
  weight_lbs: number | string;
  cali_tracking_code?: string | null;
  cali_weight_lbs?: number | string | null;
  cali_amount?: number | string | null;
  notes?: string | null;
}

interface TrustCargoDashboardSummary {
  kpis: DashboardKpis;
  shipment_logs: DashboardShipmentLogBatch[];
  market_billing: DashboardMarketItem[];
  direct_billing: DashboardDirectCustomer[];
  self_billing: DashboardSelfItem[];
}


interface CaliReconcileItem {
  tracking_code: string;
  consignee_name: string;
  weight_lbs: number;
  amount: number;
  notes?: string;
}

interface CaliReconcileResultItem {
  cali_tracking: string;
  cali_name: string;
  cali_weight: number | string;
  cali_amount: number | string;
  matched_bill_id?: number | null;
  warehouse_name?: string | null;
  warehouse_weight?: number | string | null;
  warehouse_box?: string | null;
  billing_type?: string | null;
  weight_diff?: number | string | null;
  is_hub_box?: boolean;
  sub_recipients?: string[] | null;
  status: string;
}

interface CaliReconcileResponse {
  total_cali_rows: number;
  matched_rows: number;
  weight_diff_rows: number;
  missing_in_warehouse_rows: number;
  warehouse_bills_unmatched: number;
  total_cali_amount: string | number;
  total_warehouse_amount: string | number;
  details: CaliReconcileResultItem[];
  unmatched_warehouse_bills: CargoBill[];
}

export default function TrustCargoPage() {
  type TopTabType = "packing" | "fulfillment" | "logs" | "reconcile" | "billing";
  const [topTab, setTopTab] = useState<TopTabType>("packing");

  const [logReconcileSubTab, setLogReconcileSubTab] = useState<"logs" | "reconcile">("logs");
  const [billingSubTab, setBillingSubTab] = useState<"market" | "direct" | "self" | "statement_preview" | "saved_history">("market");

  // Reconcile Cali state
  const [reconcileBatchId, setReconcileBatchId] = useState<number | null>(null);
  const [reconcileTextInput, setReconcileTextInput] = useState<string>("TA1001, Nguyễn Thị Hoa, 15.5, 38.75");
  const [reconcileAutoApply, setReconcileAutoApply] = useState(false);
  const [reconcileResults, setReconcileResults] = useState<CaliReconcileResponse | null>(null);
  const [reconcileLoading, setReconcileLoading] = useState(false);

  const handleRunReconcile = async () => {
    try {
      setReconcileLoading(true);
      const rawLines = reconcileTextInput.split("\n").map((l) => l.trim()).filter(Boolean);
      const items: CaliReconcileItem[] = rawLines.map((line) => {
        const parts = line.split(/[,	]+/).map((p) => p.trim());
        return {
          tracking_code: parts[0] || "",
          consignee_name: parts[1] || "",
          weight_lbs: parseFloat(parts[2]) || 0,
          amount: parseFloat(parts[3]) || 0,
        };
      }).filter((it) => it.tracking_code && it.consignee_name);

      if (items.length === 0) {
        alert("Vui lòng nhập ít nhất 1 dòng hóa đơn Cali (định dạng: MãTracking, TênKhách, CânLbs, Tiền)");
        return;
      }

      const payload = {
        batch_id: reconcileBatchId || undefined,
        items: items,
        auto_apply: reconcileAutoApply,
      };

      const res = await apiJson<CaliReconcileResponse>("/api/v1/trust-cargo/reconcile-cali", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setReconcileResults(res);
    } catch (err: any) {
      alert("Lỗi đối soát: " + (err.message || String(err)));
    } finally {
      setReconcileLoading(false);
    }
  };

  // Dashboard & Billing state
  const [dashboardData, setDashboardData] = useState<TrustCargoDashboardSummary | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [selectedLogBatchId, setSelectedLogBatchId] = useState<number | null>(null);
  const [expandedBoxIds, setExpandedBoxIds] = useState<Record<number, boolean>>({});
  const [billingMarketDetail, setBillingMarketDetail] = useState<string | null>("World Market");
  const [billingDirectShipperDetail, setBillingDirectShipperDetail] = useState<string | null>(null);

  const fetchDashboard = async () => {
    try {
      setLoadingDashboard(true);
      const res = await apiJson<TrustCargoDashboardSummary>("/api/v1/trust-cargo/dashboard-summary");
      setDashboardData(res);
      if (res.shipment_logs && res.shipment_logs.length > 0 && selectedLogBatchId === null) {
        setSelectedLogBatchId(res.shipment_logs[0].id);
      }
    } catch (err: any) {
      console.error("Lỗi tải dữ liệu dashboard:", err);
    } finally {
      setLoadingDashboard(false);
    }
  };

  useEffect(() => {
    if (topTab === "logs" || topTab === "reconcile" || topTab === "billing") {
      void fetchDashboard();
    }
  }, [topTab]);

  const toggleBillPaid = async (billId: number, currentPaid: boolean) => {
    try {
      await apiJson(`/api/v1/trust-cargo/bills/${billId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_paid: !currentPaid }),
      });
      await fetchDashboard();
    } catch (err: any) {
      alert("Lỗi cập nhật thu tiền: " + (err?.message || err));
    }
  };

  // Packing Tab state
  const [batches, setBatches] = useState<CargoBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [batchDetail, setBatchDetail] = useState<CargoBatchDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Statement Preview Tab state
  const [statementFilterMode, setStatementFilterMode] = useState<"UNBILLED" | "ALL">("UNBILLED");
  const [statementMarketFilter, setStatementMarketFilter] = useState("");
  const [statementData, setStatementData] = useState<StatementReportResponse | null>(null);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingSavedPdf, setDownloadingSavedPdf] = useState(false);

  const handleDownloadStatementPdf = async () => {
    try {
      setDownloadingPdf(true);
      let url = `/api/v1/trust-cargo/reports/market-statement/export-pdf?filter_mode=${statementFilterMode}`;
      if (statementMarketFilter.trim()) {
        url += `&market_name=${encodeURIComponent(statementMarketFilter.trim())}`;
      }
      const safeMarket = (statementData?.market_name || "World_Market").replace(/\s+/g, "_");
      await downloadFile(url, `Bill_Van_Chuyen_${safeMarket}.pdf`);
    } catch (err: any) {
      alert("Lỗi tải xuống PDF: " + err.message);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadSavedStatementPdf = async (stmtId: number) => {
    try {
      setDownloadingSavedPdf(true);
      const code = selectedSavedStatement?.statement_code || `statement_${stmtId}`;
      await downloadFile(`/api/v1/trust-cargo/statements/${stmtId}/export-pdf`, `Bill_${code}.pdf`);
    } catch (err: any) {
      alert("Lỗi tải xuống PDF: " + err.message);
    } finally {
      setDownloadingSavedPdf(false);
    }
  };

  // Saved Statements Tab state
  const [savedStatements, setSavedStatements] = useState<SavedStatement[]>([]);
  const [selectedSavedStatement, setSelectedSavedStatement] = useState<SavedStatement | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(false);

  // Modals
  const [showNewBatchModal, setShowNewBatchModal] = useState(false);
  const [newBatchMarket, setNewBatchMarket] = useState("Chợ Việt St. Louis");
  const [newBatchDate, setNewBatchDate] = useState(new Date().toISOString().split("T")[0]);
  const [newBatchNotes, setNewBatchNotes] = useState("");

  // Pirate Ship Labels Modal
  const [showPirateShipModal, setShowPirateShipModal] = useState(false);
  const [psBatchId, setPsBatchId] = useState<number | null>(null);
  const [psBatchCode, setPsBatchCode] = useState<string>("");
  const [psBoxCount, setPsBoxCount] = useState(5);
  const [psWeightLbs, setPsWeightLbs] = useState(8.0);
  const [psPrefix, setPsPrefix] = useState("TC");

  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);

  const handleDownloadPirateShip = async (format: "xlsx" | "csv") => {
    try {
      setDownloadingFormat(format);
      const batchParam = psBatchId ? `&batch_id=${psBatchId}` : "";
      const url = `/api/v1/trust-cargo/export-shipping-labels?box_count=${psBoxCount}&weight_lbs=${psWeightLbs}&prefix=${encodeURIComponent(psPrefix)}&format=${format}${batchParam}`;
      const filename = psBatchCode
        ? `pirateship-${psBatchCode}-${psBoxCount}boxes.${format}`
        : `pirateship-trustcargo-${psBoxCount}boxes.${format}`;
      await downloadFile(url, filename);
    } catch (err) {
      alert("Lỗi tải file: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDownloadingFormat(null);
    }
  };

  const [showNewBoxModal, setShowNewBoxModal] = useState(false);
  const [newBoxCode, setNewBoxCode] = useState("");
  const [newBoxLabel, setNewBoxLabel] = useState("");
  const [newBoxIsHub, setNewBoxIsHub] = useState(false);
  const [newBoxHubConsignee, setNewBoxHubConsignee] = useState("");
  const [newBoxFile, setNewBoxFile] = useState<File | null>(null);

  const [showNewBillModal, setShowNewBillModal] = useState(false);
  const [newBillType, setNewBillType] = useState<"MARKET" | "DIRECT" | "SELF">("MARKET");
  const [newBillShipper, setNewBillShipper] = useState("");
  const [newBillConsignee, setNewBillConsignee] = useState("");
  const [newBillPhone, setNewBillPhone] = useState("");
  const [newBillAddress, setNewBillAddress] = useState("");
  const [newBillWeight, setNewBillWeight] = useState("10");
  const [newBillRate, setNewBillRate] = useState("6"); // Giá trên bill khách (ví dụ $6 -> tính cho chợ là $5)
  const [newBillExtra, setNewBillExtra] = useState("0");
  const [newBillTotal, setNewBillTotal] = useState("50");
  const [newBillCommodities, setNewBillCommodities] = useState("");
  const [newBillTargetBoxId, setNewBillTargetBoxId] = useState<string>("");
  const [newBillFile, setNewBillFile] = useState<File | null>(null);

  // Photo viewer modal
  const [viewImageUrl, setViewImageUrl] = useState<string | null>(null);
  const [viewImageTitle, setViewImageTitle] = useState<string>("");

  // Load batches
  const loadBatches = async () => {
    try {
      setLoading(true);
      const data = await apiJson<CargoBatch[]>("/api/v1/trust-cargo/batches");
      setBatches(data);
      if (data.length > 0) {
        if (!selectedBatchId || !data.some((b) => b.id === selectedBatchId)) {
          setSelectedBatchId(data[0].id);
        }
      } else {
        setSelectedBatchId(null);
        setBatchDetail(null);
      }
    } catch (err) {
      console.error("Lỗi tải danh sách đợt đóng hàng:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBatches();
  }, []);

  // Load batch detail
  const loadBatchDetail = async (id: number) => {
    try {
      setLoading(true);
      const data = await apiJson<CargoBatchDetail>(`/api/v1/trust-cargo/batches/${id}`);
      setBatchDetail(data);
    } catch (err) {
      console.error("Lỗi tải chi tiết đợt:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedBatchId) {
      loadBatchDetail(selectedBatchId);
    }
  }, [selectedBatchId]);

  // Load statement preview
  const loadStatementPreview = async () => {
    try {
      setLoadingStatement(true);
      let url = `/api/v1/trust-cargo/reports/market-statement?filter_mode=${statementFilterMode}`;
      if (statementMarketFilter.trim()) {
        url += `&market_name=${encodeURIComponent(statementMarketFilter.trim())}`;
      }
      const data = await apiJson<StatementReportResponse>(url);
      setStatementData(data);
    } catch (err) {
      console.error("Lỗi tính bảng kê:", err);
    } finally {
      setLoadingStatement(false);
    }
  };

  useEffect(() => {
    if (topTab === "billing" && billingSubTab === "statement_preview") {
      loadStatementPreview();
    }
  }, [topTab, billingSubTab, statementFilterMode, statementMarketFilter]);

  // Load saved statements
  const loadSavedStatements = async () => {
    try {
      setLoadingSaved(true);
      const data = await apiJson<SavedStatement[]>("/api/v1/trust-cargo/statements");
      setSavedStatements(data);
      if (data.length > 0 && !selectedSavedStatement) {
        loadSavedStatementDetail(data[0].id);
      }
    } catch (err) {
      console.error("Lỗi tải danh sách bill cũ:", err);
    } finally {
      setLoadingSaved(false);
    }
  };

  const loadSavedStatementDetail = async (id: number) => {
    try {
      const data = await apiJson<SavedStatement>(`/api/v1/trust-cargo/statements/${id}`);
      setSelectedSavedStatement(data);
    } catch (err) {
      console.error("Lỗi tải chi tiết bảng kê:", err);
    }
  };

  useEffect(() => {
    if (topTab === "billing" && billingSubTab === "saved_history") {
      loadSavedStatements();
    }
  }, [topTab, billingSubTab]);

  // Toggle paid status
  const handleTogglePaid = async (stmtId: number) => {
    try {
      const res = await apiJson<{ is_paid: boolean; paid_at: string | null }>(
        `/api/v1/trust-cargo/statements/${stmtId}/toggle-paid`,
        { method: "PUT" }
      );
      setSavedStatements((prev) =>
        prev.map((s) => (s.id === stmtId ? { ...s, is_paid: res.is_paid, paid_at: res.paid_at } : s))
      );
      if (selectedSavedStatement && selectedSavedStatement.id === stmtId) {
        setSelectedSavedStatement((prev) =>
          prev ? { ...prev, is_paid: res.is_paid, paid_at: res.paid_at } : null
        );
      }
    } catch (err: any) {
      alert("Lỗi đổi trạng thái thanh toán: " + err.message);
    }
  };

  // Close & Save current Statement
  const handleCloseAndSaveStatement = async () => {
    if (!statementData || statementData.bills.length === 0) {
      alert("Không có bill nào trong đợt này để chốt!");
      return;
    }
    const market = statementData.market_name || "World Market";
    if (
      !window.confirm(
        `Chốt bảng kê gồm ${statementData.bills.length} bill cho "${market}" với tổng tiền $${statementData.total_amount}?\nSau khi chốt, các bill này sẽ được lưu vào Kho Bill Cũ.`
      )
    ) {
      return;
    }

    try {
      const bill_ids = statementData.bills.map((b) => b.id);
      const res = await apiJson<SavedStatement>("/api/v1/trust-cargo/statements", {
        method: "POST",
        body: JSON.stringify({
          market_name: market,
          bill_ids: bill_ids,
          notes: `Bảng kê xuất ngày ${new Date().toLocaleDateString("vi-VN")}`,
        }),
      });
      alert(`✅ Đã chốt và lưu thành công bảng kê: ${res.statement_code}!`);
      // Reload preview and switch to history
      await loadStatementPreview();
      setTopTab("billing"); setBillingSubTab("saved_history");
      setSelectedSavedStatement(res);
    } catch (err: any) {
      alert("Lỗi chốt bảng kê: " + err.message);
    }
  };

  // Create new batch
  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiJson<CargoBatch>("/api/v1/trust-cargo/batches", {
        method: "POST",
        body: JSON.stringify({
          ship_date: `${newBatchDate}T12:00:00Z`,
          market_name: newBatchMarket,
          notes: newBatchNotes,
        }),
      });
      setShowNewBatchModal(false);
      setNewBatchNotes("");
      await loadBatches();
      setSelectedBatchId(res.id);
    } catch (err: any) {
      alert("Lỗi tạo đợt đóng hàng: " + err.message);
    }
  };

  // Create new box
  const handleCreateBox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBatchId) return;
    try {
      let box_image_url = null;
      if (newBoxFile) {
        const formData = new FormData();
        formData.append("file", newBoxFile);
        const upRes = await apiUpload<{ url: string }>("/api/v1/trust-cargo/upload", formData);
        box_image_url = upRes.url;
      }

      await apiJson(`/api/v1/trust-cargo/batches/${selectedBatchId}/boxes`, {
        method: "POST",
        body: JSON.stringify({
          box_code: newBoxCode || `THUNG-${(batchDetail?.boxes.length || 0) + 1}`,
          label_text: newBoxLabel,
          box_type: newBoxIsHub ? "GROUPED" : "SINGLE",
          is_hub: newBoxIsHub,
          hub_consignee_name: newBoxIsHub ? newBoxHubConsignee : null,
          box_image_url: box_image_url,
        }),
      });

      setShowNewBoxModal(false);
      setNewBoxCode("");
      setNewBoxLabel("");
      setNewBoxIsHub(false);
      setNewBoxHubConsignee("");
      setNewBoxFile(null);
      loadBatchDetail(selectedBatchId);
      loadBatches();
    } catch (err: any) {
      alert("Lỗi tạo thùng: " + err.message);
    }
  };

  // Create new bill
  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBatchId) return;
    try {
      let bill_image_url = null;
      if (newBillFile) {
        const formData = new FormData();
        formData.append("file", newBillFile);
        const upRes = await apiUpload<{ url: string }>("/api/v1/trust-cargo/upload", formData);
        bill_image_url = upRes.url;
      }

      await apiJson("/api/v1/trust-cargo/bills", {
        method: "POST",
        body: JSON.stringify({
          batch_id: selectedBatchId,
          box_id: newBillTargetBoxId ? parseInt(newBillTargetBoxId) : null,
          shipper_name: newBillShipper,
          consignee_name: newBillConsignee,
          consignee_phone: newBillPhone,
          consignee_address: newBillAddress,
          weight_lbs: parseFloat(newBillWeight) || 0,
          rate_per_lb: parseFloat(newBillRate) || 0,
          extra_fee: parseFloat(newBillExtra) || 0,
          total_amount: parseFloat(newBillTotal) || 0,
          billing_type: newBillType,
          commodities: newBillCommodities,
          bill_image_url: bill_image_url,
          market_name: newBillType === "MARKET" ? "World Market" : "",
        }),
      });

      setShowNewBillModal(false);
      setNewBillType("MARKET");
      setNewBillShipper("");
      setNewBillConsignee("");
      setNewBillPhone("");
      setNewBillAddress("");
      setNewBillCommodities("");
      setNewBillFile(null);
      loadBatchDetail(selectedBatchId);
      loadBatches();
    } catch (err: any) {
      alert("Lỗi tạo bill: " + err.message);
    }
  };

  // Delete bill
  const handleDeleteBill = async (id: number) => {
    if (!window.confirm("Bạn có chắc muốn xoá bill này không?")) return;
    try {
      await apiJson(`/api/v1/trust-cargo/bills/${id}`, { method: "DELETE" });
      if (selectedBatchId) {
        loadBatchDetail(selectedBatchId);
        loadBatches();
      }
    } catch (err: any) {
      alert("Lỗi xoá bill: " + err.message);
    }
  };

  // Delete box
  const handleDeleteBox = async (id: number) => {
    if (!window.confirm("Xoá thùng này? (Các bill trong thùng sẽ chuyển thành chưa xếp thùng)")) return;
    try {
      await apiJson(`/api/v1/trust-cargo/boxes/${id}`, { method: "DELETE" });
      if (selectedBatchId) {
        loadBatchDetail(selectedBatchId);
        loadBatches();
      }
    } catch (err: any) {
      alert("Lỗi xoá thùng: " + err.message);
    }
  };

  // Filter boxes by search
  const filteredBoxes = useMemo(() => {
    if (!batchDetail) return [];
    if (!searchTerm.trim()) return batchDetail.boxes;
    const term = searchTerm.toLowerCase();

    return batchDetail.boxes.filter((box) => {
      if (box.box_code.toLowerCase().includes(term)) return true;
      if (box.label_text.toLowerCase().includes(term)) return true;
      return box.bills.some(
        (b) =>
          b.consignee_name.toLowerCase().includes(term) ||
          b.consignee_phone.includes(term) ||
          b.shipper_name.toLowerCase().includes(term) ||
          b.commodities.toLowerCase().includes(term)
      );
    });
  }, [batchDetail, searchTerm]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "--";
    try {
      const d = new Date(dateStr);
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    } catch {
      return dateStr;
    }
  };

  const formatDateMDY = (isoOrStr?: string) => {
    if (!isoOrStr) return "";
    try {
      const d = new Date(isoOrStr);
      if (isNaN(d.getTime())) return isoOrStr;
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    } catch {
      return isoOrStr;
    }
  };

  const formatNumberOrInt = (val: number | string | undefined | null) => {
    if (val === undefined || val === null || val === "") return "0";
    const num = Number(val);
    if (isNaN(num)) return String(val);
    if (Number.isInteger(num)) return num.toString();
    return Number(num.toFixed(2)).toString();
  };

  return (
    <div className="container" style={{ paddingBottom: 60 }}>
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          .bill-print-sheet,
          .bill-print-sheet * {
            visibility: visible !important;
          }
          .bill-print-sheet {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: #fff !important;
          }
          @page {
            size: portrait;
            margin: 15mm;
          }
          table {
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
          thead {
            display: table-header-group;
          }
          tfoot {
            display: table-footer-group;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>
      {/* Top Banner Navigation */}
      <div className="card" style={{ marginBottom: 16, borderLeft: "4px solid #1e3a8a", background: "white" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: "0 0 4px 0", color: "#1e3a8a", display: "flex", alignItems: "center", gap: 8 }}>
              📦 TRUST CARGO
            </h2>
            <div className="muted" style={{ fontSize: 14 }}>
              Nhật ký đóng thùng chống kiện cáo · Tự động tính tiền với Chợ: <strong>(Đơn giá - 1) + Lấy hết Phụ thu</strong>
            </div>
          </div>

          {/* 4 Step Workflow Buttons */}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              className={`btn ${topTab === "packing" ? "primary" : ""}`}
              onClick={() => setTopTab("packing")}
              style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}
            >
              <span>📦</span> 1. Đóng Hàng & Xếp Thùng
            </button>
            <button
              className={`btn ${topTab === "fulfillment" ? "primary" : ""}`}
              onClick={() => {
                setTopTab("fulfillment");
                if (!psBatchId && selectedBatchId) {
                  setPsBatchId(selectedBatchId);
                  if (batchDetail) {
                    setPsBatchCode(batchDetail.batch_code);
                    setPsBoxCount(batchDetail.boxes.length || 1);
                  }
                }
              }}
              style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}
            >
              <span>🏷️</span> 2. Nhãn Pirate Ship
            </button>
            <button
              className={`btn ${topTab === "logs" ? "primary" : ""}`}
              onClick={() => setTopTab("logs")}
              style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}
            >
              <span>📊</span> 3. Nhật Ký Gửi Hàng
            </button>
            <button
              className={`btn ${topTab === "reconcile" ? "primary" : ""}`}
              onClick={() => setTopTab("reconcile")}
              style={{
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: topTab === "reconcile" ? "#7c3aed" : "#f5f3ff",
                color: topTab === "reconcile" ? "#ffffff" : "#6d28d9",
                border: "1px solid #ddd6fe",
              }}
            >
              <span>⚖️</span> 4. Đối Soát Cali (Định Kỳ 4-5 Chuyến)
            </button>
            <button
              className={`btn ${topTab === "billing" && billingSubTab !== "statement_preview" ? "primary" : ""}`}
              onClick={() => {
                setTopTab("billing");
                if (billingSubTab === "statement_preview") setBillingSubTab("market");
              }}
              style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}
            >
              <span>💳</span> 5. Doanh Thu & Billing Công Nợ
            </button>
            <button
              className={`btn ${(topTab === "billing" && billingSubTab === "statement_preview") ? "primary" : ""}`}
              onClick={() => {
                setTopTab("billing");
                setBillingSubTab("statement_preview");
                loadStatementPreview();
              }}
              style={{
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: (topTab === "billing" && billingSubTab === "statement_preview") ? "#059669" : "#ecfdf5",
                color: (topTab === "billing" && billingSubTab === "statement_preview") ? "#ffffff" : "#047857",
                border: "1px solid #a7f3d0",
              }}
            >
              <span>📄</span> 6. Xuất Hóa Đơn Chợ
            </button>
          </div>
        </div>
      </div>

            {/* ========================================================================= */}
      {/* BƯỚC 1: ĐÓNG HÀNG & XẾP THÙNG                                                */}
      {/* ========================================================================= */}
      {topTab === "packing" && (
        <>
<div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
          {/* Left column: Date picker / Batches */}
          <div className="card" style={{ height: "fit-content", background: "white" }}>
            <div style={{ fontWeight: 600, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Lịch Đóng Hàng</span>
              <button
                className="btn primary"
                style={{ fontSize: 12, padding: "4px 8px" }}
                onClick={() => setShowNewBatchModal(true)}
              >
                + Ngày Mới
              </button>
            </div>

            {batches.length === 0 ? (
              <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                Chưa có ngày đóng hàng nào.
                <br />
                <button
                  className="btn primary"
                  style={{ marginTop: 10, fontSize: 12 }}
                  onClick={() => setShowNewBatchModal(true)}
                >
                  + Mở Ngày Đóng Mới
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {batches.map((b) => {
                  const active = b.id === selectedBatchId;
                  return (
                    <div
                      key={b.id}
                      onClick={() => setSelectedBatchId(b.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        cursor: "pointer",
                        background: active ? "#eff6ff" : "#f8fafc",
                        border: active ? "1.5px solid #3b82f6" : "1px solid #e2e8f0",
                        transition: "all 0.15s",
                      }}
                    >
                      <div style={{ fontWeight: 600, color: active ? "#1d4ed8" : "#1e293b" }}>
                        📅 {formatDate(b.ship_date)}
                      </div>
                      <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>
                        {b.market_name}
                      </div>
                      <div className="row" style={{ fontSize: 12, color: "#64748b", marginTop: 4, justifyContent: "space-between" }}>
                        <span>{b.box_count} thùng · {b.bill_count} bill</span>
                        <span style={{ fontWeight: 600, color: "#0f766e" }}>${b.total_amount}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right column: Content */}
          <div>
            {batchDetail ? (
              <>
                {/* Batch Header Info */}
                <div className="card" style={{ marginBottom: 16, background: "white" }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontSize: 20, fontWeight: 700, marginRight: 12 }}>
                        Ngày Đóng: {formatDate(batchDetail.ship_date)}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          padding: "3px 10px",
                          borderRadius: 999,
                          background: "#e0e7ff",
                          color: "#3730a3",
                          fontWeight: 600,
                        }}
                      >
                        {batchDetail.market_name}
                      </span>
                      <span style={{ marginLeft: 8, fontSize: 13, color: "#64748b" }}>
                        Mã: {batchDetail.batch_code}
                      </span>
                    </div>

                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn" onClick={() => setShowNewBoxModal(true)}>
                        + Thêm Thùng
                      </button>
                      <button className="btn" onClick={() => setShowNewBillModal(true)}>
                        + Thêm Bill Viết Tay
                      </button>
                      <button
                        className="btn"
                        style={{ background: "#0284c7", color: "white", borderColor: "#0284c7", fontWeight: 600 }}
                        onClick={() => {
                          setPsBatchId(batchDetail.id);
                          setPsBatchCode(batchDetail.batch_code);
                          setPsBoxCount(batchDetail.boxes.length || 1);
                          setShowPirateShipModal(true);
                        }}
                      >
                        🏷️ Xuất File Pirate Ship ({batchDetail.boxes.length} Thùng)
                      </button>
                      <button
                        className="btn"
                        style={{ background: "#059669", color: "white", borderColor: "#059669", fontWeight: 600 }}
                        onClick={() => {
                          setTopTab("billing");
                          setBillingSubTab("statement_preview");
                          loadStatementPreview();
                        }}
                      >
                        📄 Xuất Hóa Đơn Chợ
                      </button>
                    </div>
                  </div>

                  {/* Summary counters */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: 12,
                      marginTop: 14,
                      paddingTop: 12,
                      borderTop: "1px solid #e2e8f0",
                    }}
                  >
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 12, color: "#64748b" }}>TỔNG SỐ THÙNG</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "#1e293b" }}>
                        {batchDetail.boxes.length}
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 12, color: "#64748b" }}>TỔNG SỐ BILL</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "#1e293b" }}>
                        {batchDetail.boxes.flatMap((b) => b.bills).length + batchDetail.unassigned_bills.length}
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 12, color: "#64748b" }}>TỔNG CÂN NẶNG</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "#2563eb" }}>
                        {batchDetail.total_weight_lbs} lbs
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 12, color: "#64748b" }}>TỔNG TIỀN GỐC</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "#15803d" }}>
                        ${batchDetail.total_amount}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Search bar */}
                <div style={{ marginBottom: 16 }}>
                  <input
                    className="input"
                    style={{ width: "100%", maxWidth: 450 }}
                    placeholder="🔍 Tìm theo tên khách, SĐT, mã thùng, loại hàng..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>

                {/* Boxes List */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {filteredBoxes.map((box) => (
                    <div
                      key={box.id}
                      className="card"
                      style={{
                        border: "1px solid #cbd5e1",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                        borderRadius: 12,
                        background: "white",
                      }}
                    >
                      {/* Box Header */}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          borderBottom: "1px solid #f1f5f9",
                          paddingBottom: 10,
                          marginBottom: 12,
                        }}
                      >
                        <div className="row" style={{ gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 18, fontWeight: 700, color: "#1e3a8a" }}>
                            📦 {box.box_code}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              padding: "3px 10px",
                              borderRadius: 999,
                              background: box.box_type === "GROUPED" ? "#fef3c7" : "#dcfce7",
                              color: box.box_type === "GROUPED" ? "#b45309" : "#15803d",
                            }}
                          >
                            {box.box_type === "GROUPED" ? "👥 THÙNG GỘP (Nhiều Khách)" : "👤 THÙNG LẺ"}
                          </span>
                          <span style={{ fontSize: 14, color: "#334155" }}>
                            🏷️ Nhãn dán thùng: <strong>{box.label_text || "(Chưa có nhãn)"}</strong>
                          </span>
                        </div>

                        <div className="row" style={{ gap: 8 }}>
                          {box.box_image_url && (
                            <button
                              className="btn"
                              style={{ fontSize: 12, padding: "4px 8px" }}
                              onClick={() => {
                                setViewImageUrl(assetUrl(box.box_image_url));
                                setViewImageTitle(`Ảnh Thùng: ${box.box_code}`);
                              }}
                            >
                              📷 Xem Ảnh Thùng
                            </button>
                          )}
                          <button
                            className="btn"
                            style={{ fontSize: 12, padding: "4px 8px", color: "#ef4444" }}
                            onClick={() => handleDeleteBox(box.id)}
                          >
                            Xoá Thùng
                          </button>
                        </div>
                      </div>

                      {/* Box bills list */}
                      {box.bills.length === 0 ? (
                        <div className="muted" style={{ fontStyle: "italic", padding: "8px 0" }}>
                          Chưa có bill nào gắn vào thùng này. Zen Bot sẽ tự động match khi bạn gửi ảnh nhãn và bill!
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {box.bills.map((bill) => (
                            <div
                              key={bill.id}
                              style={{
                                background: "#f8fafc",
                                border: "1px solid #e2e8f0",
                                borderRadius: 8,
                                padding: 12,
                                display: "grid",
                                gridTemplateColumns: "1fr 140px 100px 70px",
                                alignItems: "center",
                                gap: 12,
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>
                                  👤 Người nhận: {bill.consignee_name} {bill.consignee_phone ? `(${bill.consignee_phone})` : ""}
                                </div>
                                <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>
                                  📍 {bill.consignee_address || "(Chưa có địa chỉ)"}
                                </div>
                                <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                  Người gửi: {bill.shipper_name || "--"} · Hàng: <strong>{bill.commodities || "--"}</strong>
                                </div>
                              </div>

                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: "#2563eb" }}>
                                  ⚖️ {bill.weight_lbs} lbs
                                </div>
                                <div style={{ fontSize: 12, color: "#64748b" }}>
                                  {bill.billing_type === "MARKET" ? (
                                    <>
                                      <span>${bill.rate_per_lb}/lb</span>
                                      <span style={{ color: "#0f766e", fontWeight: 600, marginLeft: 4 }}>
                                        (Chợ: ${Math.max(0, Number(bill.rate_per_lb) - 1)})
                                      </span>
                                    </>
                                  ) : bill.billing_type === "SELF" ? (
                                    <span>Tự gửi ($0)</span>
                                  ) : (
                                    <span>${bill.rate_per_lb}/lb</span>
                                  )}
                                </div>
                              </div>

                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontSize: 16, fontWeight: 700, color: "#16a34a" }}>
                                  ${bill.total_amount}
                                </div>
                                {Number(bill.extra_fee) > 0 && (
                                  <div style={{ fontSize: 11, color: "#b45309" }}>
                                    Phụ thu: ${bill.extra_fee}
                                  </div>
                                )}
                              </div>

                              <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                                {bill.bill_image_url ? (
                                  <button
                                    className="btn"
                                    style={{ padding: "4px 8px", fontSize: 13 }}
                                    title="Xem ảnh tờ bill"
                                    onClick={() => {
                                      setViewImageUrl(assetUrl(bill.bill_image_url));
                                      setViewImageTitle(`Bill: ${bill.consignee_name} (${bill.weight_lbs} lbs)`);
                                    }}
                                  >
                                    📄
                                  </button>
                                ) : (
                                  <span style={{ fontSize: 12, color: "#94a3b8" }}>No pic</span>
                                )}
                                <button
                                  className="btn"
                                  style={{ padding: "4px 6px", color: "#ef4444", fontSize: 12 }}
                                  title="Xoá bill"
                                  onClick={() => handleDeleteBill(bill.id)}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Unassigned bills */}
                  {batchDetail.unassigned_bills.length > 0 && (
                    <div className="card" style={{ background: "#fffbeb", borderColor: "#fde68a" }}>
                      <h4 style={{ margin: "0 0 10px 0", color: "#92400e" }}>
                        ⚠️ Bill chưa xếp vào thùng ({batchDetail.unassigned_bills.length} bill)
                      </h4>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {batchDetail.unassigned_bills.map((bill) => (
                          <div
                            key={bill.id}
                            style={{
                              background: "white",
                              border: "1px solid #fef3c7",
                              borderRadius: 8,
                              padding: 10,
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <div>
                              <strong>{bill.consignee_name}</strong> · {bill.consignee_phone} · {bill.weight_lbs} lbs · ${bill.total_amount}
                            </div>
                            <div className="row" style={{ gap: 6 }}>
                              {bill.bill_image_url && (
                                <button
                                  className="btn"
                                  style={{ padding: "3px 8px", fontSize: 12 }}
                                  onClick={() => {
                                    setViewImageUrl(assetUrl(bill.bill_image_url));
                                    setViewImageTitle(`Bill: ${bill.consignee_name}`);
                                  }}
                                >
                                  Xem Ảnh
                                </button>
                              )}
                              <button
                                className="btn"
                                style={{ padding: "3px 8px", fontSize: 12, color: "#ef4444" }}
                                onClick={() => handleDeleteBill(bill.id)}
                              >
                                Xoá
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="card muted" style={{ textAlign: "center", padding: 60, background: "white" }}>
                {loading ? "Đang tải dữ liệu..." : "Chưa có đợt đóng hàng nào được chọn. Hãy bấm '+ Ngày Mới' để bắt đầu ghi nhật ký!"}
              </div>
            )}
          </div>
        </div>

        </>
      )}
      {/* ========================================================================= */}
      {/* BƯỚC 2: NHÃN VẬN CHUYỂN PIRATE SHIP SANG KHO CALI                         */}
      {/* ========================================================================= */}
      {topTab === "fulfillment" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card" style={{ background: "white", borderLeft: "4px solid #0284c7" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: "0 0 4px 0", color: "#0369a1", display: "flex", alignItems: "center", gap: 8 }}>
                  🏷️ Bước 2: Tạo Nhãn Pirate Ship & Gửi Sang Cali
                </h3>
                <div className="muted" style={{ fontSize: 13 }}>
                  Xuất danh sách thùng thành file CSV/Excel định dạng chuẩn để nhập thẳng vào Pirate Ship mua nhãn UPS Ground / FedEx.
                </div>
              </div>

              {/* Batch Selector */}
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Chọn Đợt Hàng:</span>
                <select
                  className="input"
                  value={psBatchId || selectedBatchId || ""}
                  onChange={(e) => {
                    const id = e.target.value ? parseInt(e.target.value) : null;
                    setPsBatchId(id);
                    if (id) {
                      const found = batches.find((b) => b.id === id);
                      if (found) {
                        setPsBatchCode(found.batch_code);
                        setPsBoxCount(found.box_count || 1);
                      }
                    }
                  }}
                >
                  <option value="">-- Mặc định (Tự sinh) --</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {formatDate(b.ship_date)} ({b.batch_code}) - {b.box_count} thùng
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>
            {/* Left Column: Boxes list & readiness */}
            <div className="card" style={{ background: "white" }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12, color: "#1e293b", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>📦 Danh Sách Thùng Sẵn Sàng Vận Chuyển</span>
                <span style={{ fontSize: 13, color: "#0369a1", fontWeight: 700 }}>
                  {batchDetail?.boxes.length || psBoxCount} Thùng
                </span>
              </div>

              {batchDetail && batchDetail.boxes.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", textAlign: "left", color: "#475569", borderBottom: "2px solid #e2e8f0" }}>
                        <th style={{ padding: "8px 10px" }}>STT</th>
                        <th style={{ padding: "8px 10px" }}>Mã Thùng</th>
                        <th style={{ padding: "8px 10px" }}>Loại Thùng</th>
                        <th style={{ padding: "8px 10px" }}>Nhãn Ghi Trên Thùng</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>Số Bill</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Cân Nặng (lbs)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchDetail.boxes.map((bx, idx) => {
                        const isHub = bx.is_hub || Boolean(bx.hub_consignee_name);
                        return (
                          <tr key={bx.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "8px 10px", color: "#94a3b8" }}>#{idx + 1}</td>
                            <td style={{ padding: "8px 10px", fontWeight: 700, color: "#1e3a8a" }}>{bx.box_code}</td>
                            <td style={{ padding: "8px 10px" }}>
                              {isHub ? (
                                <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#f3e8ff", color: "#7e22ce" }}>
                                  🏢 Hub VN
                                </span>
                              ) : bx.bills.length >= 2 ? (
                                <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#fef3c7", color: "#b45309" }}>
                                  📦 Thùng Gộp
                                </span>
                              ) : (
                                <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#e0f2fe", color: "#0369a1" }}>
                                  📦 Thùng Đơn
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "8px 10px", color: "#334155" }}>
                              {bx.label_text || (isHub ? `Gom đầu cầu: ${bx.hub_consignee_name}` : "--")}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{bx.bills.length}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#0f766e" }}>
                              {bx.weight_lbs || (bx.bills.reduce((s, bi) => s + (Number(bi.weight_lbs) || 0), 0) || psWeightLbs)} lbs
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "30px 10px", color: "#94a3b8", fontSize: 13 }}>
                  Chưa chọn đợt hoặc đợt chưa có thùng nào. Bạn có thể xuất file theo cấu hình mẫu bên phải.
                </div>
              )}
            </div>

            {/* Right Column: Export form & Test labels */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Form export */}
              <div className="card" style={{ background: "white" }}>
                <h4 style={{ margin: "0 0 12px 0", color: "#1e293b", fontSize: 14 }}>⚙️ Tải File Mẫu Nhập Pirate Ship</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Số lượng thùng:</label>
                    <input
                      type="number"
                      className="input"
                      style={{ width: "100%" }}
                      value={psBoxCount}
                      onChange={(e) => setPsBoxCount(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Cân nặng mặc định (lbs/thùng):</label>
                    <input
                      type="number"
                      step="0.1"
                      className="input"
                      style={{ width: "100%" }}
                      value={psWeightLbs}
                      onChange={(e) => setPsWeightLbs(parseFloat(e.target.value) || 1)}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Tiền tố mã kiện (Prefix):</label>
                    <input
                      type="text"
                      className="input"
                      style={{ width: "100%" }}
                      value={psPrefix}
                      onChange={(e) => setPsPrefix(e.target.value)}
                    />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                    <button
                      className="btn primary"
                      style={{ padding: "8px 10px", fontSize: 13 }}
                      disabled={downloadingFormat !== null}
                      onClick={() => handleDownloadPirateShip("csv")}
                    >
                      {downloadingFormat === "csv" ? "Đang tải..." : "📥 Tải File CSV"}
                    </button>
                    <button
                      className="btn"
                      style={{ padding: "8px 10px", fontSize: 13 }}
                      disabled={downloadingFormat !== null}
                      onClick={() => handleDownloadPirateShip("xlsx")}
                    >
                      {downloadingFormat === "xlsx" ? "Đang tải..." : "📥 Tải Excel"}
                    </button>
                  </div>
                </div>
              </div>


            </div>
          </div>
        </div>
      )}
      {/* ========================================================================= */}
      {/* BƯỚC 3: NHẬT KÝ GỬI HÀNG (SHIPMENT LOGS)                                   */}
      {/* ========================================================================= */}
      {topTab === "logs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 16 }}>
          <div className="card" style={{ padding: "10px 16px", background: "white", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 style={{ margin: "0 0 2px 0", color: "#1e3a8a", fontSize: 16 }}>📜 Nhật Ký Gửi Hàng & Đợt Xuất Kho</h3>
              <div className="muted" style={{ fontSize: 13 }}>Xem lại toàn bộ lịch sử các đợt đã đóng hàng, danh sách thùng và chi tiết bill bên trong.</div>
            </div>
            <button
              className="btn"
              style={{ fontSize: 12, padding: "6px 12px", fontWeight: 600 }}
              onClick={() => void fetchDashboard()}
            >
              🔄 Làm Mới Dữ Liệu
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB: DASHBOARD & NHẬT KÝ GỬI HÀNG                                       */}
      {/* ========================================================================= */}
      {topTab === "logs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            <div className="card" style={{ background: "white", borderLeft: "4px solid #3b82f6" }}>
              <div className="muted" style={{ fontSize: 13, fontWeight: 500 }}>🚚 TỔNG CÂN NẶNG ĐÃ GỬI</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#1e3a8a", marginTop: 4 }}>
                {dashboardData?.kpis.total_weight_lbs || 0} <span style={{ fontSize: 15, fontWeight: 500 }}>lbs</span>
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                Gồm <strong>{dashboardData?.kpis.total_boxes || 0}</strong> thùng · <strong>{dashboardData?.kpis.total_bills || 0}</strong> bill hàng
              </div>
            </div>

            <div className="card" style={{ background: "white", borderLeft: "4px solid #059669" }}>
              <div className="muted" style={{ fontSize: 13, fontWeight: 500 }}>🏪 DOANH THU CHỢ</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#065f46", marginTop: 4 }}>
                ${dashboardData?.kpis.market_revenue || 0}
              </div>
              <div style={{ fontSize: 12, color: "#dc2626", marginTop: 4 }}>
                Chợ còn nợ: <strong>${dashboardData?.kpis.market_unpaid_balance || 0}</strong>
              </div>
            </div>

            <div className="card" style={{ background: "white", borderLeft: "4px solid #d97706" }}>
              <div className="muted" style={{ fontSize: 13, fontWeight: 500 }}>👤 DOANH THU KHÁCH NGOÀI</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#b45309", marginTop: 4 }}>
                ${dashboardData?.kpis.direct_revenue || 0}
              </div>
              <div style={{ fontSize: 12, color: "#dc2626", marginTop: 4 }}>
                Khách nợ: <strong>${dashboardData?.kpis.direct_unpaid_balance || 0}</strong>
              </div>
            </div>

            <div className="card" style={{ background: "white", borderLeft: "4px solid #dc2626" }}>
              <div className="muted" style={{ fontSize: 13, fontWeight: 500 }}>💰 TỔNG CÔNG NỢ CẦN THU</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: Number(dashboardData?.kpis.total_unpaid_balance || 0) > 0 ? "#dc2626" : "#16a34a", marginTop: 4 }}>
                ${dashboardData?.kpis.total_unpaid_balance || 0}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                Chợ + Khách ngoài chưa trả
              </div>
            </div>

            <div className="card" style={{ background: "white", borderLeft: "4px solid #8b5cf6" }}>
              <div className="muted" style={{ fontSize: 13, fontWeight: 500 }}>👑 THÙNG GOM ĐẦU CẦU (HUB)</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#6d28d9", marginTop: 4 }}>
                {dashboardData?.kpis.hub_boxes_count || 0} <span style={{ fontSize: 15, fontWeight: 500 }}>thùng</span>
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                Bypass mức 10lbs của Cali
              </div>
            </div>

            <div className="card" style={{ background: "white", borderLeft: "4px solid #6366f1" }}>
              <div className="muted" style={{ fontSize: 13, fontWeight: 500 }}>🏠 HÀNG CHÍNH MÌNH TỰ GỬI</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#4338ca", marginTop: 4 }}>
                {dashboardData?.kpis.self_packages_count || 0} <span style={{ fontSize: 15, fontWeight: 500 }}>kiện</span>
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                Tổng: <strong>{dashboardData?.kpis.self_total_weight_lbs || 0}</strong> lbs
              </div>
            </div>
          </div>

          {/* Nhật Ký Gửi Hàng (Shipment Log Timeline) */}
          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
            {/* Left: Danh sách đợt gửi */}
            <div className="card" style={{ height: "fit-content", background: "white" }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>📅 Các Đợt Gửi Hàng</span>
                <span style={{ background: "#e2e8f0", fontSize: 12, padding: "2px 8px", borderRadius: 12, color: "#334155" }}>
                  {dashboardData?.shipment_logs.length || 0} đợt
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {dashboardData?.shipment_logs.map((b) => {
                  const active = selectedLogBatchId === b.id;
                  return (
                    <div
                      key={b.id}
                      onClick={() => setSelectedLogBatchId(b.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: active ? "2px solid #2563eb" : "1px solid #e2e8f0",
                        background: active ? "#eff6ff" : "white",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ fontWeight: 600, color: active ? "#1d4ed8" : "#1e293b", fontSize: 14 }}>
                        {b.batch_code}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                        Ngày: {new Date(b.ship_date).toLocaleDateString("vi-VN")} · {b.market_name}
                      </div>
                      <div className="row" style={{ fontSize: 12, color: "#475569", marginTop: 6, justifyContent: "space-between" }}>
                        <span>📦 {b.box_count} thùng ({b.bill_count} bill)</span>
                        <span style={{ fontWeight: 600, color: "#0f766e" }}>{b.total_weight_lbs} lbs</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Chi tiết thùng và bill */}
            <div>
              {(() => {
                const currentBatch = dashboardData?.shipment_logs.find((b) => b.id === selectedLogBatchId);
                if (!currentBatch) {
                  return (
                    <div className="card" style={{ background: "white", textAlign: "center", padding: 40, color: "#64748b" }}>
                      Vui lòng chọn một đợt gửi hàng ở cột bên trái để xem nhật ký đóng thùng chi tiết.
                    </div>
                  );
                }

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {/* Batch Banner */}
                    <div className="card" style={{ background: "linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)", color: "white" }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, opacity: 0.85 }}>
                            NHẬT KÝ GỬI HÀNG ĐỢT NGÀY {new Date(currentBatch.ship_date).toLocaleDateString("vi-VN")}
                          </div>
                          <h3 style={{ margin: "4px 0 0 0", fontSize: 20 }}>{currentBatch.batch_code}</h3>
                          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
                            Điểm gom: {currentBatch.market_name} · Trạng thái: <strong>{currentBatch.status}</strong>
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 24, fontWeight: 700 }}>{currentBatch.total_weight_lbs} lbs</div>
                          <div style={{ fontSize: 13, opacity: 0.9 }}>
                            {currentBatch.box_count} thùng đã đóng · {currentBatch.bill_count} kiện khách
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Boxes List */}
                    {currentBatch.boxes.length === 0 ? (
                      <div className="card" style={{ background: "white", textAlign: "center", padding: 30, color: "#64748b" }}>
                        Chưa có thùng nào được đóng trong đợt này.
                      </div>
                    ) : (
                      currentBatch.boxes.map((bx) => {
                        const isExpanded = expandedBoxIds[bx.id] ?? true;
                        return (
                          <div key={bx.id} className="card" style={{ background: "white", padding: 0, overflow: "hidden", border: bx.is_hub ? "2px solid #8b5cf6" : "1px solid #e2e8f0" }}>
                            {/* Box Header */}
                            <div
                              onClick={() => setExpandedBoxIds((prev) => ({ ...prev, [bx.id]: !isExpanded }))}
                              style={{
                                padding: "12px 16px",
                                background: bx.is_hub ? "#f5f3ff" : "#f8fafc",
                                borderBottom: isExpanded ? "1px solid #e2e8f0" : "none",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                cursor: "pointer",
                              }}
                            >
                              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                                <span style={{ fontSize: 16, fontWeight: 700, color: bx.is_hub ? "#6d28d9" : "#1e293b" }}>
                                  📦 Thùng {bx.box_code}
                                </span>

                                {bx.is_hub ? (
                                  <span style={{ background: "#7c3aed", color: "white", fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 12 }}>
                                    🌟 THÙNG GOM ĐẦU CẦU VN (HUB)
                                  </span>
                                ) : bx.box_type === "GROUPED" ? (
                                  <span style={{ background: "#0284c7", color: "white", fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 10 }}>
                                    Thùng Gộp Chợ/Ngoài
                                  </span>
                                ) : (
                                  <span style={{ background: "#64748b", color: "white", fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 10 }}>
                                    Thùng Đơn
                                  </span>
                                )}

                                {bx.is_hub && bx.hub_consignee_name && (
                                  <span style={{ fontSize: 13, color: "#5b21b6", fontWeight: 500 }}>
                                    · Tem nhận đại diện VN: <strong>{bx.hub_consignee_name}</strong>
                                  </span>
                                )}
                              </div>

                              <div className="row" style={{ gap: 14, alignItems: "center" }}>
                                <span style={{ fontWeight: 600, fontSize: 14, color: "#0f766e" }}>
                                  {bx.weight_lbs ? `${bx.weight_lbs} lbs` : `${bx.bills.length} bills`}
                                </span>
                                <span style={{ fontSize: 12, color: "#64748b" }}>
                                  ({bx.bills.length} kiện bên trong)
                                </span>
                                <span style={{ fontSize: 13, color: "#64748b" }}>
                                  {isExpanded ? "▲ Thu gọn" : "▼ Xem bill"}
                                </span>
                              </div>
                            </div>

                            {/* Box Bills Table */}
                            {isExpanded && (
                              <div style={{ padding: "8px 16px 16px 16px" }}>
                                {bx.label_text && (
                                  <div style={{ fontSize: 12, color: "#64748b", margin: "6px 0 10px 0", fontStyle: "italic" }}>
                                    🏷️ Ghi chú tem ngoài: {bx.label_text}
                                  </div>
                                )}

                                {bx.bills.length === 0 ? (
                                  <div style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: "16px 0" }}>
                                    Chưa có bill nào được gán vào thùng này.
                                  </div>
                                ) : (
                                  <div style={{ overflowX: "auto" }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                      <thead>
                                        <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                                          <th style={{ padding: "8px 10px" }}>STT</th>
                                          <th style={{ padding: "8px 10px" }}>Phân Loại</th>
                                          <th style={{ padding: "8px 10px" }}>Mã Bill</th>
                                          <th style={{ padding: "8px 10px" }}>Người Gửi (Shipper)</th>
                                          <th style={{ padding: "8px 10px" }}>Người Nhận (Consignee)</th>
                                          <th style={{ padding: "8px 10px" }}>Địa Chỉ & SĐT VN</th>
                                          <th style={{ padding: "8px 10px" }}>Hàng Hoá</th>
                                          <th style={{ padding: "8px 10px", textAlign: "right" }}>Lbs</th>
                                          <th style={{ padding: "8px 10px", textAlign: "right" }}>Cước ($)</th>
                                          <th style={{ padding: "8px 10px", textAlign: "center" }}>Thu Tiền</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {bx.bills.map((bi, bIdx) => {
                                          const bType = (bi.billing_type || "MARKET").toUpperCase();
                                          return (
                                            <tr key={bi.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                              <td style={{ padding: "8px 10px", color: "#64748b" }}>{bIdx + 1}</td>
                                              <td style={{ padding: "8px 10px" }}>
                                                {bType === "MARKET" ? (
                                                  <span style={{ background: "#dbeafe", color: "#1e40af", padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                                                    CHỢ
                                                  </span>
                                                ) : bType === "DIRECT" ? (
                                                  <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                                                    KHÁCH NGOÀI
                                                  </span>
                                                ) : (
                                                  <span style={{ background: "#f3e8ff", color: "#6b21a8", padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                                                    TỰ GỬI
                                                  </span>
                                                )}
                                              </td>
                                              <td style={{ padding: "8px 10px", fontWeight: 600, color: "#1e293b" }}>
                                                {bi.invoice_no || `ID-${bi.id}`}
                                              </td>
                                              <td style={{ padding: "8px 10px", color: "#334155" }}>
                                                {bi.shipper_name || (bType === "MARKET" ? bi.market_name : "-")}
                                                {bi.shipper_phone && <div style={{ fontSize: 11, color: "#64748b" }}>📞 {bi.shipper_phone}</div>}
                                              </td>
                                              <td style={{ padding: "8px 10px", fontWeight: 600, color: "#0f172a" }}>
                                                {bi.consignee_name}
                                                {bi.consignee_phone && <div style={{ fontSize: 11, color: "#2563eb", fontWeight: 400 }}>📞 {bi.consignee_phone}</div>}
                                              </td>
                                              <td style={{ padding: "8px 10px", color: "#475569", maxWidth: 200, fontSize: 12 }}>
                                                {bi.consignee_address}
                                              </td>
                                              <td style={{ padding: "8px 10px", color: "#64748b", fontSize: 12 }}>
                                                {bi.commodities || "-"}
                                              </td>
                                              <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#0f766e" }}>
                                                {bi.weight_lbs}
                                              </td>
                                              <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: bType === "SELF" ? "#64748b" : "#b45309" }}>
                                                {bType === "SELF" ? "$0" : `$${bi.total_amount}`}
                                              </td>
                                              <td style={{ padding: "8px 10px", textAlign: "center" }}>
                                                {bType === "SELF" ? (
                                                  <span style={{ color: "#64748b", fontSize: 12 }}>Tự túc</span>
                                                ) : (
                                                  <button
                                                    onClick={() => toggleBillPaid(bi.id, bi.is_paid)}
                                                    style={{
                                                      padding: "3px 8px",
                                                      borderRadius: 12,
                                                      fontSize: 11,
                                                      fontWeight: 600,
                                                      border: "none",
                                                      cursor: "pointer",
                                                      background: bi.is_paid ? "#dcfce7" : "#fee2e2",
                                                      color: bi.is_paid ? "#15803d" : "#b91c1c",
                                                    }}
                                                    title="Bấm để đổi trạng thái đã thu / chưa thu"
                                                  >
                                                    {bi.is_paid ? "✅ Đã Thu" : "⏳ Chưa Thu"}
                                                  </button>
                                                )}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      
      {/* ========================================================================= */}
      {/* BƯỚC 4: ĐỐI SOÁT HÓA ĐƠN CALI (ĐỊNH KỲ 4 - 5 CHUYẾN)                      */}
      {/* ========================================================================= */}
      {topTab === "reconcile" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card" style={{ background: "white", borderTop: "4px solid #7c3aed" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: "0 0 4px 0", color: "#6d28d9" }}>⚖️ Đối Soát Cước Hóa Đơn Cali (Định Kỳ Gom 4 - 5 Chuyến)</h3>
                <div className="muted" style={{ fontSize: 13 }}>
                  Đầu cầu Cali thường gom 4 - 5 đợt ship mới xuất 1 bảng kê tổng cước. Hệ thống tự động so khớp chéo trên toàn bộ các đợt/bill đang chờ đối soát (PENDING) để kiểm tra lệch cân (lbs), lệch cước và đơn thiếu.
                </div>
              </div>

              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={reconcileAutoApply}
                    onChange={(e) => setReconcileAutoApply(e.target.checked)}
                  />
                  <span>Tự động cập nhật mã tracking Cali vào bill</span>
                </label>
                <button
                  className="btn primary"
                  style={{ padding: "6px 14px", fontWeight: 600 }}
                  disabled={reconcileLoading}
                  onClick={handleRunReconcile}
                >
                  {reconcileLoading ? "Đang Đối Soát..." : "🚀 Chạy Đối Soát"}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Dữ liệu hóa đơn Cali (Mỗi dòng 1 kiện: MãTracking, TênNgườiNhận, CânNặngLbs, TiềnCước):
              </label>
              <textarea
                className="input"
                rows={4}
                style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
                value={reconcileTextInput}
                onChange={(e) => setReconcileTextInput(e.target.value)}
                placeholder="Ví dụ:\nTA1001, Nguyễn Thị Hoa, 15.5, 38.75\nTA1002, Lê Thị Mai, 3.8, 9.50"
              />
            </div>
          </div>

          {/* Reconcile Results */}
          {reconcileResults && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Result KPIs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
                <div className="card" style={{ background: "white", textAlign: "center" }}>
                  <div className="muted" style={{ fontSize: 11 }}>TỔNG DÒNG CALI</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#1e3a8a" }}>{reconcileResults.total_cali_rows}</div>
                </div>
                <div className="card" style={{ background: "white", textAlign: "center" }}>
                  <div className="muted" style={{ fontSize: 11 }}>KHỚP CHUẨN (MATCHED)</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a" }}>{reconcileResults.matched_rows}</div>
                </div>
                <div className="card" style={{ background: "white", textAlign: "center" }}>
                  <div className="muted" style={{ fontSize: 11 }}>LỆCH CÂN NẶNG</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: reconcileResults.weight_diff_rows > 0 ? "#dc2626" : "#16a34a" }}>
                    {reconcileResults.weight_diff_rows}
                  </div>
                </div>
                <div className="card" style={{ background: "white", textAlign: "center" }}>
                  <div className="muted" style={{ fontSize: 11 }}>CHƯA VỀ / THIẾU Ở KHO</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: reconcileResults.missing_in_warehouse_rows > 0 ? "#dc2626" : "#475569" }}>
                    {reconcileResults.missing_in_warehouse_rows}
                  </div>
                </div>
                <div className="card" style={{ background: "white", textAlign: "center" }}>
                  <div className="muted" style={{ fontSize: 11 }}>TỔNG TIỀN CALI TÍNH</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#0f766e" }}>${reconcileResults.total_cali_amount}</div>
                </div>
              </div>

              {/* Details Comparison Table */}
              <div className="card" style={{ background: "white" }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: "#1e293b" }}>
                  📋 Bảng Chi Tiết So Sánh Cali vs Kho
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#475569" }}>
                        <th style={{ padding: "8px 10px" }}>Tracking Cali</th>
                        <th style={{ padding: "8px 10px" }}>Tên Cali Báo</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Lbs Cali</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Cước Cali</th>
                        <th style={{ padding: "8px 10px" }}>Đối Ứng Tại Kho</th>
                        <th style={{ padding: "8px 10px" }}>Thùng</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Lbs Kho</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Lệch Lbs</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>Trạng Thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconcileResults.details.map((it, idx) => {
                        const isHub = it.is_hub_box;
                        const isDiff = Number(it.weight_diff || 0) !== 0;
                        return (
                          <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9", background: isDiff ? "#fffbeb" : "white" }}>
                            <td style={{ padding: "8px 10px", fontWeight: 700, color: "#1e3a8a" }}>{it.cali_tracking}</td>
                            <td style={{ padding: "8px 10px", fontWeight: 600 }}>{it.cali_name}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{it.cali_weight}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>${it.cali_amount}</td>
                            <td style={{ padding: "8px 10px" }}>
                              {it.warehouse_name || <span style={{ color: "#dc2626" }}>Không tìm thấy bill</span>}
                              {isHub && <span style={{ marginLeft: 6, fontSize: 10, background: "#f3e8ff", color: "#7e22ce", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>HUB VN</span>}
                            </td>
                            <td style={{ padding: "8px 10px", color: "#64748b" }}>{it.warehouse_box || "--"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{it.warehouse_weight ?? "--"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: isDiff ? "#dc2626" : "#16a34a" }}>
                              {it.weight_diff ?? "--"}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <span style={{
                                padding: "2px 8px",
                                borderRadius: 999,
                                fontSize: 10,
                                fontWeight: 700,
                                background: it.status === "MATCHED" ? "#dcfce7" : it.status === "WEIGHT_DIFF" ? "#fef3c7" : "#fee2e2",
                                color: it.status === "MATCHED" ? "#15803d" : it.status === "WEIGHT_DIFF" ? "#b45309" : "#b91c1c",
                              }}>
                                {it.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Unmatched warehouse bills */}
              {reconcileResults.unmatched_warehouse_bills && reconcileResults.unmatched_warehouse_bills.length > 0 && (
                <div className="card" style={{ background: "white" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "#b45309" }}>
                    ⚠️ Các bill tại kho chưa thấy bên Cali tính cước ({reconcileResults.unmatched_warehouse_bills.length} bill):
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {reconcileResults.unmatched_warehouse_bills.map((bi) => (
                      <span key={bi.id} style={{ padding: "4px 10px", background: "#fef3c7", borderRadius: 6, fontSize: 12, color: "#92400e" }}>
                        {bi.invoice_no || `ID-${bi.id}`}: {bi.consignee_name} ({bi.weight_lbs} lbs)
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* BƯỚC 4: TÀI CHÍNH & BILLING CÔNG NỢ                                          */}
      {/* ========================================================================= */}
      {topTab === "billing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 16 }}>
          <div className="card" style={{ padding: "8px 12px", background: "white", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                className={`btn ${billingSubTab === "market" ? "primary" : ""}`}
                style={{ fontSize: 13, padding: "5px 12px", fontWeight: 600 }}
                onClick={() => setBillingSubTab("market")}
              >
                🏪 Chợ World Market
              </button>
              <button
                className={`btn ${billingSubTab === "direct" ? "primary" : ""}`}
                style={{ fontSize: 13, padding: "5px 12px", fontWeight: 600 }}
                onClick={() => setBillingSubTab("direct")}
              >
                👤 Khách Ngoài (Direct)
              </button>
              <button
                className={`btn ${billingSubTab === "self" ? "primary" : ""}`}
                style={{ fontSize: 13, padding: "5px 12px", fontWeight: 600 }}
                onClick={() => setBillingSubTab("self")}
              >
                🏠 Kiện Tự Gửi ({dashboardData?.kpis.self_packages_count || 0})
              </button>
              <button
                className={`btn ${billingSubTab === "statement_preview" ? "primary" : ""}`}
                style={{ fontSize: 13, padding: "5px 12px", fontWeight: 600 }}
                onClick={() => {
                  setBillingSubTab("statement_preview");
                  loadStatementPreview();
                }}
              >
                📋 Xuất Bảng Kê World Market
              </button>
              <button
                className={`btn ${billingSubTab === "saved_history" ? "primary" : ""}`}
                style={{ fontSize: 13, padding: "5px 12px", fontWeight: 600 }}
                onClick={() => {
                  setBillingSubTab("saved_history");
                  loadSavedStatements();
                }}
              >
                📂 Lịch Sử Bảng Kê Đã Chốt ({savedStatements.length})
              </button>
            </div>

            <button
              className="btn"
              style={{ fontSize: 12, padding: "4px 10px" }}
              onClick={() => void fetchDashboard()}
            >
              🔄 Cập Nhật Số Liệu
            </button>
          </div>
        </div>
      )}
      {/* Section 1: Hàng Chợ */}
      {topTab === "billing" && billingSubTab === "market" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Section 1: Hàng Chợ */}
          <div className="card" style={{ background: "white" }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: "0 0 4px 0", color: "#1e3a8a", display: "flex", alignItems: "center", gap: 8 }}>
                  🏪 Billing Hàng Chợ — World Market
                </h3>
                <div className="muted" style={{ fontSize: 13 }}>
                  Toàn bộ đơn hàng gửi từ Chợ World Market. Quy tắc tính tiền: <strong>Lbs × (Đơn giá trên bill - $1/lb) + Phụ thu (nếu có)</strong>.
                </div>
              </div>
              <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <div>
                  <span className="muted" style={{ fontSize: 13 }}>Tổng Chợ Nợ: </span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#dc2626" }}>
                    ${dashboardData?.kpis.market_unpaid_balance || 0}
                  </span>
                </div>
                <button
                  className="btn"
                  style={{
                    background: "#059669",
                    color: "white",
                    borderColor: "#059669",
                    fontWeight: 600,
                    fontSize: 13,
                    padding: "6px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  onClick={() => {
                    setBillingSubTab("statement_preview");
                    loadStatementPreview();
                  }}
                >
                  📄 Xuất Hóa Đơn / Bảng Kê Chợ
                </button>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", textAlign: "left", color: "#475569", borderBottom: "2px solid #e2e8f0" }}>
                    <th style={{ padding: "10px 12px" }}>Tên Chợ</th>
                    <th style={{ padding: "10px 12px", textAlign: "center" }}>Số Kiện</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Tổng Cân (lbs)</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Tổng Cước ($)</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Đã Thanh Toán ($)</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Công Nợ Cần Thu (Balance)</th>
                    <th style={{ padding: "10px 12px", textAlign: "center" }}>Chi Tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardData?.market_billing.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>
                        Chưa có dữ liệu bill chợ nào.
                      </td>
                    </tr>
                  ) : (
                    dashboardData?.market_billing.map((m) => {
                      const isDetailOpen = billingMarketDetail === m.market_name;
                      const hasDebt = Number(m.balance) > 0;
                      return (
                        <>
                          <tr key={m.market_name} style={{ borderBottom: "1px solid #f1f5f9", background: isDetailOpen ? "#eff6ff" : "white" }}>
                            <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1e293b" }}>
                              {m.market_name}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "center" }}>{m.bill_count}</td>
                            <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: "#0f766e" }}>
                              {m.total_weight_lbs}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>
                              ${m.total_amount}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right", color: "#16a34a" }}>
                              ${m.paid_amount}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: hasDebt ? "#dc2626" : "#16a34a" }}>
                              ${m.balance}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "center" }}>
                              <div className="row" style={{ gap: 6, justifyContent: "center" }}>
                                <button
                                  className="btn"
                                  style={{ fontSize: 12, padding: "3px 10px" }}
                                  onClick={() => setBillingMarketDetail(isDetailOpen ? null : m.market_name)}
                                >
                                  {isDetailOpen ? "Đóng" : "Xem Bill"}
                                </button>
                                <button
                                  className="btn"
                                  style={{ fontSize: 12, padding: "3px 10px", background: "#ecfdf5", color: "#047857", borderColor: "#a7f3d0", fontWeight: 600 }}
                                  onClick={() => {
                                    setStatementMarketFilter(m.market_name);
                                    setBillingSubTab("statement_preview");
                                    loadStatementPreview();
                                  }}
                                >
                                  📄 Xuất Hóa Đơn
                                </button>
                              </div>
                            </td>
                          </tr>

                          {isDetailOpen && (
                            <tr key={`${m.market_name}-sub`} style={{ background: "#f8fafc" }}>
                              <td colSpan={7} style={{ padding: "12px 16px" }}>
                                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "#1e40af" }}>
                                  Danh sách các bill thuộc {m.market_name}:
                                </div>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "white", borderRadius: 8 }}>
                                  <thead>
                                    <tr style={{ background: "#e2e8f0", textAlign: "left", color: "#334155" }}>
                                      <th style={{ padding: "6px 8px" }}>Mã Bill</th>
                                      <th style={{ padding: "6px 8px" }}>Người Nhận</th>
                                      <th style={{ padding: "6px 8px" }}>SĐT</th>
                                      <th style={{ padding: "6px 8px" }}>Hàng Hóa</th>
                                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Lbs</th>
                                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Đơn Giá Bill</th>
                                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Giá Chợ (-$1)</th>
                                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Phụ Thu</th>
                                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Thành Tiền Chợ ($)</th>
                                      <th style={{ padding: "6px 8px", textAlign: "center" }}>Trạng Thái</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {m.bills.map((bi) => {
                                      const rawRate = Number(bi.rate_per_lb || 0);
                                      const mRate = Math.max(0, rawRate - 1);
                                      const extra = Number(bi.extra_fee || 0);
                                      return (
                                        <tr key={bi.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                          <td style={{ padding: "6px 8px", fontWeight: 600 }}>{bi.invoice_no || `ID-${bi.id}`}</td>
                                          <td style={{ padding: "6px 8px", fontWeight: 600, color: "#0f172a" }}>{bi.consignee_name}</td>
                                          <td style={{ padding: "6px 8px", color: "#2563eb" }}>{bi.consignee_phone}</td>
                                          <td style={{ padding: "6px 8px", color: "#64748b" }}>{bi.commodities || "-"}</td>
                                          <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{bi.weight_lbs}</td>
                                          <td style={{ padding: "6px 8px", textAlign: "right", color: "#64748b" }}>${rawRate}/lb</td>
                                          <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#2563eb" }}>${mRate}/lb</td>
                                          <td style={{ padding: "6px 8px", textAlign: "right", color: extra > 0 ? "#b45309" : "#94a3b8" }}>{extra > 0 ? `$${extra}` : "-"}</td>
                                          <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: "#0f766e" }}>${bi.total_amount}</td>
                                          <td style={{ padding: "6px 8px", textAlign: "center" }}>
                                            <button
                                              onClick={() => toggleBillPaid(bi.id, bi.is_paid)}
                                              style={{
                                                padding: "2px 6px",
                                                borderRadius: 10,
                                                fontSize: 11,
                                                fontWeight: 600,
                                                border: "none",
                                                cursor: "pointer",
                                                background: bi.is_paid ? "#dcfce7" : "#fee2e2",
                                                color: bi.is_paid ? "#15803d" : "#b91c1c",
                                              }}
                                            >
                                              {bi.is_paid ? "Đã Thu" : "Chưa Thu"}
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Section 2: Khách Ngoài */}
      {topTab === "billing" && billingSubTab === "direct" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Section 2: Khách Ngoài */}
          <div className="card" style={{ background: "white" }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: "0 0 4px 0", color: "#b45309", display: "flex", alignItems: "center", gap: 8 }}>
                  👤 Billing Khách Ngoài (Direct Customers)
                </h3>
                <div className="muted" style={{ fontSize: 13 }}>
                  Theo dõi từng khách ngoài gửi hàng, danh sách người nhận, tổng cước và công nợ khách nợ.
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="muted" style={{ fontSize: 13 }}>Khách Ngoài Còn Nợ: </span>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#dc2626" }}>
                  ${dashboardData?.kpis.direct_unpaid_balance || 0}
                </span>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", textAlign: "left", color: "#475569", borderBottom: "2px solid #e2e8f0" }}>
                    <th style={{ padding: "10px 12px" }}>Tên Khách Gửi</th>
                    <th style={{ padding: "10px 12px" }}>Số Điện Thoại</th>
                    <th style={{ padding: "10px 12px", textAlign: "center" }}>Số Kiện</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Tổng Cân (lbs)</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Tổng Cước ($)</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Đã Thanh Toán ($)</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Khách Còn Nợ (Balance)</th>
                    <th style={{ padding: "10px 12px", textAlign: "center" }}>Chi Tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardData?.direct_billing.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>
                        Chưa có dữ liệu đơn khách ngoài nào.
                      </td>
                    </tr>
                  ) : (
                    dashboardData?.direct_billing.map((d) => {
                      const isDetailOpen = billingDirectShipperDetail === d.shipper_name;
                      const hasDebt = Number(d.balance) > 0;
                      return (
                        <>
                          <tr key={d.shipper_name} style={{ borderBottom: "1px solid #f1f5f9", background: isDetailOpen ? "#fffbeb" : "white" }}>
                            <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1e293b" }}>
                              {d.shipper_name}
                            </td>
                            <td style={{ padding: "10px 12px", color: "#2563eb" }}>
                              {d.shipper_phone || "-"}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "center" }}>{d.bill_count}</td>
                            <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: "#0f766e" }}>
                              {d.total_weight_lbs}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>
                              ${d.total_amount}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right", color: "#16a34a" }}>
                              ${d.paid_amount}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: hasDebt ? "#dc2626" : "#16a34a" }}>
                              ${d.balance}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "center" }}>
                              <button
                                className="btn"
                                style={{ fontSize: 12, padding: "3px 10px" }}
                                onClick={() => setBillingDirectShipperDetail(isDetailOpen ? null : d.shipper_name)}
                              >
                                {isDetailOpen ? "Đóng" : "Xem Bill"}
                              </button>
                            </td>
                          </tr>

                          {isDetailOpen && (
                            <tr key={`${d.shipper_name}-sub`} style={{ background: "#fffdf5" }}>
                              <td colSpan={8} style={{ padding: "12px 16px" }}>
                                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "#b45309" }}>
                                  Danh sách các kiện khách ngoài ({d.shipper_name}) gửi về VN:
                                </div>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "white", borderRadius: 8 }}>
                                  <thead>
                                    <tr style={{ background: "#fef3c7", textAlign: "left", color: "#78350f" }}>
                                      <th style={{ padding: "6px 8px" }}>Mã Bill</th>
                                      <th style={{ padding: "6px 8px" }}>Người Nhận Tại VN</th>
                                      <th style={{ padding: "6px 8px" }}>SĐT VN</th>
                                      <th style={{ padding: "6px 8px" }}>Địa Chỉ Nhận</th>
                                      <th style={{ padding: "6px 8px" }}>Mặt Hàng</th>
                                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Lbs</th>
                                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Cước Thu ($)</th>
                                      <th style={{ padding: "6px 8px", textAlign: "center" }}>Thu Tiền</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {d.bills.map((bi) => (
                                      <tr key={bi.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                        <td style={{ padding: "6px 8px", fontWeight: 600 }}>{bi.invoice_no || `ID-${bi.id}`}</td>
                                        <td style={{ padding: "6px 8px", fontWeight: 600, color: "#0f172a" }}>{bi.consignee_name}</td>
                                        <td style={{ padding: "6px 8px", color: "#2563eb" }}>{bi.consignee_phone}</td>
                                        <td style={{ padding: "6px 8px", color: "#475569" }}>{bi.consignee_address}</td>
                                        <td style={{ padding: "6px 8px", color: "#64748b" }}>{bi.commodities || "-"}</td>
                                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{bi.weight_lbs}</td>
                                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#b45309" }}>${bi.total_amount}</td>
                                        <td style={{ padding: "6px 8px", textAlign: "center" }}>
                                          <button
                                            onClick={() => toggleBillPaid(bi.id, bi.is_paid)}
                                            style={{
                                              padding: "2px 6px",
                                              borderRadius: 10,
                                              fontSize: 11,
                                              fontWeight: 600,
                                              border: "none",
                                              cursor: "pointer",
                                              background: bi.is_paid ? "#dcfce7" : "#fee2e2",
                                              color: bi.is_paid ? "#15803d" : "#b91c1c",
                                            }}
                                          >
                                            {bi.is_paid ? "Đã Thu" : "Chưa Thu"}
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

{/* ========================================================================= */}
      {/* TAB: KIỆN TỰ GỬI (CHÍNH MÌNH / SELF SHIPMENTS)                             */}
      {/* ========================================================================= */}
      {topTab === "billing" && billingSubTab === "self" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Summary Card */}
          <div className="card" style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)", color: "white" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, opacity: 0.85 }}>
                  DANH MỤC HÀNG TỰ GỬI VỀ VN
                </div>
                <h3 style={{ margin: "4px 0 0 0", fontSize: 20 }}>Kiện Hàng Của Chính Mình (Self-Shipments)</h3>
                <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
                  Tách biệt khỏi doanh thu Chợ và Khách ngoài · Đối chiếu trực tiếp cân nặng và cước phí với Cali.
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>
                  {dashboardData?.kpis.self_packages_count || 0} kiện
                </div>
                <div style={{ fontSize: 13, opacity: 0.9 }}>
                  Tổng cân nặng: <strong>{dashboardData?.kpis.self_total_weight_lbs || 0}</strong> lbs
                </div>
              </div>
            </div>
          </div>

          {/* Self Shipments Table */}
          <div className="card" style={{ background: "white" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", textAlign: "left", color: "#475569", borderBottom: "2px solid #e2e8f0" }}>
                    <th style={{ padding: "10px 12px" }}>STT</th>
                    <th style={{ padding: "10px 12px" }}>Ngày Đóng</th>
                    <th style={{ padding: "10px 12px" }}>Đợt Gửi</th>
                    <th style={{ padding: "10px 12px" }}>Thùng Số</th>
                    <th style={{ padding: "10px 12px" }}>Người Nhận Tại VN</th>
                    <th style={{ padding: "10px 12px" }}>Địa Chỉ & SĐT VN</th>
                    <th style={{ padding: "10px 12px" }}>Mặt Hàng Gửi</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Cân Nội Bộ (lbs)</th>
                    <th style={{ padding: "10px 12px" }}>Mã Cali (Tracking)</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Cali Cân (lbs)</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Cước Cali ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardData?.self_billing.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ textAlign: "center", padding: 28, color: "#94a3b8" }}>
                        Chưa có kiện hàng tự gửi nào.
                      </td>
                    </tr>
                  ) : (
                    dashboardData?.self_billing.map((s, idx) => (
                      <tr key={s.bill_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 12px", color: "#64748b" }}>{idx + 1}</td>
                        <td style={{ padding: "10px 12px", color: "#475569" }}>
                          {s.packed_date ? new Date(s.packed_date).toLocaleDateString("vi-VN") : "-"}
                        </td>
                        <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1e293b" }}>
                          {s.batch_code}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ background: "#f3e8ff", color: "#6b21a8", padding: "2px 8px", borderRadius: 8, fontWeight: 600 }}>
                            {s.box_code ? `Thùng ${s.box_code}` : "Chưa gán"}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", fontWeight: 600, color: "#0f172a" }}>
                          {s.consignee_name}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#475569", fontSize: 12 }}>
                          {s.consignee_phone && <span style={{ color: "#2563eb" }}>📞 {s.consignee_phone} · </span>}
                          {s.consignee_address}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#64748b" }}>
                          {s.commodities || "-"}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#0f766e" }}>
                          {s.weight_lbs}
                        </td>
                        <td style={{ padding: "10px 12px", color: s.cali_tracking_code ? "#1d4ed8" : "#94a3b8", fontWeight: 600 }}>
                          {s.cali_tracking_code || "Chưa có"}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: "#475569" }}>
                          {s.cali_weight_lbs ? `${s.cali_weight_lbs} lbs` : "-"}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: "#b45309" }}>
                          {s.cali_amount ? `$${s.cali_amount}` : "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      
{/* ========================================================================= */}
      {/* TAB 2: XUẤT BẢNG KÊ CHỢ MỚI (TÍNH THEO ĐƠN GIÁ - 1 + PHỤ THU)             */}
      {/* ========================================================================= */}
      {topTab === "billing" && billingSubTab === "statement_preview" && (
        <div>
          {/* Controls Bar */}
          <div className="card" style={{ marginBottom: 16, background: "white" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="row" style={{ gap: 16, alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 600, marginRight: 8 }}>Phạm vi bill:</span>
                  <select
                    className="select"
                    value={statementFilterMode}
                    onChange={(e) => setStatementFilterMode(e.target.value as any)}
                  >
                    <option value="UNBILLED">🔵 Từ đợt xuất bill gần nhất đến hiện tại (Chưa chốt)</option>
                    <option value="ALL">⚪ Xem toàn bộ (Tất cả bills)</option>
                  </select>
                </div>

                <div>
                  <span style={{ fontWeight: 600, marginRight: 8 }}>Lọc Chợ:</span>
                  <input
                    className="input"
                    placeholder="Tất cả các Chợ..."
                    value={statementMarketFilter}
                    onChange={(e) => setStatementMarketFilter(e.target.value)}
                  />
                </div>
              </div>

              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn primary"
                  disabled={downloadingPdf}
                  onClick={handleDownloadStatementPdf}
                  style={{ fontWeight: 600 }}
                >
                  {downloadingPdf ? "⏳ Đang tạo PDF..." : "📥 Tải Xuống PDF"}
                </button>
                <button className="btn" onClick={() => window.print()}>
                  🖨️ In Bảng Kê
                </button>
                <button className="btn" onClick={handleCloseAndSaveStatement}>
                  💾 Chốt & Lưu Vào Kho Bill Cũ
                </button>
              </div>
            </div>

            {/* Formula reminder */}
            <div
              style={{
                marginTop: 10,
                padding: "6px 12px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 6,
                fontSize: 13,
                color: "#166534",
              }}
            >
              💡 <strong>Công thức tính tiền cho Chợ</strong>: Cột <strong>Phí ($) = Đơn giá trên Bill - 1</strong> | <strong>Phụ Thu ($) = Giữ nguyên 100%</strong> | <strong>Tổng Tiền = (Cân nặng x Phí) + Phụ Thu</strong>.
            </div>
          </div>

          {/* EXACT PDF FORMAT TABLE: Bill Vận Chuyển */}
          <div className="card bill-print-sheet" style={{ background: "white", padding: "30px 36px" }}>
            {loadingStatement ? (
              <div style={{ textAlign: "center", padding: 40 }}>Đang tính toán bảng kê...</div>
            ) : statementData && statementData.bills.length > 0 ? (
              <div>
                {/* PDF Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
                  <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#000" }}>
                    Bill Vận Chuyển
                  </h2>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#000" }}>
                    Date: {statementData.date_title}
                  </div>
                </div>

                {/* PDF Grid Table */}
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    border: "1px solid #000",
                    fontSize: 13,
                    color: "#000",
                  }}
                >
                  <thead>
                    <tr style={{ background: "#fff" }}>
                      <th style={{ border: "1px solid #000", padding: "4px 6px", width: 38, textAlign: "left", fontWeight: 700 }}>Stt</th>
                      <th style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "left", fontWeight: 700 }}>Tên Người Nhận</th>
                      <th style={{ border: "1px solid #000", padding: "4px 6px", width: 110, textAlign: "center", fontWeight: 700 }}>Ngày gửi hàng</th>
                      <th style={{ border: "1px solid #000", padding: "4px 6px", width: 110, textAlign: "right", fontWeight: 700 }}>Cân nặng (lbs)</th>
                      <th style={{ border: "1px solid #000", padding: "4px 6px", width: 75, textAlign: "right", fontWeight: 700 }}>Phí ($)</th>
                      <th style={{ border: "1px solid #000", padding: "4px 6px", width: 95, textAlign: "right", fontWeight: 700 }}>Phụ Thu ($)</th>
                      <th style={{ border: "1px solid #000", padding: "4px 6px", width: 95, textAlign: "right", fontWeight: 700 }}>Tổng Tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statementData.bills.map((item, idx) => (
                      <tr key={item.id}>
                        <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "left" }}>{idx + 1}</td>
                        <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "left" }}>{item.consignee_name}</td>
                        <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "center" }}>{item.date}</td>
                        <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "right" }}>{formatNumberOrInt(item.weight_lbs)}</td>
                        <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "right" }}>{formatNumberOrInt(item.rate_per_lb)}</td>
                        <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "right" }}>{formatNumberOrInt(item.extra_fee)}</td>
                        <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "right" }}>{formatNumberOrInt(item.total_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} style={{ border: "none", padding: "4px 6px" }}></td>
                      <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "left", fontWeight: 700 }}>Total:</td>
                      <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "right", fontWeight: 700 }}>{formatNumberOrInt(statementData.total_amount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: 50, color: "#64748b" }}>
                Không có bill nào trong phạm vi này. Khi Zen Bot nhận diện bill hoặc bạn nhập bill mới, chúng sẽ xuất hiện ở đây!
              </div>
            )}
          </div>
        </div>
      )}

      
{/* ========================================================================= */}
      {/* TAB 3: KHO BILL CŨ ĐÃ XUẤT (LƯU LẠI + NÚT ĐÃ THANH TOÁN HAY CHƯA)         */}
      {/* ========================================================================= */}
      {topTab === "billing" && billingSubTab === "saved_history" && (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
          {/* Left list of saved statements */}
          <div className="card" style={{ height: "fit-content", background: "white" }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>
              Danh Sách Bảng Kê Đã Chốt ({savedStatements.length})
            </div>

            {savedStatements.length === 0 ? (
              <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: "30px 0" }}>
                Chưa có bảng kê nào được chốt lưu.
                <br />
                Vào tab <strong>"Xuất Bảng Kê Chợ Mới"</strong> và bấm <strong>"Chốt & Lưu Vào Kho Bill Cũ"</strong> để lưu!
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {savedStatements.map((stmt) => {
                  const active = selectedSavedStatement?.id === stmt.id;
                  return (
                    <div
                      key={stmt.id}
                      onClick={() => loadSavedStatementDetail(stmt.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        cursor: "pointer",
                        background: active ? "#eff6ff" : "#f8fafc",
                        border: active ? "1.5px solid #3b82f6" : "1px solid #e2e8f0",
                        transition: "all 0.15s",
                      }}
                    >
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, color: active ? "#1d4ed8" : "#1e293b" }}>
                          📅 {formatDate(stmt.statement_date)}
                        </span>
                        {/* Paid Toggle Badge */}
                        <button
                          className="btn"
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontWeight: 700,
                            background: stmt.is_paid ? "#dcfce7" : "#fee2e2",
                            color: stmt.is_paid ? "#15803d" : "#b91c1c",
                            borderColor: stmt.is_paid ? "#86efac" : "#fca5a5",
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePaid(stmt.id);
                          }}
                        >
                          {stmt.is_paid ? "✓ ĐÃ THANH TOÁN" : "⏳ CHƯA THANH TOÁN"}
                        </button>
                      </div>

                      <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
                        {stmt.market_name}
                      </div>
                      <div className="row" style={{ fontSize: 12, color: "#64748b", marginTop: 4, justifyContent: "space-between" }}>
                        <span>{stmt.statement_code}</span>
                        <span style={{ fontWeight: 700, color: "#0f766e" }}>${stmt.total_amount}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Selected Saved Statement Detail (Exact PDF view) */}
          <div className="card" style={{ background: "white", padding: 30 }}>
            {selectedSavedStatement ? (
              <div>
                {/* Header with Paid Toggle */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
                  <div>
                    <span style={{ fontSize: 22, fontWeight: 700, marginRight: 12 }}>
                      Bill Vận Chuyển — {selectedSavedStatement.statement_code}
                    </span>
                    <span style={{ fontSize: 14, color: "#475569" }}>
                      ({selectedSavedStatement.market_name})
                    </span>
                  </div>

                  <div className="row" style={{ gap: 10, alignItems: "center" }}>
                    {/* Paid toggle button */}
                    <button
                      className="btn"
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        padding: "6px 14px",
                        background: selectedSavedStatement.is_paid ? "#dcfce7" : "#fee2e2",
                        color: selectedSavedStatement.is_paid ? "#15803d" : "#b91c1c",
                        borderColor: selectedSavedStatement.is_paid ? "#86efac" : "#fca5a5",
                      }}
                      onClick={() => handleTogglePaid(selectedSavedStatement.id)}
                    >
                      {selectedSavedStatement.is_paid ? "✅ ĐÃ THANH TOÁN" : "⏳ CHƯA THANH TOÁN"}
                    </button>

                    <button
                      className="btn primary"
                      disabled={downloadingSavedPdf}
                      onClick={() => handleDownloadSavedStatementPdf(selectedSavedStatement.id)}
                      style={{ fontWeight: 600 }}
                    >
                      {downloadingSavedPdf ? "⏳ Đang tạo PDF..." : "📥 Tải Xuống PDF"}
                    </button>
                    <button className="btn" onClick={() => window.print()}>
                      🖨️ In Lại
                    </button>
                  </div>
                </div>

                {/* PDF Format Sheet */}
                <div className="bill-print-sheet" style={{ background: "#fff", padding: "10px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
                    <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#000" }}>
                      Bill Vận Chuyển
                    </h2>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#000" }}>
                      Date: {formatDateMDY(selectedSavedStatement.statement_date)}
                    </div>
                  </div>

                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      border: "1px solid #000",
                      fontSize: 13,
                      color: "#000",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#fff" }}>
                        <th style={{ border: "1px solid #000", padding: "4px 6px", width: 38, textAlign: "left", fontWeight: 700 }}>Stt</th>
                        <th style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "left", fontWeight: 700 }}>Tên Người Nhận</th>
                        <th style={{ border: "1px solid #000", padding: "4px 6px", width: 110, textAlign: "center", fontWeight: 700 }}>Ngày gửi hàng</th>
                        <th style={{ border: "1px solid #000", padding: "4px 6px", width: 110, textAlign: "right", fontWeight: 700 }}>Cân nặng (lbs)</th>
                        <th style={{ border: "1px solid #000", padding: "4px 6px", width: 75, textAlign: "right", fontWeight: 700 }}>Phí ($)</th>
                        <th style={{ border: "1px solid #000", padding: "4px 6px", width: 95, textAlign: "right", fontWeight: 700 }}>Phụ Thu ($)</th>
                        <th style={{ border: "1px solid #000", padding: "4px 6px", width: 95, textAlign: "right", fontWeight: 700 }}>Tổng Tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSavedStatement.bills?.map((b, idx) => {
                        const marketRate = Math.max(0, Number(b.rate_per_lb || 0) - 1);
                        const lineTotal = Number(b.weight_lbs || 0) * marketRate + Number(b.extra_fee || 0);
                        return (
                          <tr key={b.id}>
                            <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "left" }}>{idx + 1}</td>
                            <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "left" }}>{b.consignee_name}</td>
                            <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "center" }}>{formatDateMDY(b.bill_date)}</td>
                            <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "right" }}>{formatNumberOrInt(b.weight_lbs)}</td>
                            <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "right" }}>{formatNumberOrInt(marketRate)}</td>
                            <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "right" }}>{formatNumberOrInt(b.extra_fee)}</td>
                            <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "right" }}>{formatNumberOrInt(lineTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5} style={{ border: "none", padding: "4px 6px" }}></td>
                        <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "left", fontWeight: 700 }}>Total:</td>
                        <td style={{ border: "1px solid #000", padding: "4px 6px", textAlign: "right", fontWeight: 700 }}>{formatNumberOrInt(selectedSavedStatement.total_amount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>
                Chọn một bảng kê ở danh sách bên trái để xem lại hóa đơn chi tiết!
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODALS                                                                    */}
      {/* ========================================================================= */}
      {showPirateShipModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 999 }}>
          <div className="card" style={{ width: 480, background: "white", borderRadius: 12, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <h3 style={{ margin: 0, color: "#1e3a8a", display: "flex", alignItems: "center", gap: 8 }}>
                🏷️ Tạo File Ship Pirate Ship
              </h3>
              <button className="btn" style={{ padding: "4px 8px", fontSize: 13 }} onClick={() => setShowPirateShipModal(false)}>✕</button>
            </div>

            <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: "#0369a1" }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>📍 Địa chỉ nhận cố định (King Cargo):</div>
              <div>• <strong>KING CARGO - THAI MISSOURI</strong></div>
              <div>• 10471 Bolsa Ave, Westminster CA 92683-6757, US</div>
            </div>

            {psBatchId ? (
              <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 13, color: "#065f46" }}>
                <strong>📦 Đang liên kết đợt hàng:</strong> {psBatchCode} ({psBoxCount} thùng thực tế)
                <br />
                ✨ <strong>Rubber Stamp tự động:</strong> Tự động đánh số <strong>THÙNG 1, 2, 3... kèm tên người nhận hoặc A + B + C (đơn gộp)</strong> theo đúng nhật ký đóng thùng!
              </div>
            ) : (
              <div style={{ background: "#fefce8", border: "1px solid #fef08a", borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 13, color: "#854d0e" }}>
                ✨ <strong>Rubber Stamp tự động:</strong> File sẽ tự đánh số <strong>THÙNG 1, 2, 3...</strong> ở cả cột <em>Rubber Stamp 1</em> lẫn <em>Recipient Name</em>.
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Số lượng thùng / label cần tạo:</label>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="input"
                  style={{ width: 100, fontSize: 15, fontWeight: 600 }}
                  value={psBoxCount}
                  onChange={(e) => setPsBoxCount(Math.max(1, parseInt(e.target.value) || 1))}
                />
                <button type="button" className="btn" onClick={() => setPsBoxCount(3)}>3</button>
                <button type="button" className="btn" onClick={() => setPsBoxCount(5)}>5</button>
                <button type="button" className="btn" onClick={() => setPsBoxCount(10)}>10</button>
                <button type="button" className="btn" onClick={() => setPsBoxCount((prev) => prev + 1)}>+1</button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Cân nặng mỗi thùng (lbs):</label>
                <input
                  type="number"
                  step="0.1"
                  min={0.1}
                  className="input"
                  style={{ width: "100%" }}
                  value={psWeightLbs}
                  onChange={(e) => setPsWeightLbs(parseFloat(e.target.value) || 8.0)}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Tiền tố mã đơn (Prefix):</label>
                <input
                  className="input"
                  style={{ width: "100%" }}
                  value={psPrefix}
                  onChange={(e) => setPsPrefix(e.target.value.toUpperCase())}
                  placeholder="TC"
                />
              </div>
            </div>

            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16, fontStyle: "italic" }}>
              💡 File xuất ra có đủ các cột chuẩn Pirate Ship (Order ID, Name, Address, City, State, Zip, Country, Weight). Tải về và chọn &quot;Upload Spreadsheet&quot; trên Pirate Ship.
            </div>

            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" onClick={() => setShowPirateShipModal(false)}>Đóng</button>
              <button
                type="button"
                className="btn"
                disabled={downloadingFormat !== null}
                onClick={() => void handleDownloadPirateShip("csv")}
              >
                {downloadingFormat === "csv" ? "Đang tải..." : "📥 Tải CSV (.csv)"}
              </button>
              <button
                type="button"
                className="btn primary"
                style={{ background: "#0284c7", borderColor: "#0284c7" }}
                disabled={downloadingFormat !== null}
                onClick={() => void handleDownloadPirateShip("xlsx")}
              >
                {downloadingFormat === "xlsx" ? "Đang tải..." : "📊 Tải Excel (.xlsx)"}
              </button>
            </div>
          </div>
        </div>
      )}

      
{showNewBatchModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 999 }}>
          <div className="card" style={{ width: 440, background: "white" }}>
            <h3 style={{ margin: "0 0 16px 0" }}>Tạo Ngày Đóng Hàng Mới</h3>
            <form onSubmit={handleCreateBatch}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Ngày đóng hàng:</label>
                <input type="date" className="input" style={{ width: "100%" }} value={newBatchDate} onChange={(e) => setNewBatchDate(e.target.value)} required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Tên Chợ / Đại lý:</label>
                <input className="input" style={{ width: "100%" }} value={newBatchMarket} onChange={(e) => setNewBatchMarket(e.target.value)} placeholder="Ví dụ: Chợ Việt St. Louis..." required />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Ghi chú:</label>
                <textarea className="input" style={{ width: "100%", height: 60 }} value={newBatchNotes} onChange={(e) => setNewBatchNotes(e.target.value)} placeholder="Ghi chú đợt bay..." />
              </div>
              <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn" onClick={() => setShowNewBatchModal(false)}>Hủy</button>
                <button type="submit" className="btn primary">Lưu & Mở Đợt</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewBoxModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 999 }}>
          <div className="card" style={{ width: 440, background: "white" }}>
            <h3 style={{ margin: "0 0 16px 0" }}>Thêm Thùng Hàng Mới</h3>
            <form onSubmit={handleCreateBox}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Mã Thùng (để trống tự sinh):</label>
                <input className="input" style={{ width: "100%" }} placeholder="Ví dụ: THUNG-01" value={newBoxCode} onChange={(e) => setNewBoxCode(e.target.value)} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Chữ ghi trên Nhãn dán (Label):</label>
                <input className="input" style={{ width: "100%" }} placeholder="Ví dụ: NGUYỄN T BÌNH hoặc BÌNH + LAN" value={newBoxLabel} onChange={(e) => setNewBoxLabel(e.target.value)} required />
              </div>
              <div style={{ marginBottom: 12, padding: "8px 12px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#7e22ce", cursor: "pointer" }}>
                  <input type="checkbox" checked={newBoxIsHub} onChange={(e) => setNewBoxIsHub(e.target.checked)} />
                  <span>🏢 Thùng Gom Đầu Cầu VN (Hub VN - tránh cước min 10lbs)</span>
                </label>
                {newBoxIsHub && (
                  <div style={{ marginTop: 8 }}>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>Tên Người Nhận Đầu Cầu VN:</label>
                    <input
                      className="input"
                      style={{ width: "100%" }}
                      placeholder="Ví dụ: Nguyễn Văn A (Đầu Cầu Sài Gòn)"
                      value={newBoxHubConsignee}
                      onChange={(e) => setNewBoxHubConsignee(e.target.value)}
                      required={newBoxIsHub}
                    />
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Ảnh chụp thùng hàng:</label>
                <input type="file" accept="image/*" className="input" style={{ width: "100%" }} onChange={(e) => setNewBoxFile(e.target.files?.[0] || null)} />
              </div>
              <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn" onClick={() => setShowNewBoxModal(false)}>Hủy</button>
                <button type="submit" className="btn primary">Lưu Thùng</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewBillModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 999 }}>
          <div className="card" style={{ width: 500, background: "white", maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 16px 0" }}>Nhập Bill Viết Tay Thủ Công</h3>
            <form onSubmit={handleCreateBill}>
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 2 }}>Phân Loại Đơn Hàng:</label>
                <select
                  className="input"
                  style={{ width: "100%" }}
                  value={newBillType}
                  onChange={(e) => {
                    const t = e.target.value as any;
                    setNewBillType(t);
                    const w = parseFloat(newBillWeight) || 0;
                    const r = parseFloat(newBillRate) || 0;
                    const ex = parseFloat(newBillExtra) || 0;
                    if (t === "SELF") {
                      setNewBillTotal("0");
                    } else if (t === "MARKET") {
                      const eff = Math.max(0, r - 1);
                      setNewBillTotal((w * eff + ex).toFixed(2));
                    } else {
                      setNewBillTotal((w * r + ex).toFixed(2));
                    }
                  }}
                >
                  <option value="MARKET">🏪 Chợ World Market (Theo công thức chợ)</option>
                  <option value="DIRECT">👤 Khách Ngoài (Thu trực tiếp người gửi)</option>
                  <option value="SELF">🏠 Tự Gửi (Nội bộ - Cước $0)</option>
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>Tên Người Nhận (VN):</label>
                  <input className="input" style={{ width: "100%" }} placeholder="Ví dụ: NGUYỄN T BÌNH" value={newBillConsignee} onChange={(e) => setNewBillConsignee(e.target.value)} required />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>Số ĐT:</label>
                  <input className="input" style={{ width: "100%" }} placeholder="098..." value={newBillPhone} onChange={(e) => setNewBillPhone(e.target.value)} />
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>Địa Chỉ Nhận:</label>
                <input className="input" style={{ width: "100%" }} placeholder="Số nhà, đường, quận/huyện..." value={newBillAddress} onChange={(e) => setNewBillAddress(e.target.value)} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>Người Gửi (Mỹ):</label>
                  <input className="input" style={{ width: "100%" }} placeholder="Ví dụ: DUNG DO" value={newBillShipper} onChange={(e) => setNewBillShipper(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>Mặt Hàng:</label>
                  <input className="input" style={{ width: "100%" }} placeholder="Sữa x6, Thuốc x10..." value={newBillCommodities} onChange={(e) => setNewBillCommodities(e.target.value)} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, marginBottom: 2 }}>Cân nặng (lbs):</label>
                  <input type="number" step="0.1" className="input" style={{ width: "100%" }} value={newBillWeight} onChange={(e) => {
                    setNewBillWeight(e.target.value);
                    const w = parseFloat(e.target.value) || 0;
                    const r = parseFloat(newBillRate) || 0;
                    const ex = parseFloat(newBillExtra) || 0;
                    const eff = newBillType === "MARKET" ? Math.max(0, r - 1) : (newBillType === "SELF" ? 0 : r);
                    setNewBillTotal(newBillType === "SELF" ? "0" : (w * eff + ex).toFixed(2));
                  }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, marginBottom: 2 }}>
                    Đơn giá bill ($/lb):
                    {newBillType === "MARKET" && (
                      <span style={{ color: "#2563eb", fontWeight: 600, marginLeft: 4 }}>
                        (Chợ: ${Math.max(0, (parseFloat(newBillRate) || 0) - 1)})
                      </span>
                    )}
                  </label>
                  <input type="number" step="0.1" className="input" style={{ width: "100%" }} value={newBillRate} onChange={(e) => {
                    setNewBillRate(e.target.value);
                    const w = parseFloat(newBillWeight) || 0;
                    const r = parseFloat(e.target.value) || 0;
                    const ex = parseFloat(newBillExtra) || 0;
                    const eff = newBillType === "MARKET" ? Math.max(0, r - 1) : (newBillType === "SELF" ? 0 : r);
                    setNewBillTotal(newBillType === "SELF" ? "0" : (w * eff + ex).toFixed(2));
                  }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, marginBottom: 2 }}>Phụ thu ($):</label>
                  <input type="number" step="0.1" className="input" style={{ width: "100%" }} value={newBillExtra} onChange={(e) => {
                    setNewBillExtra(e.target.value);
                    const w = parseFloat(newBillWeight) || 0;
                    const r = parseFloat(newBillRate) || 0;
                    const ex = parseFloat(e.target.value) || 0;
                    const eff = newBillType === "MARKET" ? Math.max(0, r - 1) : (newBillType === "SELF" ? 0 : r);
                    setNewBillTotal(newBillType === "SELF" ? "0" : (w * eff + ex).toFixed(2));
                  }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, marginBottom: 2, fontWeight: 600 }}>Tổng ($):</label>
                  <input type="number" step="0.1" className="input" style={{ width: "100%", fontWeight: 700, color: "#16a34a" }} value={newBillTotal} onChange={(e) => setNewBillTotal(e.target.value)} />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>Xếp vào Thùng nào:</label>
                <select className="select" style={{ width: "100%" }} value={newBillTargetBoxId} onChange={(e) => setNewBillTargetBoxId(e.target.value)}>
                  <option value="">-- Chưa xếp thùng --</option>
                  {batchDetail?.boxes.map((box) => (
                    <option key={box.id} value={box.id}>{box.box_code} ({box.label_text || "Không nhãn"})</option>
                  ))}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>Ảnh chụp tờ Bill Trust Cargo:</label>
                <input type="file" accept="image/*" className="input" style={{ width: "100%" }} onChange={(e) => setNewBillFile(e.target.files?.[0] || null)} />
              </div>
              <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn" onClick={() => setShowNewBillModal(false)}>Hủy</button>
                <button type="submit" className="btn primary">Lưu Bill</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {viewImageUrl && (
        <div
          onClick={() => setViewImageUrl(null)}
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column",
            justifyContent: "center", alignItems: "center", zIndex: 1000, cursor: "zoom-out",
          }}
        >
          <div style={{ color: "white", fontSize: 16, fontWeight: 600, marginBottom: 10 }}>
            {viewImageTitle} (Bấm vào màn hình để đóng)
          </div>
          <img src={viewImageUrl} alt="Full preview" style={{ maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain", borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}
