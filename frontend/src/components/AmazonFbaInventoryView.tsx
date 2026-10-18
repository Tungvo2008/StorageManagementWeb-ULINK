import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import type {
  AmazonFbaInventorySummary,
  AmazonFbaItemStock,
  AmazonRestockSuggestionItem,
  AmazonRestockSuggestionResponse,
} from "../types";

export interface CreateFbaInboundLineItem {
  amazonSku: string;
  sku?: string;
  productId?: number;
  productName: string;
  boxCount: number;
  unitsPerBox: number;
  quantity: number;
  pieces: number;
  uom: string;
  ulinkAvailableDozens: number;
  ulinkAvailablePieces: number;
  reason?: string;
  boxName?: string;
}

export interface CreateFbaInboundResponseData {
  success: boolean;
  issue_id: number;
  issue_number: string;
  inbound_plan_id?: string | null;
  shipment_id?: string | null;
  total_boxes: number;
  total_units: number;
  total_pieces: number;
  lines: Array<{
    amazon_sku: string;
    product_id: number;
    sku: string;
    product_name: string;
    box_count: number;
    units_per_box: number;
    quantity: number;
    pieces: number;
    uom: string;
  }>;
}

type Props = {
  onOpenOptimizerWithSkus: (skus: { amazonSku: string; quantity: number }[]) => void;
  onOpenHistory: () => void;
  onOpenDispatchModal: (items: { sku: string; amazonSku: string; productName: string; quantity: number; boxCount?: number }[]) => void;
};

