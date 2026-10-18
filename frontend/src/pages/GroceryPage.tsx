import { useEffect, useState, useMemo } from "react";
import { apiJson } from "../api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroceryInboundItem {
  id: number;
  batch_id: number;
  product_id?: number | null;
  item_name: string;
  sku: string;
  uom: string;
  initial_quantity: number | string;
  repacked_quantity: number | string;
  remaining_quantity: number | string;
  cost_price: number | string;
  notes?: string | null;
}

interface GroceryRepackLog {
  id: number;
  batch_id: number;
  batch_code: string;
  inbound_item_id: number;
  inbound_item_name: string;
  inbound_item_uom: string;
  target_product_id: number;
  target_product_name: string;
  target_product_sku: string;
  source_qty_used: number | string;
  target_units_produced: number;
  yield_per_unit: number | string;
  repacked_at: string;
  note?: string | null;
}

interface GroceryInboundBatch {
  id: number;
  batch_code: string;
  received_at: string;
  supplier?: string | null;
  notes?: string | null;
  status: string;
  item_count: number;
  total_initial_qty: number | string;
  total_repacked_qty: number | string;
  total_remaining_qty: number | string;
}

interface GroceryInboundBatchDetail extends GroceryInboundBatch {
  items: GroceryInboundItem[];
  repack_logs: GroceryRepackLog[];
}