export default function AmazonFbaInventoryView({
  onOpenOptimizerWithSkus,
  onOpenHistory,
  onOpenDispatchModal,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<AmazonFbaInventorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OUT_OF_STOCK" | "LOW_STOCK" | "HEALTHY">("ALL");
  const [inStockOnly, setInStockOnly] = useState(true);

  // Selection
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());

  // Inbound Shipment Wizard State
  const [restockModalOpen, setRestockModalOpen] = useState(false);
  const [restockLoading, setRestockLoading] = useState(false);
  const [restockData, setRestockData] = useState<AmazonRestockSuggestionResponse | null>(null);

  // Wizard Navigation: Step 1 (Select/Suggest) -> Step 2 (Review & Address) -> Step 3 (Execution / Success)
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardMode, setWizardMode] = useState<"AI" | "MANUAL">("AI");
  const [wizardLines, setWizardLines] = useState<CreateFbaInboundLineItem[]>([]);
  
  // Manual item addition
  const [manualSkuToAdd, setManualSkuToAdd] = useState<string>("");
  const [manualBoxesToAdd, setManualBoxesToAdd] = useState<number>(5);

  // Shipment Config
  const [shipmentName, setShipmentName] = useState<string>("");
  const [shipFromAddress, setShipFromAddress] = useState({
    name: "Thai Nguyen",
    addressLine1: "3900 S Grand Blvd",
    city: "St. Louis",
    stateOrProvinceCode: "MO",
    countryCode: "US",
    postalCode: "63118",
    phoneNumber: "3145550199",
  });
  const [createSpApiPlan, setCreateSpApiPlan] = useState<boolean>(true);
  const [manualShipmentId, setManualShipmentId] = useState<string>("");
  const [shipmentNote, setShipmentNote] = useState<string>("");

  // Submission & Result
  const [submittingShipment, setSubmittingShipment] = useState<boolean>(false);
  const [shipmentResult, setShipmentResult] = useState<CreateFbaInboundResponseData | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadInventory = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        in_stock_only: inStockOnly ? "true" : "false",
        force_refresh: forceRefresh ? "true" : "false",
      });
      const res = await apiJson<AmazonFbaInventorySummary>(`/api/v1/amazon-shipments/fba-inventory?${query}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi tải tồn kho FBA");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [inStockOnly]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  // Filtered items
  const filteredItems = useMemo(() => {
    if (!data) return [];
    return data.items.filter((it) => {
      // Exclude renew / used / AMZ: items
      const skuLower = it.sku.toLowerCase();
      const nameLower = (it.product_name || "").toLowerCase();
      if (
        skuLower.startsWith("amzn.") ||
        skuLower.includes("amzn.gr") ||
        skuLower.includes("amz:") ||
        nameLower.includes("amz:") ||
        (it.condition && it.condition !== "NewItem")
      ) {
        return false;
      }

      // Status filter
      if (statusFilter !== "ALL" && it.status !== statusFilter) return false;

      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const skuMatch = it.sku.toLowerCase().includes(q);
        const ulinkSkuMatch = it.ulink_sku?.toLowerCase().includes(q);
        const nameMatch = it.product_name?.toLowerCase().includes(q) || it.ulink_product_name?.toLowerCase().includes(q);
        const asinMatch = it.asin?.toLowerCase().includes(q);
        if (!skuMatch && !ulinkSkuMatch && !nameMatch && !asinMatch) return false;
      }

      return true;
    });
  }, [data, statusFilter, search]);

  // Selection toggles
  const toggleSelect = (sku: string) => {
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedSkus.size >= filteredItems.length) {
      setSelectedSkus(new Set());
    } else {
      setSelectedSkus(new Set(filteredItems.map((it) => it.sku)));
    }
  };

  // Helper to open Wizard
  const openRestockWizard = async (mode: "AI" | "MANUAL" = "AI", specificSkus?: string[]) => {
    setWizardMode(mode);
    setWizardStep(1);
    setShipmentResult(null);
    setSubmitError(null);
    setRestockModalOpen(true);
    
    // Default shipment name with date
    const d = new Date();
    const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    setShipmentName(`FBA-RESTOCK-${dateStr}`);

    if (mode === "AI") {
      setRestockLoading(true);
      try {
        const skusToSend = specificSkus ?? (selectedSkus.size > 0 ? Array.from(selectedSkus) : null);
        const res = await apiJson<AmazonRestockSuggestionResponse>("/api/v1/amazon-shipments/suggest-restock", {
          method: "POST",
          body: JSON.stringify({
            selected_skus: skusToSend,
            min_boxes: 5,
            target_boxes_per_sku: 5,
          }),
        });
        setRestockData(res);
        
        // Convert to editable wizard lines
        const initialLines: CreateFbaInboundLineItem[] = res.items.map((it) => {
          const mult = it.uom_multiplier || (it.amazon_sku.includes("600GSM") ? 6 : 12);
          return {
            amazonSku: it.amazon_sku,
            sku: it.ulink_sku || undefined,
            productId: it.ulink_product_id || undefined,
            productName: it.product_name,
            boxCount: it.suggested_boxes,
            unitsPerBox: it.units_per_box,
            quantity: it.total_units_to_pick,
            pieces: it.total_pieces_to_pick ?? (it.total_units_to_pick * mult),
            uom: it.uom || (mult === 6 ? "6 Pack" : "Dozen"),
            ulinkAvailableDozens: it.ulink_available_dozens ?? Math.floor(it.ulink_available_stock / mult),
            ulinkAvailablePieces: it.ulink_available_stock,
            reason: it.ai_reasoning,
            boxName: it.box_name || undefined,
          };
        });
        setWizardLines(initialLines);
      } catch (err) {
        alert("Lỗi tạo gợi ý đóng hàng: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        setRestockLoading(false);
      }
    } else {
      // Manual mode: start with selectedSkus if any
      setRestockData(null);
      if (selectedSkus.size > 0 && data) {
        const manualItems: CreateFbaInboundLineItem[] = [];
        for (const sku of Array.from(selectedSkus)) {
          const item = data.items.find((x) => x.sku === sku);
          if (item) {
            let upb = 14;
            if (sku.includes("600GSM")) upb = 20;
            else if (sku.includes("1313")) upb = 32;
            
            const mult = item.uom_multiplier || (sku.includes("600GSM") ? 6 : 12);
            const uomLabel = item.uom || (mult === 6 ? "6 Pack" : "Dozen");
            const boxCount = 5;
            const quantity = boxCount * upb;
            const pieces = quantity * mult;
            const ulinkDozens = item.ulink_stock_uom !== undefined ? item.ulink_stock_uom : Math.floor(item.ulink_stock / mult);

            manualItems.push({
              amazonSku: item.sku,
              sku: item.ulink_sku || undefined,
              productId: item.ulink_product_id || undefined,
              productName: item.ulink_product_name || item.product_name || item.sku,
              boxCount: boxCount,
              unitsPerBox: upb,
              quantity: quantity,
              pieces: pieces,
              uom: uomLabel,
              ulinkAvailableDozens: ulinkDozens,
              ulinkAvailablePieces: item.ulink_stock,
              boxName: upb === 32 
                ? "Thùng 13x13 (21x21x17 in, 49 lbs)" 
                : upb === 20 
                ? "Thùng 16x28 600GSM (24x19x16 in, 49 lbs)" 
                : (
                    item.sku !== "TWH_1628_White_24Pack" && 
                    (item.ulink_sku === "UL1628T001" || 
                     (item.sku.toLowerCase().includes("white") && !item.ulink_product_name?.toLowerCase().includes("black")))
                  )
                ? "Thùng 16x28 Ngắn - Trắng (19x24x20.5 in, 49 lbs)"
                : "Thùng 16x28 Dài - Màu (28x18x17 in, 49 lbs)",
            });
          }
        }
        setWizardLines(manualItems);
      } else {
        setWizardLines([]);
      }
    }
  };

  const handleUpdateBoxCount = (index: number, newBoxes: number) => {
    setWizardLines((prev) => {
      const next = [...prev];
      const item = { ...next[index] };
      const boxes = Math.max(1, newBoxes);
      item.boxCount = boxes;
      item.quantity = boxes * item.unitsPerBox;
      const mult = item.uom === "6 Pack" ? 6 : item.uom === "Dozen" ? 12 : 1;
      item.pieces = item.quantity * mult;
      next[index] = item;
      return next;
    });
  };

  const handleRemoveWizardLine = (index: number) => {
    setWizardLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddManualItem = () => {
    if (!manualSkuToAdd || !data) return;
    const item = data.items.find((x) => x.sku === manualSkuToAdd);
    if (!item) return;

    // Check if already in list
    if (wizardLines.some((x) => x.amazonSku === item.sku)) {
      alert("Sản phẩm này đã có trong danh sách!");
      return;
    }

    let upb = 14;
    if (item.sku.includes("600GSM")) upb = 20;
    else if (item.sku.includes("1313")) upb = 32;

    const mult = item.uom_multiplier || (item.sku.includes("600GSM") ? 6 : 12);
    const uomLabel = item.uom || (mult === 6 ? "6 Pack" : "Dozen");
    const boxCount = Math.max(1, manualBoxesToAdd);
    const quantity = boxCount * upb;
    const pieces = quantity * mult;
    const ulinkDozens = item.ulink_stock_uom !== undefined ? item.ulink_stock_uom : Math.floor(item.ulink_stock / mult);

    const newLine: CreateFbaInboundLineItem = {
      amazonSku: item.sku,
      sku: item.ulink_sku || undefined,
      productId: item.ulink_product_id || undefined,
      productName: item.ulink_product_name || item.product_name || item.sku,
      boxCount: boxCount,
      unitsPerBox: upb,
      quantity: quantity,
      pieces: pieces,
      uom: uomLabel,
      ulinkAvailableDozens: ulinkDozens,
      ulinkAvailablePieces: item.ulink_stock,
      boxName: upb === 32 
                ? "Thùng 13x13 (21x21x17 in, 49 lbs)" 
                : upb === 20 
                ? "Thùng 16x28 600GSM (24x19x16 in, 49 lbs)" 
                : (
                    item.sku !== "TWH_1628_White_24Pack" && 
                    (item.ulink_sku === "UL1628T001" || 
                     (item.sku.toLowerCase().includes("white") && !item.ulink_product_name?.toLowerCase().includes("black")))
                  )
                ? "Thùng 16x28 Ngắn - Trắng (19x24x20.5 in, 49 lbs)"
                : "Thùng 16x28 Dài - Màu (28x18x17 in, 49 lbs)",
    };

    setWizardLines((prev) => [...prev, newLine]);
    setManualSkuToAdd("");
  };

  // Submit and create FBA Inbound Shipment
  const handleExecuteShipmentCreation = async () => {
    if (wizardLines.length === 0) {
      alert("Vui lòng chọn ít nhất 1 sản phẩm đóng hàng.");
      return;
    }

    // Check stock validation before submitting
    for (const line of wizardLines) {
      if (line.pieces > line.ulinkAvailablePieces) {
        alert(`Kho ULINK không đủ hàng cho món "${line.productName}". Cần ${line.pieces.toLocaleString()} cái nhưng chỉ còn ${line.ulinkAvailablePieces.toLocaleString()} cái.`);
        return;
      }
    }

    setSubmittingShipment(true);
    setSubmitError(null);
    try {
      const payload = {
        shipment_name: shipmentName || "ULINK FBA Restock",
        source_address: shipFromAddress,
        create_sp_api_plan: createSpApiPlan,
        manual_shipment_id: manualShipmentId || undefined,
        note: shipmentNote || undefined,
        lines: wizardLines.map((l) => ({
          amazon_sku: l.amazonSku,
          sku: l.sku,
          product_id: l.productId,
          box_count: l.boxCount,
          units_per_box: l.unitsPerBox,
          quantity: l.quantity,
        })),
      };

      const res = await apiJson<CreateFbaInboundResponseData>(
        "/api/v1/amazon-shipments/create-fba-inbound-shipment",
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );

      setShipmentResult(res);
      setWizardStep(3); // Success step
      void loadInventory(true); // refresh stock
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingShipment(false);
    }
  };

  // Send items to optimizer tab
  const handleSendToOptimizer = () => {
    if (!wizardLines.length) return;
    const items = wizardLines.map((it) => ({
      amazonSku: it.amazonSku,
      quantity: it.quantity,
    }));
    setRestockModalOpen(false);
    onOpenOptimizerWithSkus(items);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI Cards Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        {/* Out of Stock Card */}
        <div
          onClick={() => setStatusFilter((curr) => (curr === "OUT_OF_STOCK" ? "ALL" : "OUT_OF_STOCK"))}
          style={{
            background: statusFilter === "OUT_OF_STOCK" ? "#fee2e2" : "#fef2f2",
            border: `1.5px solid ${statusFilter === "OUT_OF_STOCK" ? "#dc2626" : "#fca5a5"}`,
            borderRadius: 12,
            padding: "12px 16px",
            cursor: "pointer",
            transition: "all 0.2s",
            boxShadow: statusFilter === "OUT_OF_STOCK" ? "0 4px 6px -1px rgba(220, 38, 38, 0.2)" : "none",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#991b1b", textTransform: "uppercase" }}>
            🔴 Hết Hàng FBA (0 cái)
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#b91c1c", marginTop: 4 }}>
            {data ? data.out_of_stock_count : "..."} <span style={{ fontSize: 13, fontWeight: 500 }}>mã hàng</span>
          </div>
          <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 4 }}>Cần đóng restock khẩn cấp</div>
        </div>

        {/* Low Stock Card */}
        <div
          onClick={() => setStatusFilter((curr) => (curr === "LOW_STOCK" ? "ALL" : "LOW_STOCK"))}
          style={{
            background: statusFilter === "LOW_STOCK" ? "#fef08a" : "#fefce8",
            border: `1.5px solid ${statusFilter === "LOW_STOCK" ? "#ca8a04" : "#fde047"}`,
            borderRadius: 12,
            padding: "12px 16px",
            cursor: "pointer",
            transition: "all 0.2s",
            boxShadow: statusFilter === "LOW_STOCK" ? "0 4px 6px -1px rgba(202, 138, 4, 0.2)" : "none",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#854d0e", textTransform: "uppercase" }}>
            🟡 Sắp Hết Hàng FBA (&lt; 10)
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#a16207", marginTop: 4 }}>
            {data ? data.low_stock_count : "..."} <span style={{ fontSize: 13, fontWeight: 500 }}>mã hàng</span>
          </div>
          <div style={{ fontSize: 11, color: "#a16207", marginTop: 4 }}>Nguy cơ đứt hàng sớm</div>
        </div>

        {/* Fulfillable Card */}
        <div
          onClick={() => setStatusFilter((curr) => (curr === "HEALTHY" ? "ALL" : "HEALTHY"))}
          style={{
            background: statusFilter === "HEALTHY" ? "#dcfce7" : "#f0fdf4",
            border: `1.5px solid ${statusFilter === "HEALTHY" ? "#16a34a" : "#86efac"}`,
            borderRadius: 12,
            padding: "12px 16px",
            cursor: "pointer",
            transition: "all 0.2s",
            boxShadow: statusFilter === "HEALTHY" ? "0 4px 6px -1px rgba(22, 163, 74, 0.2)" : "none",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#166534", textTransform: "uppercase" }}>
            🟢 Sẵn Sàng Bán (Fulfillable)
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#15803d", marginTop: 4 }}>
            {data ? data.total_fulfillable.toLocaleString() : "..."} <span style={{ fontSize: 13, fontWeight: 500 }}>Dozen / Pack</span>
          </div>
          <div style={{ fontSize: 11, color: "#15803d", marginTop: 4 }}>Đang bày bán trên Amazon</div>
        </div>

        {/* Inbound Card */}
        <div
          style={{
            background: "#eff6ff",
            border: "1.5px solid #bfdbfe",
            borderRadius: 12,
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1e40af", textTransform: "uppercase" }}>
            🚚 Đang Chuyển Vào Kho
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#1d4ed8", marginTop: 4 }}>
            {data ? data.total_inbound.toLocaleString() : "..."} <span style={{ fontSize: 13, fontWeight: 500 }}>Dozen / Pack</span>
          </div>
          <div style={{ fontSize: 11, color: "#1d4ed8", marginTop: 4 }}>Đang trên đường đến Amazon</div>
        </div>

        {/* Reserved Card */}
        <div
          style={{
            background: "#faf5ff",
            border: "1.5px solid #e9d5ff",
            borderRadius: 12,
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#6b21a8", textTransform: "uppercase" }}>
            ⏳ Khách Đặt / Đang Giữ
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#7e22ce", marginTop: 4 }}>
            {data ? data.total_reserved.toLocaleString() : "..."} <span style={{ fontSize: 13, fontWeight: 500 }}>Dozen / Pack</span>
          </div>
          <div style={{ fontSize: 11, color: "#7e22ce", marginTop: 4 }}>Chờ đóng gói giao khách</div>
        </div>
      </div>

      {/* Main Card with Toolbar & Table */}
      <div className="card">
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          {/* Left: Search & Filter Tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="🔍 Tìm tên, SKU ULINK, SKU Amazon, ASIN..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input"
              style={{ width: 280 }}
            />

            <div style={{ display: "flex", gap: 4, background: "#f1f5f9", padding: 3, borderRadius: 10 }}>
              <button
                type="button"
                className={`btn ${statusFilter === "ALL" ? "primary" : ""}`}
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => setStatusFilter("ALL")}
              >
                Tất cả ({data ? data.total_items : 0})
              </button>
              <button
                type="button"
                className={`btn ${statusFilter === "OUT_OF_STOCK" ? "primary" : ""}`}
                style={{ padding: "4px 10px", fontSize: 12, color: statusFilter === "OUT_OF_STOCK" ? "white" : "#b91c1c" }}
                onClick={() => setStatusFilter("OUT_OF_STOCK")}
              >
                🔴 Hết hàng ({data ? data.out_of_stock_count : 0})
              </button>
              <button
                type="button"
                className={`btn ${statusFilter === "LOW_STOCK" ? "primary" : ""}`}
                style={{ padding: "4px 10px", fontSize: 12, color: statusFilter === "LOW_STOCK" ? "white" : "#a16207" }}
                onClick={() => setStatusFilter("LOW_STOCK")}
              >
                🟡 Sắp hết ({data ? data.low_stock_count : 0})
              </button>
              <button
                type="button"
                className={`btn ${statusFilter === "HEALTHY" ? "primary" : ""}`}
                style={{ padding: "4px 10px", fontSize: 12, color: statusFilter === "HEALTHY" ? "white" : "#15803d" }}
                onClick={() => setStatusFilter("HEALTHY")}
              >
                🟢 Đủ hàng ({data ? data.healthy_count : 0})
              </button>
            </div>
          </div>

          {/* Right: Action Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Create Inbound Shipment Wizard Buttons */}
            <button
              type="button"
              className="btn"
              style={{
                background: "#0284c7",
                color: "white",
                border: "none",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
                boxShadow: "0 2px 4px rgba(2, 132, 199, 0.3)",
              }}
              onClick={() => void openRestockWizard("MANUAL")}
            >
              <span>📦</span>
              <span>
                {selectedSkus.size > 0
                  ? `Tự Chọn Đóng FBA (${selectedSkus.size} món)`
                  : "Tự Chọn Sản Phẩm Đóng FBA"}
              </span>
            </button>

            <button
              type="button"
              className="btn primary"
              style={{
                background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
                border: "none",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
                boxShadow: "0 2px 4px rgba(99, 102, 241, 0.3)",
              }}
              onClick={() => void openRestockWizard("AI")}
            >
              <span>🤖</span>
              <span>
                {selectedSkus.size > 0
                  ? `AI Gợi Ý Restock (${selectedSkus.size} món)`
                  : "AI Gợi Ý Lô Hàng FBA"}
              </span>
            </button>

            {/* Refresh from Amazon Button */}
            <button
              type="button"
              className="btn"
              disabled={refreshing || loading}
              onClick={() => void loadInventory(true)}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
              title="Buộc làm mới dữ liệu trực tiếp từ Amazon SP-API"
            >
              <span style={{ display: "inline-block", transform: refreshing ? "rotate(180deg)" : "none", transition: "transform 0.5s" }}>
                🔄
              </span>
              <span>{refreshing ? "Đang đồng bộ..." : "Làm mới từ Amazon"}</span>
            </button>

            {/* View FBA Dispatch History */}
            <button type="button" className="btn" onClick={onOpenHistory}>
              📜 Lịch sử xuất FBA
            </button>
          </div>
        </div>

        {/* Selection bar if items selected */}
        {selectedSkus.size > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              padding: "8px 14px",
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Đang chọn <b>{selectedSkus.size}</b> sản phẩm</span>
              <button
                type="button"
                className="btn"
                style={{ padding: "2px 8px", fontSize: 11 }}
                onClick={() => setSelectedSkus(new Set())}
              >
                Bỏ chọn tất cả
              </button>
            </div>
            <button
              type="button"
              className="btn primary"
              style={{ padding: "4px 12px", fontSize: 12 }}
              onClick={() => void openRestockWizard("AI", Array.from(selectedSkus))}
            >
              📋 Tạo Phiếu Nhặt Hàng Cho Các Món Này
            </button>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div style={{ padding: 12, background: "#fee2e2", color: "#b91c1c", borderRadius: 8, marginBottom: 16 }}>
            ❌ {error}
          </div>
        )}

        {/* Inventory Table */}
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={filteredItems.length > 0 && selectedSkus.size === filteredItems.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={{ width: 50 }}>Ảnh</th>
                <th>Sản Phẩm &amp; Mã SKU</th>
                <th style={{ textAlign: "right", width: 160 }}>Kho ULINK (Nhà)</th>
                <th style={{ textAlign: "center", width: 230 }}>Tồn Kho Amazon FBA (Dozen / Pack)</th>
                <th style={{ textAlign: "center", width: 130 }}>Trạng Thái FBA</th>
                <th style={{ textAlign: "center", width: 150 }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 32, color: "#64748b" }}>
                    ⏳ Đang quét và đối soát tồn kho Amazon FBA...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 32, color: "#64748b" }}>
                    Không có sản phẩm nào phù hợp với bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isSelected = selectedSkus.has(item.sku);
                  return (
                    <tr
                      key={item.sku}
                      style={{
                        background: isSelected ? "#f8fafc" : "transparent",
                        transition: "background 0.15s",
                      }}
                    >
                      {/* Checkbox */}
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(item.sku)}
                        />
                      </td>

                      {/* Image */}
                      <td>
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt=""
                            style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #e2e8f0" }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 6,
                              background: "#f1f5f9",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 18,
                            }}
                          >
                            📦
                          </div>
                        )}
                      </td>

                      {/* Product Name & SKUs */}
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>
                          {item.ulink_product_name || item.product_name}
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                          {item.ulink_sku && (
                            <span
                              style={{
                                background: "#f1f5f9",
                                color: "#334155",
                                padding: "2px 6px",
                                borderRadius: 4,
                                fontSize: 11,
                                fontFamily: "monospace",
                                fontWeight: 600,
                              }}
                            >
                              ULINK: {item.ulink_sku}
                            </span>
                          )}
                          <span
                            style={{
                              background: "#fff7ed",
                              color: "#c2410c",
                              padding: "2px 6px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontFamily: "monospace",
                              fontWeight: 600,
                            }}
                          >
                            AMZ: {item.sku}
                          </span>
                          {item.asin && (
                            <span
                              style={{
                                color: "#64748b",
                                fontSize: 11,
                                fontFamily: "monospace",
                              }}
                            >
                              ASIN: {item.asin}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* ULINK Warehouse Stock */}
                      <td style={{ textAlign: "right" }}>
                        {item.is_mapped ? (
                          (() => {
                            const mult = item.uom_multiplier || (item.sku.includes("600GSM") ? 6 : (item.sku.includes("12Pack") || item.sku.includes("24Pack") || item.sku.startsWith("TWH_")) ? 12 : 1);
                            const uomLabel = item.uom || (mult === 12 ? "Dozen" : mult === 6 ? "Pack" : "cái");
                            const stockInUom = item.ulink_stock_uom !== undefined ? item.ulink_stock_uom : Math.floor(item.ulink_stock / mult);
                            const isAbundant = mult > 1 ? stockInUom >= 50 : item.ulink_stock > 1000;
                            const isAvailable = mult > 1 ? stockInUom > 0 : item.ulink_stock > 0;

                            return (
                              <div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: isAvailable ? "#0f172a" : "#dc2626" }}>
                                  {stockInUom.toLocaleString()}{" "}
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "#4f46e5" }}>{uomLabel}</span>
                                </div>
                                {mult > 1 && (
                                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>
                                    ({item.ulink_stock.toLocaleString()} cái lẻ)
                                  </div>
                                )}
                                <div style={{ marginTop: 2 }}>
                                  {isAbundant ? (
                                    <span style={{ fontSize: 10, color: "#16a34a", fontWeight: 600 }}>Dồi dào</span>
                                  ) : isAvailable ? (
                                    <span style={{ fontSize: 10, color: "#ca8a04", fontWeight: 600 }}>Còn hàng</span>
                                  ) : (
                                    <span style={{ fontSize: 10, color: "#dc2626", fontWeight: 600 }}>Hết tại kho</span>
                                  )}
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <div>
                            <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>Chưa map SKU</div>
                          </div>
                        )}
                      </td>

                      {/* Amazon FBA Stock Detail */}
                      <td style={{ textAlign: "center" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 10,
                            background: "#f8fafc",
                            padding: "6px 12px",
                            borderRadius: 8,
                            border: "1px solid #e2e8f0",
                          }}
                        >
                          <div title="Sẵn sàng bán trên Amazon">
                            <span style={{ fontSize: 11, color: "#64748b" }}>Bán: </span>
                            <b style={{ color: item.fulfillable_quantity > 0 ? "#15803d" : "#dc2626", fontSize: 14 }}>
                              {item.fulfillable_quantity}
                            </b>
                          </div>
                          <span style={{ color: "#cbd5e1" }}>|</span>
                          <div title="Đang vận chuyển vào kho Amazon">
                            <span style={{ fontSize: 11, color: "#64748b" }}>Vào: </span>
                            <b style={{ color: item.inbound_quantity > 0 ? "#1d4ed8" : "#94a3b8", fontSize: 13 }}>
                              {item.inbound_quantity}
                            </b>
                          </div>
                          <span style={{ color: "#cbd5e1" }}>|</span>
                          <div title="Đang giữ / chờ giao khách">
                            <span style={{ fontSize: 11, color: "#64748b" }}>Giữ: </span>
                            <b style={{ color: item.reserved_quantity > 0 ? "#7e22ce" : "#94a3b8", fontSize: 13 }}>
                              {item.reserved_quantity}
                            </b>
                          </div>
                        </div>
                      </td>

                      {/* FBA Status Badge */}
                      <td style={{ textAlign: "center" }}>
                        {item.status === "OUT_OF_STOCK" && (
                          <span
                            style={{
                              background: "#fee2e2",
                              color: "#b91c1c",
                              padding: "4px 8px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              display: "inline-block",
                            }}
                          >
                            🔴 HẾT HÀNG FBA
                          </span>
                        )}
                        {item.status === "LOW_STOCK" && (
                          <span
                            style={{
                              background: "#fef9c3",
                              color: "#a16207",
                              padding: "4px 8px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              display: "inline-block",
                            }}
                          >
                            🟡 SẮP HẾT (&lt; 10)
                          </span>
                        )}
                        {item.status === "HEALTHY" && (
                          <span
                            style={{
                              background: "#dcfce7",
                              color: "#15803d",
                              padding: "4px 8px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              display: "inline-block",
                            }}
                          >
                            🟢 ĐỦ HÀNG
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className="btn"
                          style={{
                            fontSize: 11,
                            padding: "4px 8px",
                            fontWeight: 600,
                            color: "#4f46e5",
                            borderColor: "#c7d2fe",
                            background: "#eef2ff",
                          }}
                          onClick={() => void openRestockWizard("AI", [item.sku])}
                        >
                          📦 Gợi ý đóng món này
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- FBA INBOUND SHIPMENT CREATION WIZARD MODAL --- */}
      {restockModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.7)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 960,
              maxHeight: "92vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "16px 24px",
                background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)",
                color: "white",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 24 }}>🚀</span>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>
                      QUY TRÌNH TẠO LÔ HÀNG GỬI AMAZON FBA
                    </h2>
                    <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 2 }}>
                      {wizardMode === "AI" ? "Chế độ AI Tối Ưu Tồn Kho" : "Chế độ Tự Chọn Sản Phẩm Thủ Công"} • Chuẩn Case-Packed & Đồng bộ SP-API v2024-03-20
                    </div>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn icon"
                onClick={() => setRestockModalOpen(false)}
                style={{ background: "rgba(255, 255, 255, 0.15)", border: "none", color: "white", fontSize: 16 }}
              >
                ✕
              </button>
            </div>

            {/* Stepper Navigation */}
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid #e2e8f0",
                background: "#f8fafc",
                padding: "8px 24px",
                gap: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: wizardStep === 1 ? 700 : 500,
                  color: wizardStep === 1 ? "#4f46e5" : "#64748b",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    background: wizardStep >= 1 ? "#4f46e5" : "#cbd5e1",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  1
                </span>
                <span>Lựa Chọn & Đóng Thùng</span>
              </div>
              <span style={{ color: "#cbd5e1", alignSelf: "center" }}>➔</span>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: wizardStep === 2 ? 700 : 500,
                  color: wizardStep === 2 ? "#4f46e5" : "#64748b",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    background: wizardStep >= 2 ? "#4f46e5" : "#cbd5e1",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  2
                </span>
                <span>Xem Lại & Thông Tin Gửi</span>
              </div>
              <span style={{ color: "#cbd5e1", alignSelf: "center" }}>➔</span>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: wizardStep === 3 ? 700 : 500,
                  color: wizardStep === 3 ? "#16a34a" : "#64748b",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    background: wizardStep === 3 ? "#16a34a" : "#cbd5e1",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  3
                </span>
                <span>Chốt Lô Hàng & Thực Thi</span>
              </div>
            </div>

            {/* Modal Body */}
            <div style={{ padding: 24, overflowY: "auto", flex: 1, background: "#f8fafc" }}>
              {restockLoading ? (
                <div style={{ textAlign: "center", padding: 50, color: "#64748b" }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>🤖</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>AI đang phân tích lượng tồn FBA và tính toán số thùng tối ưu...</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>Quy cách: 14 dozen/thùng (1628), 32 dozen/thùng (1313), 20 pack/thùng (600GSM)</div>
                </div>
              ) : wizardStep === 1 ? (
                /* ================= STEP 1: SELECT & CONFIGURE ================= */
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* Mode switch */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 8, background: "#e2e8f0", padding: 3, borderRadius: 8 }}>
                      <button
                        type="button"
                        className={`btn ${wizardMode === "AI" ? "primary" : ""}`}
                        style={{ padding: "4px 12px", fontSize: 12, fontWeight: 600 }}
                        onClick={() => void openRestockWizard("AI")}
                      >
                        🤖 AI Đề Xuất Tự Động
                      </button>
                      <button
                        type="button"
                        className={`btn ${wizardMode === "MANUAL" ? "primary" : ""}`}
                        style={{ padding: "4px 12px", fontSize: 12, fontWeight: 600 }}
                        onClick={() => void openRestockWizard("MANUAL")}
                      >
                        ✍️ Tự Chọn Thủ Công
                      </button>
                    </div>

                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      * Yêu cầu Amazon: Mỗi mã hàng đóng tối thiểu <b>5 thùng</b> giống nhau.
                    </div>
                  </div>

                  {/* Manual Add Bar */}
                  {wizardMode === "MANUAL" && (
                    <div
                      style={{
                        background: "#ffffff",
                        padding: 12,
                        borderRadius: 10,
                        border: "1px solid #cbd5e1",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 260 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>
                          CHỌN SẢN PHẨM KHĂN ĐỂ THÊM VÀO LÔ HÀNG:
                        </label>
                        <select
                          className="input"
                          value={manualSkuToAdd}
                          onChange={(e) => setManualSkuToAdd(e.target.value)}
                          style={{ width: "100%", fontSize: 13 }}
                        >
                          <option value="">-- Chọn sản phẩm FBA / Khăn ULINK --</option>
                          {data?.items
                            .filter((it) => it.is_mapped && !it.sku.toLowerCase().startsWith("amzn."))
                            .map((it) => {
                              const mult = it.uom_multiplier || (it.sku.includes("600GSM") ? 6 : 12);
                              const uom = it.uom || (mult === 6 ? "Pack" : "Dozen");
                              const stockUom = it.ulink_stock_uom !== undefined ? it.ulink_stock_uom : Math.floor(it.ulink_stock / mult);
                              return (
                                <option key={it.sku} value={it.sku}>
                                  {it.product_name || it.ulink_product_name} (AMZ: {it.sku}) - Tồn kho: {stockUom} {uom} ({it.ulink_stock} cái)
                                </option>
                              );
                            })}
                        </select>
                      </div>

                      <div style={{ width: 120 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>
                          SỐ THÙNG (≥ 5):
                        </label>
                        <input
                          type="number"
                          className="input"
                          min={1}
                          value={manualBoxesToAdd}
                          onChange={(e) => setManualBoxesToAdd(Math.max(1, parseInt(e.target.value) || 1))}
                          style={{ width: "100%", fontSize: 13, textAlign: "center" }}
                        />
                      </div>

                      <div style={{ alignSelf: "flex-end" }}>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!manualSkuToAdd}
                          onClick={handleAddManualItem}
                          style={{ padding: "8px 16px", fontWeight: 700 }}
                        >
                          + Thêm Vào Danh Sách
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Summary Bar */}
                  {wizardLines.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-around",
                        background: "#ffffff",
                        border: "1.5px solid #cbd5e1",
                        borderRadius: 12,
                        padding: "12px 16px",
                      }}
                    >
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>SỐ MÃ HÀNG TRONG LÔ</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>
                          {wizardLines.length} <span style={{ fontSize: 12, fontWeight: 500 }}>món</span>
                        </div>
                      </div>
                      <div style={{ width: 1, height: 30, background: "#e2e8f0" }} />
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>TỔNG THÙNG CARTON</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: "#4f46e5" }}>
                          {wizardLines.reduce((acc, it) => acc + it.boxCount, 0)} <span style={{ fontSize: 12, fontWeight: 500 }}>thùng</span>
                        </div>
                      </div>
                      <div style={{ width: 1, height: 30, background: "#e2e8f0" }} />
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>TỔNG SỐ LƯỢNG DOZEN / PACK</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: "#16a34a" }}>
                          {wizardLines.reduce((acc, it) => acc + it.quantity, 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 600 }}>Dozen/Pack</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          (~ {wizardLines.reduce((acc, it) => acc + it.pieces, 0).toLocaleString()} cái khăn lẻ)
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Lines List */}
                  {wizardLines.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 40, background: "#ffffff", borderRadius: 12, border: "1px dashed #cbd5e1", color: "#64748b" }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>🧺</div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>Chưa có sản phẩm nào được chọn!</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        {wizardMode === "AI" ? "Hiện không có sản phẩm nào chạm ngưỡng hết hàng khẩn cấp." : "Vui lòng chọn sản phẩm ở ô phía trên để thêm vào lô hàng."}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {wizardLines.map((line, index) => {
                        const isEnoughStock = line.ulinkAvailablePieces >= line.pieces;
                        return (
                          <div
                            key={line.amazonSku}
                            style={{
                              background: "#ffffff",
                              borderRadius: 12,
                              border: isEnoughStock ? "1px solid #e2e8f0" : "1.5px solid #ef4444",
                              padding: "14px 18px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 16,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                              <span
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: 12,
                                  background: "#4f46e5",
                                  color: "white",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 12,
                                  fontWeight: 800,
                                }}
                              >
                                {index + 1}
                              </span>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                                  {line.productName}
                                </div>
                                <div style={{ display: "flex", gap: 8, fontSize: 11, marginTop: 3, color: "#64748b", flexWrap: "wrap" }}>
                                  {line.sku && <span style={{ background: "#f1f5f9", padding: "1px 6px", borderRadius: 4 }}>Kho: <b>{line.sku}</b></span>}
                                  <span style={{ background: "#fff7ed", color: "#c2410c", padding: "1px 6px", borderRadius: 4 }}>AMZ: <b>{line.amazonSku}</b></span>
                                  <span>Quy cách: <b>{line.unitsPerBox} {line.uom}/thùng</b></span>
                                  <span>•</span>
                                  <span>
                                    Tồn ULINK: <b>{line.ulinkAvailableDozens} {line.uom}</b> ({line.ulinkAvailablePieces.toLocaleString()} cái)
                                  </span>
                                </div>

                                {!isEnoughStock && (
                                  <div style={{ color: "#dc2626", fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                                    ⚠️ Kho nhà không đủ tồn! Cần {line.pieces.toLocaleString()} cái, chỉ còn {line.ulinkAvailablePieces.toLocaleString()} cái.
                                  </div>
                                )}
                                {line.reason && (
                                  <div style={{ fontSize: 11, color: "#4f46e5", marginTop: 4 }}>
                                    💡 {line.reason}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Box adjustment & Total */}
                            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                              <div style={{ textAlign: "center" }}>
                                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 2 }}>SỐ THÙNG:</div>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <button
                                    type="button"
                                    className="btn icon"
                                    onClick={() => handleUpdateBoxCount(index, line.boxCount - 1)}
                                    style={{ width: 26, height: 26, padding: 0, fontSize: 14 }}
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    className="input"
                                    min={1}
                                    value={line.boxCount}
                                    onChange={(e) => handleUpdateBoxCount(index, parseInt(e.target.value) || 1)}
                                    style={{ width: 50, textAlign: "center", padding: "2px 4px", fontSize: 14, fontWeight: 700 }}
                                  />
                                  <button
                                    type="button"
                                    className="btn icon"
                                    onClick={() => handleUpdateBoxCount(index, line.boxCount + 1)}
                                    style={{ width: 26, height: 26, padding: 0, fontSize: 14 }}
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              <div style={{ textAlign: "right", minWidth: 140 }}>
                                <div style={{ fontSize: 11, color: "#166534", fontWeight: 600 }}>TỔNG LẤY TẠI KHO:</div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: "#15803d" }}>
                                  {line.quantity} <span style={{ fontSize: 12, fontWeight: 600 }}>{line.uom}</span>
                                </div>
                                <div style={{ fontSize: 11, color: "#64748b" }}>
                                  = {line.pieces.toLocaleString()} cái lẻ
                                </div>
                              </div>

                              <button
                                type="button"
                                className="btn icon"
                                onClick={() => handleRemoveWizardLine(index)}
                                style={{ color: "#ef4444", border: "none", background: "transparent", fontSize: 16 }}
                                title="Xóa món này khỏi lô"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : wizardStep === 2 ? (
                /* ================= STEP 2: REVIEW & ADDRESS ================= */
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* Shipment Info Config */}
                  <div style={{ background: "#ffffff", padding: 18, borderRadius: 12, border: "1px solid #e2e8f0" }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a", marginBottom: 12 }}>
                      📦 1. Thông Tin Lô Hàng FBA
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>
                          TÊN LÔ HÀNG (SHIPMENT NAME):
                        </label>
                        <input
                          type="text"
                          className="input"
                          value={shipmentName}
                          onChange={(e) => setShipmentName(e.target.value)}
                          placeholder="Ví dụ: FBA-RESTOCK-20261003"
                          style={{ width: "100%" }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>
                          GHI CHÚ XUẤT KHO:
                        </label>
                        <input
                          type="text"
                          className="input"
                          value={shipmentNote}
                          onChange={(e) => setShipmentNote(e.target.value)}
                          placeholder="Ghi chú người đóng gói, số seal, tài xế..."
                          style={{ width: "100%" }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Ship From Address Card */}
                  <div style={{ background: "#ffffff", padding: 18, borderRadius: 12, border: "1px solid #e2e8f0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>
                        📍 2. Địa Chỉ Xuất Hàng (Ship-From Address)
                      </div>
                      <span style={{ fontSize: 11, background: "#dcfce7", color: "#166534", padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>
                        Kho ULINK St. Louis
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>NGƯỜI GỬI / TÊN KHO:</label>
                        <input
                          type="text"
                          className="input"
                          value={shipFromAddress.name}
                          onChange={(e) => setShipFromAddress({ ...shipFromAddress, name: e.target.value })}
                          style={{ width: "100%", marginTop: 2 }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>ĐỊA CHỈ (STREET):</label>
                        <input
                          type="text"
                          className="input"
                          value={shipFromAddress.addressLine1}
                          onChange={(e) => setShipFromAddress({ ...shipFromAddress, addressLine1: e.target.value })}
                          style={{ width: "100%", marginTop: 2 }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>THÀNH PHỐ (CITY):</label>
                        <input
                          type="text"
                          className="input"
                          value={shipFromAddress.city}
                          onChange={(e) => setShipFromAddress({ ...shipFromAddress, city: e.target.value })}
                          style={{ width: "100%", marginTop: 2 }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>BANG (STATE):</label>
                        <input
                          type="text"
                          className="input"
                          value={shipFromAddress.stateOrProvinceCode}
                          onChange={(e) => setShipFromAddress({ ...shipFromAddress, stateOrProvinceCode: e.target.value })}
                          style={{ width: "100%", marginTop: 2 }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>MÃ BƯU CHÍNH (ZIP):</label>
                        <input
                          type="text"
                          className="input"
                          value={shipFromAddress.postalCode}
                          onChange={(e) => setShipFromAddress({ ...shipFromAddress, postalCode: e.target.value })}
                          style={{ width: "100%", marginTop: 2 }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>SỐ ĐIỆN THOẠI (PHONE):</label>
                        <input
                          type="text"
                          className="input"
                          value={shipFromAddress.phoneNumber}
                          onChange={(e) => setShipFromAddress({ ...shipFromAddress, phoneNumber: e.target.value })}
                          style={{ width: "100%", marginTop: 2 }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Amazon Integration Settings */}
                  <div style={{ background: "#ffffff", padding: 18, borderRadius: 12, border: "1px solid #e2e8f0" }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a", marginBottom: 10 }}>
                      ⚡ 3. Chế Độ Tạo Lô Hàng
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="modePlan"
                          checked={createSpApiPlan}
                          onChange={() => setCreateSpApiPlan(true)}
                          style={{ marginTop: 3 }}
                        />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                            Tự động gửi tạo Shipment Plan lên Amazon SP-API (v2024-03-20)
                          </div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            Hệ thống sẽ gọi trực tiếp Amazon API để sinh <code>inboundPlanId</code> và nhận diện lô hàng ngay trên Seller Central.
                          </div>
                        </div>
                      </label>

                      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="modePlan"
                          checked={!createSpApiPlan}
                          onChange={() => setCreateSpApiPlan(false)}
                          style={{ marginTop: 3 }}
                        />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                            Chỉ tạo Phiếu Xuất Kho ULINK (Đã tạo plan bằng tay trên Seller Central)
                          </div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            Chỉ trừ kho nội bộ và lưu phiếu xuất, bạn có thể nhập Shipment ID thủ công từ Seller Central.
                          </div>
                        </div>
                      </label>

                      {!createSpApiPlan && (
                        <div style={{ marginTop: 6, marginLeft: 26, width: 320 }}>
                          <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>NHẬP SHIPMENT ID TỪ AMAZON (NẾU CÓ):</label>
                          <input
                            type="text"
                            className="input"
                            value={manualShipmentId}
                            onChange={(e) => setManualShipmentId(e.target.value)}
                            placeholder="Ví dụ: FBA18XXXXXXX"
                            style={{ width: "100%", marginTop: 2 }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Summary of Items in Step 2 */}
                  <div style={{ background: "#f1f5f9", padding: 14, borderRadius: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#334155", marginBottom: 6 }}>
                      TỔNG KẾT ĐÓNG HÀNG:
                    </div>
                    <div style={{ fontSize: 13, color: "#0f172a" }}>
                      Lô gồm <b>{wizardLines.length} sản phẩm</b> • Tổng cộng{" "}
                      <b>{wizardLines.reduce((acc, it) => acc + it.boxCount, 0)} thùng carton</b> •{" "}
                      <b>{wizardLines.reduce((acc, it) => acc + it.quantity, 0).toLocaleString()} Dozen/Pack</b> (
                      {wizardLines.reduce((acc, it) => acc + it.pieces, 0).toLocaleString()} cái khăn lẻ sẽ được trừ khỏi kho ULINK).
                    </div>
                  </div>
                </div>
              ) : (
                /* ================= STEP 3: EXECUTION & SUCCESS ================= */
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {submitError ? (
                    <div style={{ background: "#fef2f2", padding: 20, borderRadius: 12, border: "1.5px solid #ef4444" }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>❌</div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: "#991b1b" }}>TẠO LÔ HÀNG THẤT BẠI</div>
                      <div style={{ fontSize: 13, color: "#b91c1c", marginTop: 4, whiteSpace: "pre-wrap" }}>
                        {submitError}
                      </div>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setWizardStep(2)}
                        style={{ marginTop: 12, fontWeight: 700 }}
                      >
                        ← Quay lại xem lại thông tin
                      </button>
                    </div>
                  ) : shipmentResult ? (
                    <div style={{ background: "#ffffff", padding: 24, borderRadius: 16, border: "1.5px solid #22c55e", textAlign: "center" }}>
                      <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
                      <h3 style={{ fontSize: 22, fontWeight: 900, color: "#15803d", margin: "0 0 8px 0" }}>
                        TẠO LÔ HÀNG GỬI AMAZON FBA THÀNH CÔNG!
                      </h3>
                      <div style={{ fontSize: 14, color: "#475569", maxWidth: 600, margin: "0 auto 20px auto" }}>
                        Phiếu xuất kho <b>#{shipmentResult.issue_number}</b> đã được lưu vào hệ thống ULINK và khấu trừ chính xác {shipmentResult.total_pieces.toLocaleString()} cái khăn lẻ.
                      </div>

                      {/* Result metrics */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                          gap: 12,
                          maxWidth: 700,
                          margin: "0 auto 24px auto",
                        }}
                      >
                        <div style={{ background: "#f8fafc", padding: 12, borderRadius: 10, border: "1px solid #e2e8f0" }}>
                          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>MÃ PHIẾU XUẤT KHO</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                            {shipmentResult.issue_number}
                          </div>
                        </div>

                        {shipmentResult.inbound_plan_id && (
                          <div style={{ background: "#eff6ff", padding: 12, borderRadius: 10, border: "1px solid #bfdbfe" }}>
                            <div style={{ fontSize: 11, color: "#1e40af", fontWeight: 700 }}>AMAZON INBOUND PLAN ID</div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: "#1d4ed8", marginTop: 4, fontFamily: "monospace", wordBreak: "break-all" }}>
                              {shipmentResult.inbound_plan_id}
                            </div>
                          </div>
                        )}

                        <div style={{ background: "#f0fdf4", padding: 12, borderRadius: 10, border: "1px solid #bbf7d0" }}>
                          <div style={{ fontSize: 11, color: "#166534", fontWeight: 700 }}>TỔNG SỐ THÙNG</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: "#15803d", marginTop: 2 }}>
                            {shipmentResult.total_boxes} thùng
                          </div>
                        </div>

                        <div style={{ background: "#f0fdf4", padding: 12, borderRadius: 10, border: "1px solid #bbf7d0" }}>
                          <div style={{ fontSize: 11, color: "#166534", fontWeight: 700 }}>TỔNG DOZEN / PACK</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: "#15803d", marginTop: 2 }}>
                            {shipmentResult.total_units.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      {/* Detail list table */}
                      <div style={{ textAlign: "left", maxWidth: 800, margin: "0 auto 20px auto" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 8 }}>
                          📋 Danh sách sản phẩm xuất kho:
                        </div>
                        <table className="table" style={{ fontSize: 12, background: "#ffffff" }}>
                          <thead>
                            <tr style={{ background: "#f1f5f9" }}>
                              <th>Sản Phẩm</th>
                              <th>Amazon SKU</th>
                              <th style={{ textAlign: "center" }}>Số Thùng</th>
                              <th style={{ textAlign: "right" }}>Số Lượng Dozen/Pack</th>
                              <th style={{ textAlign: "right" }}>Số Cái Lẻ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shipmentResult.lines.map((l) => (
                              <tr key={l.amazon_sku}>
                                <td style={{ fontWeight: 600 }}>{l.product_name}</td>
                                <td style={{ fontFamily: "monospace", color: "#c2410c" }}>{l.amazon_sku}</td>
                                <td style={{ textAlign: "center", fontWeight: 700 }}>{l.box_count} thùng</td>
                                <td style={{ textAlign: "right", fontWeight: 700, color: "#15803d" }}>
                                  {l.quantity} {l.uom}
                                </td>
                                <td style={{ textAlign: "right", color: "#64748b" }}>
                                  {l.pieces.toLocaleString()} cái
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "16px 24px",
                background: "#ffffff",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div>
                {wizardStep === 1 && wizardLines.length > 0 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => window.print()}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    🖨️ In Phiếu Nhặt Hàng
                  </button>
                )}
                {wizardStep === 3 && shipmentResult && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => window.print()}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    🖨️ In Phiếu Xuất Kho #{shipmentResult.issue_number}
                  </button>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {wizardStep === 1 && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setRestockModalOpen(false)}
                    >
                      Hủy Bỏ
                    </button>
                    {wizardLines.length > 0 && (
                      <button
                        type="button"
                        className="btn"
                        onClick={handleSendToOptimizer}
                        style={{ fontWeight: 600, color: "#4f46e5", borderColor: "#c7d2fe" }}
                      >
                        🚚 Đưa Sang Kế Hoạch Đóng Thùng
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn primary"
                      disabled={wizardLines.length === 0}
                      onClick={() => setWizardStep(2)}
                      style={{ padding: "8px 20px", fontWeight: 700 }}
                    >
                      Tiếp Tục: Xem Lại & Thông Tin Gửi ➔
                    </button>
                  </>
                )}

                {wizardStep === 2 && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setWizardStep(1)}
                    >
                      ← Quay Lại Bước 1
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={submittingShipment}
                      onClick={handleExecuteShipmentCreation}
                      style={{
                        background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
                        borderColor: "#15803d",
                        padding: "8px 24px",
                        fontWeight: 800,
                        boxShadow: "0 4px 6px -1px rgba(22, 163, 74, 0.3)",
                      }}
                    >
                      {submittingShipment
                        ? "⏳ Đang kết nối Amazon SP-API & xuất kho..."
                        : "🚀 Xác Nhận Tạo Lô Hàng & Xuất Kho"}
                    </button>
                  </>
                )}

                {wizardStep === 3 && (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => setRestockModalOpen(false)}
                    style={{ padding: "8px 24px", fontWeight: 700 }}
                  >
                    Hoàn Tất & Đóng
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