interface GroceryProduct {
  id: number;
  sku: string;
  name: string;
  quantity_on_hand: number;
  unit_price: number | string;
  business_unit: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (v: number | string | null | undefined, decimals = 2) => {
  if (v === null || v === undefined || v === "") return "0";
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return Number(n.toFixed(decimals)).toString();
};

const fmtDate = (s?: string | null) => {
  if (!s) return "--";
  try {
    const d = new Date(s);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return s;
  }
};

const fmtDateOnly = (s?: string | null) => {
  if (!s) return "--";
  try {
    const d = new Date(s);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  } catch {
    return s;
  }
};

export default function GroceryPage() {
  const [activeTab, setActiveTab] = useState<"reconcile" | "logs" | "products">("reconcile");

  // Batches
  const [batches, setBatches] = useState<GroceryInboundBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [batchDetail, setBatchDetail] = useState<GroceryInboundBatchDetail | null>(null);
  const [loadingBatch, setLoadingBatch] = useState(false);

  // Repack logs (all)
  const [allLogs, setAllLogs] = useState<GroceryRepackLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Products (35 SKU hũ)
  const [products, setProducts] = useState<GroceryProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  // Modals
  const [showNewBatchModal, setShowNewBatchModal] = useState(false);
  const [newBatchCode, setNewBatchCode] = useState("");
  const [newBatchDate, setNewBatchDate] = useState(new Date().toISOString().split("T")[0]);
  const [newBatchSupplier, setNewBatchSupplier] = useState("Hàng Việt Nam");
  const [newBatchNotes, setNewBatchNotes] = useState("");
  const [newBatchItems, setNewBatchItems] = useState<Array<{ item_name: string; sku: string; uom: string; initial_quantity: string }>>([
    { item_name: "", sku: "", uom: "kg", initial_quantity: "" },
  ]);

  // Modal thêm item vào đợt hiện tại
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [addItemName, setAddItemName] = useState("");
  const [addItemSku, setAddItemSku] = useState("");
  const [addItemUom, setAddItemUom] = useState("kg");
  const [addItemQty, setAddItemQty] = useState("");

  // Modal Đóng hũ (Repack)
  const [showRepackModal, setShowRepackModal] = useState(false);
  const [repackItem, setRepackItem] = useState<GroceryInboundItem | null>(null);
  const [repackTargetProductId, setRepackTargetProductId] = useState<string>("");
  const [repackSourceQty, setRepackSourceQty] = useState<string>("");
  const [repackTargetUnits, setRepackTargetUnits] = useState<string>("");
  const [repackNote, setRepackNote] = useState<string>("");

  // ─── Data Loading ──────────────────────────────────────────────────────────

  const loadBatches = async () => {
    try {
      const data = await apiJson<GroceryInboundBatch[]>("/api/v1/grocery/batches");
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
      console.error("Lỗi tải đợt nhập:", err);
    }
  };

  const loadBatchDetail = async (id: number) => {
    try {
      setLoadingBatch(true);
      const data = await apiJson<GroceryInboundBatchDetail>(`/api/v1/grocery/batches/${id}`);
      setBatchDetail(data);
    } catch (err) {
      console.error("Lỗi tải chi tiết đợt:", err);
    } finally {
      setLoadingBatch(false);
    }
  };

  const loadLogs = async () => {
    try {
      setLoadingLogs(true);
      const data = await apiJson<GroceryRepackLog[]>("/api/v1/grocery/repack-logs");
      setAllLogs(data);
    } catch (err) {
      console.error("Lỗi tải nhật ký:", err);
    } finally {
      setLoadingLogs(false);
    }
  };

  const loadProducts = async () => {
    try {
      setLoadingProducts(true);
      const data = await apiJson<GroceryProduct[]>("/api/v1/products?business_unit=GROCERY&limit=100");
      setProducts(data);
    } catch (err) {
      console.error("Lỗi tải sản phẩm hũ:", err);
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => {
    loadBatches();
    loadProducts();
  }, []);

  useEffect(() => {
    if (selectedBatchId) {
      loadBatchDetail(selectedBatchId);
    }
  }, [selectedBatchId]);

  useEffect(() => {
    if (activeTab === "logs") {
      loadLogs();
    }
  }, [activeTab]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = newBatchItems.filter((it) => it.item_name.trim() && Number(it.initial_quantity) > 0);
    if (validItems.length === 0) {
      alert("Vui lòng nhập ít nhất 1 mặt hàng xá với số lượng > 0!");
      return;
    }

    try {
      const res = await apiJson<GroceryInboundBatchDetail>("/api/v1/grocery/batches", {
        method: "POST",
        body: JSON.stringify({
          batch_code: newBatchCode || `LO-${newBatchDate.replace(/-/g, "")}`,
          received_at: `${newBatchDate}T12:00:00Z`,
          supplier: newBatchSupplier,
          notes: newBatchNotes,
          items: validItems.map((it) => ({
            item_name: it.item_name.trim(),
            sku: it.sku.trim(),
            uom: it.uom.trim() || "kg",
            initial_quantity: parseFloat(it.initial_quantity) || 0,
          })),
        }),
      });

      setShowNewBatchModal(false);
      setNewBatchCode("");
      setNewBatchNotes("");
      setNewBatchItems([{ item_name: "", sku: "", uom: "kg", initial_quantity: "" }]);
      await loadBatches();
      setSelectedBatchId(res.id);
    } catch (err: any) {
      alert("Lỗi tạo đợt nhập: " + err.message);
    }
  };

  const handleAddItemToBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBatchId) return;
    if (!addItemName.trim() || Number(addItemQty) <= 0) {
      alert("Vui lòng nhập tên mặt hàng và số lượng > 0");
      return;
    }

    try {
      await apiJson(`/api/v1/grocery/batches/${selectedBatchId}/items`, {
        method: "POST",
        body: JSON.stringify({
          item_name: addItemName.trim(),
          sku: addItemSku.trim(),
          uom: addItemUom.trim() || "kg",
          initial_quantity: parseFloat(addItemQty) || 0,
        }),
      });

      setShowAddItemModal(false);
      setAddItemName("");
      setAddItemSku("");
      setAddItemQty("");
      loadBatchDetail(selectedBatchId);
      loadBatches();
    } catch (err: any) {
      alert("Lỗi thêm mặt hàng: " + err.message);
    }
  };

  const openRepackModal = (item: GroceryInboundItem) => {
    setRepackItem(item);
    setRepackSourceQty(String(item.remaining_quantity));
    setRepackTargetUnits("");
    setRepackTargetProductId("");
    setRepackNote("");
    setShowRepackModal(true);
  };

  const handleRepackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repackItem) return;
    const sourceQty = parseFloat(repackSourceQty) || 0;
    const targetUnits = parseInt(repackTargetUnits) || 0;
    const targetId = parseInt(repackTargetProductId);

    if (sourceQty <= 0) {
      alert("Số lượng xá sử dụng phải lớn hơn 0");
      return;
    }
    if (sourceQty > Number(repackItem.remaining_quantity)) {
      alert(`Số lượng lấy ra (${sourceQty}) vượt quá số xá còn lại (${repackItem.remaining_quantity})!`);
      return;
    }
    if (targetUnits <= 0) {
      alert("Số hũ thành phẩm phải lớn hơn 0");
      return;
    }
    if (!targetId) {
      alert("Vui lòng chọn sản phẩm hũ đích cần đóng");
      return;
    }

    try {
      await apiJson("/api/v1/grocery/repack", {
        method: "POST",
        body: JSON.stringify({
          inbound_item_id: repackItem.id,
          target_product_id: targetId,
          source_qty_used: sourceQty,
          target_units_produced: targetUnits,
          note: repackNote || null,
        }),
      });

      setShowRepackModal(false);
      if (selectedBatchId) {
        loadBatchDetail(selectedBatchId);
        loadBatches();
      }
      loadProducts();
      if (activeTab === "logs") loadLogs();
    } catch (err: any) {
      alert("Lỗi đóng hũ: " + err.message);
    }
  };

  const handleRollbackLog = async (logId: number) => {
    if (!window.confirm("Huỷ lần đóng hũ này? Số lượng xá sẽ được hoàn trả vào đợt nhập, và tồn kho sản phẩm hũ sẽ bị trừ lại.")) {
      return;
    }
    try {
      await apiJson(`/api/v1/grocery/repack/${logId}`, { method: "DELETE" });
      if (selectedBatchId) {
        loadBatchDetail(selectedBatchId);
        loadBatches();
      }
      loadLogs();
      loadProducts();
    } catch (err: any) {
      alert("Lỗi rollback: " + err.message);
    }
  };

  // Yield preview calculation
  const yieldPreview = useMemo(() => {
    const sQty = parseFloat(repackSourceQty) || 0;
    const tUnits = parseInt(repackTargetUnits) || 0;
    if (sQty <= 0 || tUnits <= 0) return null;
    const gramsPerUnit = (sQty * 1000) / tUnits;
    return gramsPerUnit.toFixed(1);
  }, [repackSourceQty, repackTargetUnits]);

  // Filtered products for Tab 3
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products;
    const q = productSearch.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, productSearch]);

  return (
    <div className="container" style={{ paddingBottom: 60 }}>
      {/* Header Banner */}
      <div className="card" style={{ marginBottom: 16, borderLeft: "4px solid #0f766e", background: "white" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: "0 0 4px 0", color: "#0f766e", display: "flex", alignItems: "center", gap: 8 }}>
              🍿 BÁCH HÓA & ĐỒ ĂN VẶT
            </h2>
            <div className="muted" style={{ fontSize: 14 }}>
              Theo dõi đợt nhập hàng xá mới nhất · Đối chiếu: <strong>Tổng Toàn Bộ vs. Đã Chia vs. Tổng Hiện Tại Còn Lại</strong>
            </div>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <button
              className={`btn ${activeTab === "reconcile" ? "primary" : ""}`}
              style={activeTab === "reconcile" ? { background: "#0f766e", borderColor: "#0f766e" } : {}}
              onClick={() => setActiveTab("reconcile")}
            >
              📊 Đợt Nhập & Đối Chiếu
            </button>
            <button
              className={`btn ${activeTab === "logs" ? "primary" : ""}`}
              style={activeTab === "logs" ? { background: "#0f766e", borderColor: "#0f766e" } : {}}
              onClick={() => setActiveTab("logs")}
            >
              📝 Nhật Ký Đóng Hũ
            </button>
            <button
              className={`btn ${activeTab === "products" ? "primary" : ""}`}
              style={activeTab === "products" ? { background: "#0f766e", borderColor: "#0f766e" } : {}}
              onClick={() => setActiveTab("products")}
            >
              🍿 Tồn Kho Hũ ({products.length} SKU)
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: ĐỢT NHẬP & ĐỐI CHIẾU                                               */}
      {/* ========================================================================= */}
      {activeTab === "reconcile" && (
        <div>
          {/* Controls bar: Chọn đợt & Nút Tạo đợt mới */}
          <div className="card" style={{ marginBottom: 16, background: "white" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="row" style={{ gap: 12, alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>📦 Chọn Đợt Nhập:</span>
                <select
                  className="select"
                  style={{ minWidth: 280, fontWeight: 600, fontSize: 14 }}
                  value={selectedBatchId || ""}
                  onChange={(e) => setSelectedBatchId(Number(e.target.value))}
                >
                  {batches.map((b, idx) => (
                    <option key={b.id} value={b.id}>
                      {idx === 0 ? "⭐ [MỚI NHẤT] " : ""}{b.batch_code} ({fmtDateOnly(b.received_at)}) — {b.item_count} mặt hàng
                    </option>
                  ))}
                  {batches.length === 0 && <option value="">(Chưa có đợt nhập nào)</option>}
                </select>
              </div>

              <div className="row" style={{ gap: 8 }}>
                {batchDetail && (
                  <button
                    className="btn"
                    style={{ borderColor: "#0f766e", color: "#0f766e", fontWeight: 600 }}
                    onClick={() => setShowAddItemModal(true)}
                  >
                    + Thêm Hàng Vào Đợt Này
                  </button>
                )}
                <button
                  className="btn primary"
                  style={{ background: "#0f766e", borderColor: "#0f766e", fontWeight: 700 }}
                  onClick={() => setShowNewBatchModal(true)}
                >
                  + Mở Đợt Nhập Hàng Mới
                </button>
              </div>
            </div>
          </div>

          {/* Chi tiết đợt nhập & Bảng Đối Chiếu */}
          {batchDetail ? (
            <div>
              {/* Thẻ Thống Kê Tổng Quan Đợt */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 16,
                  marginBottom: 16,
                }}
              >
                <div className="card" style={{ background: "white", textAlign: "center", borderTop: "4px solid #3b82f6" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>TỔNG TOÀN BỘ (NHẬP VỀ)</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#1d4ed8", marginTop: 4 }}>
                    {fmt(batchDetail.total_initial_qty, 2)}
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>tổng các mặt hàng xá</div>
                </div>

                <div className="card" style={{ background: "white", textAlign: "center", borderTop: "4px solid #f59e0b" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>ĐÃ MÚC RA ĐÓNG HŨ</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#d97706", marginTop: 4 }}>
                    {fmt(batchDetail.total_repacked_qty, 2)}
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>đã quy đổi sang hũ</div>
                </div>

                <div className="card" style={{ background: "white", textAlign: "center", borderTop: "4px solid #10b981" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>TỔNG HIỆN TẠI CÒN LẠI</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#059669", marginTop: 4 }}>
                    {fmt(batchDetail.total_remaining_qty, 2)}
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>xá còn trong kho để đối chiếu</div>
                </div>

                <div className="card" style={{ background: "white", textAlign: "center", borderTop: "4px solid #0f766e" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>TỔNG SỐ HŨ ĐÃ TẠO</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#0f766e", marginTop: 4 }}>
                    {batchDetail.repack_logs.reduce((sum, r) => sum + r.target_units_produced, 0)}
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>hũ thành phẩm nhập kho</div>
                </div>
              </div>

              {/* BẢNG ĐỐI CHIẾU CHÍNH */}
              <div className="card" style={{ background: "white", padding: 0, overflow: "hidden", marginBottom: 24 }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc" }}>
                  <div>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                      📋 Bảng Đối Chiếu Mặt Hàng Xá — Đợt: {batchDetail.batch_code}
                    </span>
                    <span style={{ fontSize: 13, color: "#64748b", marginLeft: 10 }}>
                      (Ngày về: {fmtDateOnly(batchDetail.received_at)} {batchDetail.supplier ? `· Nguồn: ${batchDetail.supplier}` : ""})
                    </span>
                  </div>
                </div>

                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #cbd5e1" }}>
                      <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 13, fontWeight: 700, color: "#334155" }}>Mặt Hàng Xá</th>
                      <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 13, fontWeight: 700, color: "#334155", width: 80 }}>ĐVT</th>
                      <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 13, fontWeight: 700, color: "#1d4ed8", background: "#eff6ff" }}>
                        TỔNG TOÀN BỘ (Nhập về)
                      </th>
                      <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 13, fontWeight: 700, color: "#d97706", background: "#fffbeb" }}>
                        ĐÃ CHIA HŨ
                      </th>
                      <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 13, fontWeight: 700, color: "#047857", background: "#ecfdf5" }}>
                        TỔNG HIỆN TẠI (Còn lại)
                      </th>
                      <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 13, fontWeight: 700, color: "#334155", width: 120 }}>Trạng Thái</th>
                      <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 13, fontWeight: 700, color: "#334155", width: 140 }}>Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchDetail.items.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
                          Chưa có mặt hàng nào trong đợt này. Bấm &quot;+ Thêm Hàng Vào Đợt Này&quot; để bổ sung!
                        </td>
                      </tr>
                    ) : (
                      batchDetail.items.map((it, idx) => {
                        const rem = Number(it.remaining_quantity || 0);
                        const isDone = rem <= 0;
                        return (
                          <tr
                            key={it.id}
                            style={{
                              background: idx % 2 === 0 ? "white" : "#fafafa",
                              borderBottom: "1px solid #f1f5f9",
                            }}
                          >
                            <td style={{ padding: "12px 16px" }}>
                              <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>{it.item_name}</div>
                              {it.sku && <div style={{ fontSize: 12, color: "#64748b" }}>SKU: {it.sku}</div>}
                              {it.notes && <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>{it.notes}</div>}
                            </td>
                            <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: 600, color: "#475569" }}>
                              {it.uom}
                            </td>
                            <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, fontSize: 16, color: "#1d4ed8", background: "#f8faff" }}>
                              {fmt(it.initial_quantity, 3)}
                            </td>
                            <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, fontSize: 16, color: "#d97706", background: "#fffdfa" }}>
                              {fmt(it.repacked_quantity, 3)}
                            </td>
                            <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 800, fontSize: 17, color: isDone ? "#94a3b8" : "#059669", background: "#f4fdf8" }}>
                              {fmt(it.remaining_quantity, 3)}
                            </td>
                            <td style={{ padding: "12px 16px", textAlign: "center" }}>
                              {isDone ? (
                                <span style={{ background: "#f1f5f9", color: "#64748b", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                                  ✓ ĐÃ HẾT
                                </span>
                              ) : (
                                <span style={{ background: "#ecfdf5", color: "#065f46", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                                  ⚡ ĐANG CHIA
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "12px 16px", textAlign: "center" }}>
                              <button
                                className="btn primary"
                                disabled={isDone}
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  padding: "5px 12px",
                                  background: isDone ? "#cbd5e1" : "#0f766e",
                                  borderColor: isDone ? "#cbd5e1" : "#0f766e",
                                }}
                                onClick={() => openRepackModal(it)}
                              >
                                ⚡ Đóng Hũ
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Lịch sử đóng hũ riêng của đợt này */}
              {batchDetail.repack_logs.length > 0 && (
                <div className="card" style={{ background: "white", padding: 0, overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontWeight: 700, color: "#334155" }}>
                    📝 Nhật Ký Đã Đóng Hũ Của Đợt Này ({batchDetail.repack_logs.length} lần)
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ padding: "8px 14px", textAlign: "left" }}>Thời gian</th>
                        <th style={{ padding: "8px 14px", textAlign: "left" }}>Hàng xá đã lấy</th>
                        <th style={{ padding: "8px 14px", textAlign: "left" }}>Thành phẩm hũ đóng được</th>
                        <th style={{ padding: "8px 14px", textAlign: "right" }}>Số lượng hũ</th>
                        <th style={{ padding: "8px 14px", textAlign: "right" }}>Tỷ lệ (g/hũ)</th>
                        <th style={{ padding: "8px 14px", textAlign: "center" }}>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchDetail.repack_logs.map((log) => {
                        const grams = (Number(log.yield_per_unit) * 1000).toFixed(1);
                        return (
                          <tr key={log.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "8px 14px", color: "#64748b" }}>{fmtDate(log.repacked_at)}</td>
                            <td style={{ padding: "8px 14px", fontWeight: 600, color: "#dc2626" }}>
                              -{fmt(log.source_qty_used, 3)} {log.inbound_item_uom} {log.inbound_item_name}
                            </td>
                            <td style={{ padding: "8px 14px", fontWeight: 600, color: "#0f766e" }}>
                              {log.target_product_name}
                            </td>
                            <td style={{ padding: "8px 14px", textAlign: "right", fontWeight: 700, color: "#0f766e" }}>
                              +{log.target_units_produced} hũ
                            </td>
                            <td style={{ padding: "8px 14px", textAlign: "right", color: "#475569" }}>
                              {grams} g/hũ
                            </td>
                            <td style={{ padding: "8px 14px", textAlign: "center" }}>
                              <button
                                className="btn"
                                style={{ fontSize: 11, padding: "2px 8px", color: "#ef4444" }}
                                onClick={() => handleRollbackLog(log.id)}
                              >
                                Huỷ
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="card muted" style={{ textAlign: "center", padding: 60, background: "white" }}>
              {loadingBatch ? "Đang tải dữ liệu đợt nhập..." : "Chưa có đợt nhập nào. Hãy bấm '+ Mở Đợt Nhập Hàng Mới' để bắt đầu ghi nhận và đối chiếu!"}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: NHẬT KÝ ĐÓNG HŨ TOÀN HỆ THỐNG                                     */}
      {/* ========================================================================= */}
      {activeTab === "logs" && (
        <div>
          <div className="card" style={{ background: "white", padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#0f766e" }}>
                📝 Toàn Bộ Nhật Ký Đóng Hũ / Chia Nhỏ ({allLogs.length} lần)
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Ghi nhận chi tiết từng lần múc hàng xá ra chia hũ
              </div>
            </div>

            {loadingLogs ? (
              <div className="muted" style={{ textAlign: "center", padding: 40 }}>Đang tải nhật ký...</div>
            ) : allLogs.length === 0 ? (
              <div className="muted" style={{ textAlign: "center", padding: 40 }}>Chưa có nhật ký đóng hũ nào.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f0fdfa", borderBottom: "2px solid #99f6e4" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 13, color: "#0f766e", fontWeight: 700 }}>Thời Gian</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 13, color: "#0f766e", fontWeight: 700 }}>Đợt Hàng</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 13, color: "#0f766e", fontWeight: 700 }}>Hàng Xá Lấy Ra</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 13, color: "#0f766e", fontWeight: 700 }}>Thành Phẩm Hũ Nhập Kho</th>
                    <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, color: "#0f766e", fontWeight: 700 }}>Số Hũ</th>
                    <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, color: "#0f766e", fontWeight: 700 }}>Quy Cách (g/hũ)</th>
                    <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 13, color: "#0f766e", fontWeight: 700 }}>Thao Tác</th>
                  </tr>
                </thead>
                <tbody>
                  {allLogs.map((r, idx) => {
                    const grams = (Number(r.yield_per_unit) * 1000).toFixed(1);
                    return (
                      <tr key={r.id} style={{ background: idx % 2 === 0 ? "white" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 14px", fontSize: 13, color: "#475569" }}>{fmtDate(r.repacked_at)}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>{r.batch_code}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontWeight: 700, color: "#dc2626" }}>-{fmt(r.source_qty_used, 3)} {r.inbound_item_uom}</span>
                          <span style={{ marginLeft: 6, color: "#0f172a" }}>{r.inbound_item_name}</span>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ fontWeight: 700, color: "#0f766e" }}>{r.target_product_name}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>{r.target_product_sku}</div>
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 800, fontSize: 16, color: "#0f766e" }}>
                          +{r.target_units_produced}
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, color: "#475569" }}>
                          {grams} g/hũ
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <button
                            className="btn"
                            style={{ fontSize: 12, padding: "3px 8px", color: "#ef4444" }}
                            onClick={() => handleRollbackLog(r.id)}
                          >
                            Huỷ & Rollback
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: TỒN KHO THÀNH PHẨM HŨ (35 SKU)                                      */}
      {/* ========================================================================= */}
      {activeTab === "products" && (
        <div>
          <div className="card" style={{ marginBottom: 16, background: "white" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <input
                className="input"
                placeholder="🔍 Tìm sản phẩm hũ..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                style={{ width: 320 }}
              />
              <div style={{ fontSize: 13, color: "#64748b" }}>
                💡 Khi đóng hũ ở Tab Đối Chiếu, tồn kho ở đây sẽ <strong>tự động tăng ngay lập tức</strong>!
              </div>
            </div>
          </div>

          <div className="card" style={{ background: "white", padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f0fdfa", borderBottom: "2px solid #99f6e4" }}>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 13, color: "#0f766e", fontWeight: 700 }}>Tên Sản Phẩm</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 13, color: "#0f766e", fontWeight: 700 }}>SKU</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, color: "#0f766e", fontWeight: 700 }}>Tồn Kho Thực Tế</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, color: "#0f766e", fontWeight: 700 }}>Đơn Giá Bán</th>
                  <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 13, color: "#0f766e", fontWeight: 700 }}>Trạng Thái Tồn</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p, idx) => {
                  const isNeg = p.quantity_on_hand < 0;
                  const isLow = p.quantity_on_hand >= 0 && p.quantity_on_hand < 10;
                  return (
                    <tr key={p.id} style={{ background: idx % 2 === 0 ? "white" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 600, color: "#0f172a" }}>{p.name}</td>
                      <td style={{ padding: "10px 14px", fontSize: 13, color: "#64748b" }}>{p.sku}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        <span
                          style={{
                            fontWeight: 800,
                            fontSize: 18,
                            color: isNeg ? "#dc2626" : isLow ? "#f97316" : "#0f766e",
                          }}
                        >
                          {p.quantity_on_hand}
                        </span>
                        {isNeg && <div style={{ fontSize: 11, color: "#dc2626" }}>⚠ Tồn âm (cần múc xá đóng bù)</div>}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 14 }}>${fmt(p.unit_price)}</td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        {isNeg ? (
                          <span style={{ background: "#fef2f2", color: "#b91c1c", borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>
                            TỒN ÂM
                          </span>
                        ) : isLow ? (
                          <span style={{ background: "#fff7ed", color: "#c2410c", borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>
                            THẤP
                          </span>
                        ) : (
                          <span style={{ background: "#f0fdf4", color: "#15803d", borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 600 }}>
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: MỞ ĐỢT NHẬP HÀNG MỚI                                               */}
      {/* ========================================================================= */}
      {showNewBatchModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 999 }}>
          <div className="card" style={{ width: 620, background: "white", borderRadius: 12, maxHeight: "90vh", overflowY: "auto" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <h3 style={{ margin: 0, color: "#0f766e" }}>📦 Mở Đợt Nhập Hàng Xá Mới</h3>
              <button className="btn" style={{ padding: "4px 8px" }} onClick={() => setShowNewBatchModal(false)}>✕</button>
            </div>

            <form onSubmit={handleCreateBatch}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Mã Đợt (để trống tự sinh):</label>
                  <input
                    className="input"
                    style={{ width: "100%" }}
                    placeholder="VD: CHUYEN-2024-09"
                    value={newBatchCode}
                    onChange={(e) => setNewBatchCode(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Ngày hàng về:</label>
                  <input
                    type="date"
                    className="input"
                    style={{ width: "100%" }}
                    value={newBatchDate}
                    onChange={(e) => setNewBatchDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Nguồn hàng / Nhà cung cấp:</label>
                <input
                  className="input"
                  style={{ width: "100%" }}
                  value={newBatchSupplier}
                  onChange={(e) => setNewBatchSupplier(e.target.value)}
                  placeholder="VD: Hàng Việt Nam container #09"
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#0f766e", marginBottom: 8 }}>
                  Danh sách mặt hàng xá nhập về đợt này:
                </label>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {newBatchItems.map((item, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 32px", gap: 8, alignItems: "center" }}>
                      <input
                        className="input"
                        placeholder="Tên mặt hàng (VD: Khô Bò Xá)"
                        value={item.item_name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewBatchItems((prev) => prev.map((it, i) => (i === idx ? { ...it, item_name: val } : it)));
                        }}
                        required
                      />
                      <input
                        className="input"
                        placeholder="SKU (tùy chọn)"
                        value={item.sku}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewBatchItems((prev) => prev.map((it, i) => (i === idx ? { ...it, sku: val } : it)));
                        }}
                      />
                      <select
                        className="select"
                        value={item.uom}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewBatchItems((prev) => prev.map((it, i) => (i === idx ? { ...it, uom: val } : it)));
                        }}
                      >
                        <option value="kg">kg</option>
                        <option value="thùng">thùng</option>
                        <option value="bao">bao</option>
                        <option value="lb">lb</option>
                      </select>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        className="input"
                        placeholder="Số lượng"
                        style={{ fontWeight: 700 }}
                        value={item.initial_quantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewBatchItems((prev) => prev.map((it, i) => (i === idx ? { ...it, initial_quantity: val } : it)));
                        }}
                        required
                      />
                      {newBatchItems.length > 1 ? (
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: "4px", color: "#ef4444" }}
                          onClick={() => setNewBatchItems((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          ✕
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 8, fontSize: 12, borderColor: "#0f766e", color: "#0f766e" }}
                  onClick={() => setNewBatchItems((prev) => [...prev, { item_name: "", sku: "", uom: "kg", initial_quantity: "" }])}
                >
                  + Thêm dòng mặt hàng
                </button>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Ghi chú đợt:</label>
                <textarea
                  className="input"
                  style={{ width: "100%", height: 50 }}
                  value={newBatchNotes}
                  onChange={(e) => setNewBatchNotes(e.target.value)}
                  placeholder="Ghi chú thêm về chuyến hàng..."
                />
              </div>

              <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn" onClick={() => setShowNewBatchModal(false)}>Huỷ</button>
                <button type="submit" className="btn primary" style={{ background: "#0f766e", borderColor: "#0f766e", fontWeight: 700 }}>
                  Lưu & Mở Đợt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: THÊM HÀNG VÀO ĐỢT HIỆN TẠI                                         */}
      {/* ========================================================================= */}
      {showAddItemModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 999 }}>
          <div className="card" style={{ width: 440, background: "white", borderRadius: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <h3 style={{ margin: 0, color: "#0f766e" }}>+ Thêm Mặt Hàng Vào Đợt</h3>
              <button className="btn" style={{ padding: "4px 8px" }} onClick={() => setShowAddItemModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAddItemToBatch}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Tên mặt hàng xá *</label>
                <input
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="VD: Mận Cơm Xá"
                  value={addItemName}
                  onChange={(e) => setAddItemName(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>SKU</label>
                  <input className="input" style={{ width: "100%" }} value={addItemSku} onChange={(e) => setAddItemSku(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>ĐVT</label>
                  <select className="select" style={{ width: "100%" }} value={addItemUom} onChange={(e) => setAddItemUom(e.target.value)}>
                    <option value="kg">kg</option>
                    <option value="thùng">thùng</option>
                    <option value="bao">bao</option>
                    <option value="lb">lb</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Số lượng *</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    className="input"
                    style={{ width: "100%", fontWeight: 700 }}
                    value={addItemQty}
                    onChange={(e) => setAddItemQty(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn" onClick={() => setShowAddItemModal(false)}>Huỷ</button>
                <button type="submit" className="btn primary" style={{ background: "#0f766e", borderColor: "#0f766e" }}>
                  Thêm Mặt Hàng
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ĐÓNG HŨ / CHIA NHỎ (REPACK)                                        */}
      {/* ========================================================================= */}
      {showRepackModal && repackItem && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 999 }}>
          <div className="card" style={{ width: 520, background: "white", borderRadius: 12, boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <h3 style={{ margin: 0, color: "#0f766e" }}>⚡ Đóng Hũ / Chia Nhỏ Hàng</h3>
              <button className="btn" style={{ padding: "4px 8px" }} onClick={() => setShowRepackModal(false)}>✕</button>
            </div>

            <div style={{ background: "#f0fdfa", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#0f766e" }}>
              📦 Mặt hàng xá: <strong>{repackItem.item_name}</strong>
              <br />
              📊 Tồn xá hiện tại còn: <strong>{fmt(repackItem.remaining_quantity, 3)} {repackItem.uom}</strong> (Tổng đợt nhập: {fmt(repackItem.initial_quantity, 3)} {repackItem.uom})
            </div>

            <form onSubmit={handleRepackSubmit}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  Chọn Sản Phẩm Hũ Đích Cần Đóng *
                </label>
                <select
                  className="select"
                  style={{ width: "100%", fontSize: 14 }}
                  value={repackTargetProductId}
                  onChange={(e) => setRepackTargetProductId(e.target.value)}
                  required
                >
                  <option value="">-- Chọn trong 35 sản phẩm hũ Bách hoá --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} [{p.sku}] (Tồn kho hiện tại: {p.quantity_on_hand})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    Số {repackItem.uom} xá lấy ra *
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    max={Number(repackItem.remaining_quantity)}
                    className="input"
                    style={{ width: "100%", fontSize: 16, fontWeight: 700 }}
                    value={repackSourceQty}
                    onChange={(e) => setRepackSourceQty(e.target.value)}
                    required
                  />
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    Tối đa: {fmt(repackItem.remaining_quantity, 3)} {repackItem.uom}
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    Số hũ sản xuất được *
                  </label>
                  <input
                    type="number"
                    min="1"
                    className="input"
                    style={{ width: "100%", fontSize: 18, fontWeight: 800, color: "#0f766e" }}
                    placeholder="VD: 50"
                    value={repackTargetUnits}
                    onChange={(e) => setRepackTargetUnits(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              </div>

              {/* Yield preview */}
              {yieldPreview && (
                <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 13, color: "#065f46" }}>
                  📊 Quy cách: <strong>~{yieldPreview} g/hũ</strong> · Sau khi đóng, số xá còn lại của đợt này là:{" "}
                  <strong>
                    {(Number(repackItem.remaining_quantity) - (parseFloat(repackSourceQty) || 0)).toFixed(3)} {repackItem.uom}
                  </strong>
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Ghi chú lần đóng:</label>
                <input
                  className="input"
                  style={{ width: "100%" }}
                  value={repackNote}
                  onChange={(e) => setRepackNote(e.target.value)}
                  placeholder="VD: Chia hũ 200g, hao hụt vụn 0.1kg..."
                />
              </div>

              <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn" onClick={() => setShowRepackModal(false)}>Huỷ</button>
                <button type="submit" className="btn primary" style={{ background: "#0f766e", borderColor: "#0f766e", fontWeight: 700 }}>
                  ✅ Xác Nhận Đóng Hũ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
