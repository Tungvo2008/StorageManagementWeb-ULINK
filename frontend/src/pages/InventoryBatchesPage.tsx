import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import type { Product } from "../types";
import Modal from "../components/Modal";

export interface InventoryBatch {
  id: number;
  batch_code: string;
  product_id: number;
  product_sku: string | null;
  product_name: string | null;
  product_uom: string | null;
  expiration_date: string; // YYYY-MM-DD
  manufacture_date: string | null;
  initial_quantity: number;
  quantity_on_hand: number;
  inbound_reference: string | null;
  storage_location: string | null;
  status: "ACTIVE" | "DEPLETED" | "EXPIRED";
  notes: string | null;
  parent_batch_id: number | null;
  parent_batch_code: string | null;
  days_remaining: number | null;
  expiry_status: "EXPIRED" | "CRITICAL" | "WARNING" | "SAFE" | null;
  created_at: string;
  updated_at: string;
}

interface FefoAllocationItem {
  batch_id: number;
  batch_code: string;
  expiration_date: string;
  storage_location: string | null;
  allocated_quantity: number;
  quantity_available: number;
}

interface FefoAllocationResponse {
  product_id: number;
  requested_quantity: number;
  allocated_quantity: number;
  unallocated_quantity: number;
  allocations: FefoAllocationItem[];
}

export default function InventoryBatchesPage() {
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tabs: "list" | "repack" | "fefo"
  const [activeTab, setActiveTab] = useState<"list" | "repack" | "fefo">("list");

  // Filters
  const [search, setSearch] = useState("");
  const [filterExpiry, setFilterExpiry] = useState<"ALL" | "CRITICAL" | "WARNING" | "EXPIRED">("ALL");
  const [filterProduct, setFilterProduct] = useState<string>("");

  // Modal: Thêm Lô Mới
  const [showAddModal, setShowAddModal] = useState(false);
  const [newBatchProductId, setNewBatchProductId] = useState<number | "">("");
  const [newBatchCode, setNewBatchCode] = useState("");
  const [newBatchExpiry, setNewBatchExpiry] = useState("");
  const [newBatchMfg, setNewBatchMfg] = useState("");
  const [newBatchQty, setNewBatchQty] = useState<number | "">(100);
  const [newBatchLocation, setNewBatchLocation] = useState("");
  const [newBatchRef, setNewBatchRef] = useState("");
  const [newBatchNotes, setNewBatchNotes] = useState("");
  const [savingNewBatch, setSavingNewBatch] = useState(false);

  // Modal: Chỉnh Sửa Lô
  const [editingBatch, setEditingBatch] = useState<InventoryBatch | null>(null);
  const [editQty, setEditQty] = useState<number>(0);
  const [editLocation, setEditLocation] = useState("");
  const [editStatus, setEditStatus] = useState<string>("ACTIVE");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Repack Form state
  const [repackSourceBatchId, setRepackSourceBatchId] = useState<number | "">("");
  const [repackSourceQty, setRepackSourceQty] = useState<number | "">(1);
  const [repackTargetProductId, setRepackTargetProductId] = useState<number | "">("");
  const [repackTargetProducedQty, setRepackTargetProducedQty] = useState<number | "">(10);
  const [repackTargetCode, setRepackTargetCode] = useState("");
  const [repackLocation, setRepackLocation] = useState("");
  const [repackNotes, setRepackNotes] = useState("");
  const [submittingRepack, setSubmittingRepack] = useState(false);

  // FEFO Tool state
  const [fefoProductId, setFefoProductId] = useState<number | "">("");
  const [fefoQty, setFefoQty] = useState<number | "">(10);
  const [fefoResult, setFefoResult] = useState<FefoAllocationResponse | null>(null);
  const [loadingFefo, setLoadingFefo] = useState(false);

  // Load data
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [bRes, pRes] = await Promise.all([
        apiJson<InventoryBatch[]>("/api/v1/inventory/batches"),
        apiJson<Product[]>("/api/v1/products"),
      ]);
      setBatches(bRes);
      setProducts(pRes);
    } catch (err: any) {
      setError(err.message || "Không tải được dữ liệu lô hàng");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // KPIs
  const totalCount = batches.length;
  const criticalCount = batches.filter((b) => b.quantity_on_hand > 0 && b.expiry_status === "CRITICAL").length;
  const warningCount = batches.filter((b) => b.quantity_on_hand > 0 && b.expiry_status === "WARNING").length;
  const expiredCount = batches.filter((b) => b.quantity_on_hand > 0 && b.expiry_status === "EXPIRED").length;
  const safeCount = batches.filter((b) => b.quantity_on_hand > 0 && b.expiry_status === "SAFE").length;

  // Filtered batches
  const filteredBatches = useMemo(() => {
    return batches.filter((b) => {
      if (filterExpiry === "CRITICAL" && b.expiry_status !== "CRITICAL") return false;
      if (filterExpiry === "WARNING" && b.expiry_status !== "WARNING") return false;
      if (filterExpiry === "EXPIRED" && b.expiry_status !== "EXPIRED") return false;

      if (filterProduct && String(b.product_id) !== filterProduct) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const code = (b.batch_code || "").toLowerCase();
        const sku = (b.product_sku || "").toLowerCase();
        const name = (b.product_name || "").toLowerCase();
        const loc = (b.storage_location || "").toLowerCase();
        const ref = (b.inbound_reference || "").toLowerCase();
        if (!code.includes(q) && !sku.includes(q) && !name.includes(q) && !loc.includes(q) && !ref.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [batches, search, filterExpiry, filterProduct]);

  // Selected source batch for Repack
  const selectedSourceBatch = useMemo(() => {
    if (!repackSourceBatchId) return null;
    return batches.find((b) => b.id === Number(repackSourceBatchId)) || null;
  }, [batches, repackSourceBatchId]);

  // Handle Add New Batch
  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBatchProductId || !newBatchExpiry || !newBatchQty) {
      alert("Vui lòng điền đầy đủ: Sản phẩm, Hạn sử dụng (Date) và Số lượng!");
      return;
    }
    setSavingNewBatch(true);
    try {
      await apiJson("/api/v1/inventory/batches", {
        method: "POST",
        body: JSON.stringify({
          product_id: Number(newBatchProductId),
          batch_code: newBatchCode.trim() || undefined,
          expiration_date: newBatchExpiry,
          manufacture_date: newBatchMfg || undefined,
          quantity: Number(newBatchQty),
          storage_location: newBatchLocation.trim() || undefined,
          inbound_reference: newBatchRef.trim() || undefined,
          notes: newBatchNotes.trim() || undefined,
        }),
      });
      setShowAddModal(false);
      // Reset form
      setNewBatchCode("");
      setNewBatchExpiry("");
      setNewBatchMfg("");
      setNewBatchQty(100);
      setNewBatchLocation("");
      setNewBatchRef("");
      setNewBatchNotes("");
      await loadData();
      alert("✅ Đã tạo lô hàng mới thành công!");
    } catch (err: any) {
      alert("Lỗi tạo lô: " + err.message);
    } finally {
      setSavingNewBatch(false);
    }
  };

  // Handle Edit Batch
  const handleSaveEdit = async () => {
    if (!editingBatch) return;
    setSavingEdit(true);
    try {
      await apiJson(`/api/v1/inventory/batches/${editingBatch.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          quantity_on_hand: editQty,
          storage_location: editLocation,
          status: editStatus,
          notes: editNotes,
        }),
      });
      setEditingBatch(null);
      await loadData();
      alert("✅ Đã cập nhật lô hàng!");
    } catch (err: any) {
      alert("Lỗi cập nhật: " + err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  // Handle Repack Submit
  const handleExecuteRepack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repackSourceBatchId || !repackSourceQty || !repackTargetProductId || !repackTargetProducedQty) {
      alert("Vui lòng nhập đầy đủ thông tin đóng gói!");
      return;
    }
    setSubmittingRepack(true);
    try {
      const res = await apiJson<InventoryBatch>("/api/v1/inventory/batches/repack", {
        method: "POST",
        body: JSON.stringify({
          source_batch_id: Number(repackSourceBatchId),
          source_quantity_deducted: Number(repackSourceQty),
          target_product_id: Number(repackTargetProductId),
          target_quantity_produced: Number(repackTargetProducedQty),
          target_batch_code: repackTargetCode.trim() || undefined,
          storage_location: repackLocation.trim() || undefined,
          notes: repackNotes.trim() || undefined,
        }),
      });
      alert(`🎉 ĐÓNG GÓI THÀNH CÔNG!\nLô thành phẩm mới: ${res.batch_code}\nĐã tự động kế thừa Date: ${res.expiration_date} từ bao nguồn!`);
      // Reset form
      setRepackSourceBatchId("");
      setRepackSourceQty(1);
      setRepackTargetProductId("");
      setRepackTargetProducedQty(10);
      setRepackTargetCode("");
      setRepackLocation("");
      setRepackNotes("");
      setActiveTab("list");
      await loadData();
    } catch (err: any) {
      alert("Lỗi đóng gói: " + err.message);
    } finally {
      setSubmittingRepack(false);
    }
  };

  // Handle FEFO Allocate Check
  const handleCheckFefo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fefoProductId || !fefoQty) {
      alert("Vui lòng chọn sản phẩm và số lượng cần xuất!");
      return;
    }
    setLoadingFefo(true);
    try {
      const res = await apiJson<FefoAllocationResponse>(
        `/api/v1/inventory/batches/allocate-fefo?product_id=${fefoProductId}&quantity=${fefoQty}`,
        { method: "POST" }
      );
      setFefoResult(res);
    } catch (err: any) {
      alert("Lỗi kiểm tra FEFO: " + err.message);
    } finally {
      setLoadingFefo(false);
    }
  };

  // Helper date format
  const formatDate = (d: string | null) => {
    if (!d) return "—";
    const parts = d.split("-");
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return d;
  };

  return (
    <div style={{ padding: "16px 20px" }}>
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: 10 }}>
            <span>🏷️</span> Quản Lý Hạn Sử Dụng (Date) & Lô Hàng (Batches)
          </h1>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 14 }}>
            Theo dõi Expiry Date container, quy trình đóng gói kế thừa Date (Repack) và xuất kho tự động FEFO.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn"
            onClick={() => void loadData()}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span>🔄</span> Làm mới
          </button>
          <button
            className="btn primary"
            onClick={() => setShowAddModal(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}
          >
            <span>➕</span> Thêm Lô Mới
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 20 }}>
        <div className="card" style={{ padding: "14px 18px", borderLeft: "4px solid #3b82f6", background: "white" }}>
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>TỔNG SỐ LÔ ĐANG QUẢN LÝ</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#1e293b", marginTop: 4 }}>{totalCount} <span style={{ fontSize: 14, fontWeight: 500 }}>lô</span></div>
          <div style={{ fontSize: 12, color: "#10b981", marginTop: 4 }}>🟢 {safeCount} lô an toàn ({">"} 60 ngày)</div>
        </div>

        <div className="card" style={{ padding: "14px 18px", borderLeft: "4px solid #ef4444", background: criticalCount > 0 ? "#fef2f2" : "white" }}>
          <div style={{ fontSize: 13, color: "#b91c1c", fontWeight: 600 }}>CẬN DATE NGUY CẤP (≤ 30 NGÀY)</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#b91c1c", marginTop: 4 }}>{criticalCount} <span style={{ fontSize: 14, fontWeight: 500 }}>lô</span></div>
          <div style={{ fontSize: 12, color: "#7f1d1d", marginTop: 4 }}>Ưu tiên bán nhanh hoặc thanh lý</div>
        </div>

        <div className="card" style={{ padding: "14px 18px", borderLeft: "4px solid #f59e0b", background: warningCount > 0 ? "#fffbeb" : "white" }}>
          <div style={{ fontSize: 13, color: "#b45309", fontWeight: 600 }}>CẦN CHÚ Ý (30 - 60 NGÀY)</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#b45309", marginTop: 4 }}>{warningCount} <span style={{ fontSize: 14, fontWeight: 500 }}>lô</span></div>
          <div style={{ fontSize: 12, color: "#92400e", marginTop: 4 }}>Sắp xếp đẩy hàng FEFO</div>
        </div>

        <div className="card" style={{ padding: "14px 18px", borderLeft: "4px solid #64748b", background: "white" }}>
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>ĐÃ HẾT HẠN (EXPIRED)</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: expiredCount > 0 ? "#ef4444" : "#64748b", marginTop: 4 }}>{expiredCount} <span style={{ fontSize: 14, fontWeight: 500 }}>lô</span></div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Kiểm kê huỷ hoặc trả về</div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div style={{ display: "flex", gap: 10, borderBottom: "1px solid #e2e8f0", marginBottom: 16 }}>
        <button
          className="btn"
          onClick={() => setActiveTab("list")}
          style={{
            borderBottom: activeTab === "list" ? "2px solid #2563eb" : "2px solid transparent",
            borderRadius: "6px 6px 0 0",
            fontWeight: 600,
            background: activeTab === "list" ? "#eff6ff" : "transparent",
            color: activeTab === "list" ? "#1d4ed8" : "#475569",
            padding: "8px 16px",
          }}
        >
          📦 Danh Sách Lô & Hạn Dùng ({batches.length})
        </button>

        <button
          className="btn"
          onClick={() => setActiveTab("repack")}
          style={{
            borderBottom: activeTab === "repack" ? "2px solid #2563eb" : "2px solid transparent",
            borderRadius: "6px 6px 0 0",
            fontWeight: 600,
            background: activeTab === "repack" ? "#eff6ff" : "transparent",
            color: activeTab === "repack" ? "#1d4ed8" : "#475569",
            padding: "8px 16px",
          }}
        >
          🔄 Đóng Gói (Repack Run - Kế Thừa Date)
        </button>

        <button
          className="btn"
          onClick={() => setActiveTab("fefo")}
          style={{
            borderBottom: activeTab === "fefo" ? "2px solid #2563eb" : "2px solid transparent",
            borderRadius: "6px 6px 0 0",
            fontWeight: 600,
            background: activeTab === "fefo" ? "#eff6ff" : "transparent",
            color: activeTab === "fefo" ? "#1d4ed8" : "#475569",
            padding: "8px 16px",
          }}
        >
          🎯 Gợi Ý Xuất Kho FEFO
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: DANH SÁCH LÔ HÀNG (LIST)                                           */}
      {/* ========================================================================= */}
      {activeTab === "list" && (
        <div>
          {/* Filter Bar */}
          <div className="card" style={{ padding: "12px 16px", marginBottom: 16, background: "white" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <input
                  className="input"
                  placeholder="🔍 Tìm mã lô, SKU, tên SP, kệ, cont..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: 280 }}
                />

                <select
                  className="select"
                  value={filterExpiry}
                  onChange={(e) => setFilterExpiry(e.target.value as any)}
                  style={{ width: 200 }}
                >
                  <option value="ALL">Tất cả hạn sử dụng</option>
                  <option value="CRITICAL">🔴 Cận Date Nguy Cấp (≤ 30 ngày)</option>
                  <option value="WARNING">🟡 Cần Chú Ý (30 - 60 ngày)</option>
                  <option value="EXPIRED">⚫ Đã Hết Hạn</option>
                </select>

                <select
                  className="select"
                  value={filterProduct}
                  onChange={(e) => setFilterProduct(e.target.value)}
                  style={{ width: 220 }}
                >
                  <option value="">Tất cả sản phẩm ({products.length})</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} - {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ fontSize: 13, color: "#64748b" }}>
                Hiển thị <strong>{filteredBatches.length}</strong> / {batches.length} lô
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{ background: "white", padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1.5px solid #e2e8f0", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569" }}>Mã Lô (Batch Code)</th>
                    <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569" }}>Sản Phẩm</th>
                    <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", width: 140 }}>Hạn Sử Dụng (Date)</th>
                    <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", width: 120 }}>Tình Trạng Date</th>
                    <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", textAlign: "right" }}>Tồn Kho</th>
                    <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569" }}>Vị Trí Kệ</th>
                    <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569" }}>Nguồn Gốc / Cont</th>
                    <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", width: 90 }}>Thao Tác</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
                        Đang tải danh sách lô hàng...
                      </td>
                    </tr>
                  ) : filteredBatches.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
                        Không có lô hàng nào phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredBatches.map((b) => {
                      // Badge style
                      let badgeBg = "#dcfce7";
                      let badgeColor = "#15803d";
                      let badgeText = `Còn ${b.days_remaining} ngày`;

                      if (b.expiry_status === "EXPIRED") {
                        badgeBg = "#f1f5f9";
                        badgeColor = "#475569";
                        badgeText = "ĐÃ HẾT HẠN";
                      } else if (b.expiry_status === "CRITICAL") {
                        badgeBg = "#fee2e2";
                        badgeColor = "#b91c1c";
                        badgeText = `⚠️ Còn ${b.days_remaining} ngày`;
                      } else if (b.expiry_status === "WARNING") {
                        badgeBg = "#fef3c7";
                        badgeColor = "#b45309";
                        badgeText = `⏳ Còn ${b.days_remaining} ngày`;
                      }

                      const isRepacked = !!b.parent_batch_id;

                      return (
                        <tr key={b.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "10px 14px" }}>
                            <div style={{ fontWeight: 700, color: "#0f172a" }}>{b.batch_code}</div>
                            {isRepacked && (
                              <div style={{ fontSize: 11, color: "#6366f1", marginTop: 2, display: "flex", alignItems: "center", gap: 3 }}>
                                <span>↳ Repack từ:</span> <strong>{b.parent_batch_code}</strong>
                              </div>
                            )}
                          </td>

                          <td style={{ padding: "10px 14px" }}>
                            <div style={{ fontWeight: 600, color: "#1e293b" }}>{b.product_name || "—"}</div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>SKU: {b.product_sku || "—"}</div>
                          </td>

                          <td style={{ padding: "10px 14px" }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                              {formatDate(b.expiration_date)}
                            </div>
                            {b.manufacture_date && (
                              <div style={{ fontSize: 11, color: "#94a3b8" }}>NSX: {formatDate(b.manufacture_date)}</div>
                            )}
                          </td>

                          <td style={{ padding: "10px 14px" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 8px",
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 700,
                                background: badgeBg,
                                color: badgeColor,
                              }}
                            >
                              {badgeText}
                            </span>
                          </td>

                          <td style={{ padding: "10px 14px", textAlign: "right" }}>
                            <div style={{ fontWeight: 700, fontSize: 15, color: b.quantity_on_hand > 0 ? "#0f766e" : "#94a3b8" }}>
                              {b.quantity_on_hand.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 500, color: "#64748b" }}>{b.product_uom || "Pc"}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "#94a3b8" }}>
                              Ban đầu: {b.initial_quantity.toLocaleString()}
                            </div>
                          </td>

                          <td style={{ padding: "10px 14px" }}>
                            <span style={{ background: "#f8fafc", border: "1px solid #e2e8f0", padding: "2px 8px", borderRadius: 4, fontSize: 12, color: "#334155" }}>
                              📍 {b.storage_location || "Chưa gán kệ"}
                            </span>
                          </td>

                          <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 12 }}>
                            {b.inbound_reference || "—"}
                          </td>

                          <td style={{ padding: "10px 14px" }}>
                            <button
                              className="btn"
                              style={{ padding: "3px 8px", fontSize: 11 }}
                              onClick={() => {
                                setEditingBatch(b);
                                setEditQty(b.quantity_on_hand);
                                setEditLocation(b.storage_location || "");
                                setEditStatus(b.status);
                                setEditNotes(b.notes || "");
                              }}
                            >
                              ✏️ Sửa
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: QUY TRÌNH ĐÓNG GÓI THÀNH PHẨM (REPACK RUN - KẾ THỪA DATE)           */}
      {/* ========================================================================= */}
      {activeTab === "repack" && (
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div className="card" style={{ background: "white", padding: 24 }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 18, color: "#0f172a" }}>
              🔄 Quy Trình Đóng Gói / Chia Lô Thành Phẩm (Repack Run)
            </h2>
            <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: 13 }}>
              Xuất bao hàng xá thô để chia nhỏ đóng gói thành phẩm. Hệ thống sẽ <strong>tự động kế thừa Date</strong> của bao nguồn và gắn thẻ truy vết nguồn gốc cha - con.
            </p>

            <form onSubmit={handleExecuteRepack}>
              {/* Step 1: Chọn bao nguồn */}
              <div style={{ marginBottom: 18, padding: 14, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 6, color: "#1e293b" }}>
                  1. Chọn Lô Hàng Xá Nguồn (Bulk / Raw Item):
                </label>
                <select
                  className="select"
                  style={{ width: "100%", marginBottom: 8 }}
                  value={repackSourceBatchId}
                  onChange={(e) => setRepackSourceBatchId(e.target.value ? Number(e.target.value) : "")}
                  required
                >
                  <option value="">-- Chọn lô hàng xá còn tồn kho --</option>
                  {batches
                    .filter((b) => b.quantity_on_hand > 0)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        [{b.batch_code}] {b.product_name} (HSD: {formatDate(b.expiration_date)} | Còn tồn: {b.quantity_on_hand} {b.product_uom})
                      </option>
                    ))}
                </select>

                {selectedSourceBatch && (
                  <div style={{ padding: "8px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 12, color: "#166534" }}>
                    ✅ <strong>Đã nhận diện bao nguồn:</strong> {selectedSourceBatch.product_name} | Hạn sử dụng: <strong>{formatDate(selectedSourceBatch.expiration_date)}</strong> | Tồn hiện tại: <strong>{selectedSourceBatch.quantity_on_hand} {selectedSourceBatch.product_uom}</strong>
                  </div>
                )}

                <div style={{ marginTop: 10 }}>
                  <label style={{ display: "block", fontWeight: 600, fontSize: 12, marginBottom: 4, color: "#475569" }}>
                    Số lượng lấy ra từ bao nguồn để đóng gói:
                  </label>
                  <input
                    type="number"
                    min="1"
                    className="input"
                    value={repackSourceQty}
                    onChange={(e) => setRepackSourceQty(Number(e.target.value) || "")}
                    style={{ width: 180 }}
                    required
                  />
                  <span style={{ marginLeft: 8, fontSize: 12, color: "#64748b" }}>
                    {selectedSourceBatch?.product_uom || "đơn vị nguồn"}
                  </span>
                </div>
              </div>

              {/* Step 2: Chọn thành phẩm đóng gói */}
              <div style={{ marginBottom: 18, padding: 14, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 6, color: "#1e293b" }}>
                  2. Chọn Thành Phẩm Đóng Được (Target Packaged SKU):
                </label>
                <select
                  className="select"
                  style={{ width: "100%", marginBottom: 8 }}
                  value={repackTargetProductId}
                  onChange={(e) => setRepackTargetProductId(e.target.value ? Number(e.target.value) : "")}
                  required
                >
                  <option value="">-- Chọn sản phẩm đóng gói thành phẩm --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.sku}] {p.name} ({p.uom})
                    </option>
                  ))}
                </select>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                  <div>
                    <label style={{ display: "block", fontWeight: 600, fontSize: 12, marginBottom: 4, color: "#475569" }}>
                      Số lượng thành phẩm tạo ra (hũ/lon/gói):
                    </label>
                    <input
                      type="number"
                      min="1"
                      className="input"
                      value={repackTargetProducedQty}
                      onChange={(e) => setRepackTargetProducedQty(Number(e.target.value) || "")}
                      style={{ width: "100%" }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontWeight: 600, fontSize: 12, marginBottom: 4, color: "#475569" }}>
                      Vị trí lưu kho thành phẩm mới:
                    </label>
                    <input
                      className="input"
                      placeholder="vd: Kệ B2, Pallet 04..."
                      value={repackLocation}
                      onChange={(e) => setRepackLocation(e.target.value)}
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
              </div>

              {/* Step 3: Date Preview box */}
              {selectedSourceBatch && (
                <div style={{ padding: 14, background: "#eff6ff", border: "1.5px dashed #3b82f6", borderRadius: 8, marginBottom: 20 }}>
                  <div style={{ fontWeight: 700, color: "#1e40af", fontSize: 13, marginBottom: 4 }}>
                    💡 Kế Thừa Hạn Sử Dụng Tự Động (Date Inheritance):
                  </div>
                  <div style={{ fontSize: 13, color: "#1e3a8a" }}>
                    Lô thành phẩm mới sẽ tự động nhận đúng HSD: <strong style={{ fontSize: 15, color: "#b91c1c" }}>{formatDate(selectedSourceBatch.expiration_date)}</strong> (Ngày đóng gói: Hôm nay {new Date().toLocaleDateString("vi-VN")}).
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setActiveTab("list")}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={submittingRepack || !selectedSourceBatch}
                  style={{ fontWeight: 700, padding: "8px 24px" }}
                >
                  {submittingRepack ? "⏳ Đang thực hiện..." : "🚀 Xác Nhận Đóng Gói"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: GỢI Ý XUẤT KHO CHUẨN FEFO (FIRST EXPIRED, FIRST OUT)                 */}
      {/* ========================================================================= */}
      {activeTab === "fefo" && (
        <div style={{ maxWidth: 840, margin: "0 auto" }}>
          <div className="card" style={{ background: "white", padding: 24, marginBottom: 20 }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 18, color: "#0f172a" }}>
              🎯 Kiểm Tra Xuất Hàng FEFO (First Expired, First Out)
            </h2>
            <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: 13 }}>
              Nhập số lượng đơn hàng cần xuất. Thuật toán FEFO sẽ quét các lô hàng đang tồn và chỉ định nhân viên kho bốc đúng lô có <strong>hạn sử dụng gần nhất trước</strong>.
            </p>

            <form onSubmit={handleCheckFefo} style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#334155" }}>
                  Sản phẩm cần xuất:
                </label>
                <select
                  className="select"
                  style={{ width: "100%" }}
                  value={fefoProductId}
                  onChange={(e) => setFefoProductId(e.target.value ? Number(e.target.value) : "")}
                  required
                >
                  <option value="">-- Chọn sản phẩm --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.sku}] {p.name} (Tồn: {p.quantity_on_hand} {p.uom})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ width: 140 }}>
                <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#334155" }}>
                  Số lượng xuất:
                </label>
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={fefoQty}
                  onChange={(e) => setFefoQty(Number(e.target.value) || "")}
                  style={{ width: "100%" }}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn primary"
                disabled={loadingFefo}
                style={{ fontWeight: 700, padding: "8px 20px" }}
              >
                {loadingFefo ? "⏳ Đang quét..." : "🔍 Phân Bổ FEFO"}
              </button>
            </form>
          </div>

          {/* FEFO Pick List Output */}
          {fefoResult && (
            <div className="card" style={{ background: "white", padding: 24, border: "1.5px solid #3b82f6" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: "#1e3a8a", fontWeight: 700 }}>
                  📋 Danh Sách Chỉ Định Bốc Hàng (Pick List)
                </h3>
                <span
                  style={{
                    padding: "3px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    background: fefoResult.unallocated_quantity === 0 ? "#dcfce7" : "#fee2e2",
                    color: fefoResult.unallocated_quantity === 0 ? "#15803d" : "#b91c1c",
                  }}
                >
                  {fefoResult.unallocated_quantity === 0
                    ? `✓ Đủ hàng (Đã phân bổ ${fefoResult.allocated_quantity})`
                    : `⚠️ Thiếu ${fefoResult.unallocated_quantity} cái`}
                </span>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1.5px solid #cbd5e1", textAlign: "left" }}>
                    <th style={{ padding: "8px 10px", fontWeight: 700 }}>Thứ tự ưu tiên</th>
                    <th style={{ padding: "8px 10px", fontWeight: 700 }}>Mã Lô</th>
                    <th style={{ padding: "8px 10px", fontWeight: 700 }}>Hạn Sử Dụng (Date)</th>
                    <th style={{ padding: "8px 10px", fontWeight: 700 }}>Vị Trí Kệ</th>
                    <th style={{ padding: "8px 10px", fontWeight: 700, textAlign: "right" }}>Số lượng cần bốc</th>
                  </tr>
                </thead>
                <tbody>
                  {fefoResult.allocations.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>
                        Không tìm thấy lô hàng nào còn tồn cho sản phẩm này!
                      </td>
                    </tr>
                  ) : (
                    fefoResult.allocations.map((item, idx) => (
                      <tr key={item.batch_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 10px", fontWeight: 700, color: "#2563eb" }}>#{idx + 1}</td>
                        <td style={{ padding: "8px 10px", fontWeight: 700 }}>{item.batch_code}</td>
                        <td style={{ padding: "8px 10px", color: "#b91c1c", fontWeight: 600 }}>{formatDate(item.expiration_date)}</td>
                        <td style={{ padding: "8px 10px" }}>📍 {item.storage_location || "Chưa gán"}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, fontSize: 15, color: "#0f766e" }}>
                          {item.allocated_quantity} <span style={{ fontSize: 11, fontWeight: 500, color: "#64748b" }}>đơn vị</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: THÊM LÔ MỚI TRỰC TIẾP                                             */}
      {/* ========================================================================= */}
      {showAddModal && (
        <Modal open={showAddModal} title="➕ Thêm Lô Hàng / Container Mới" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleCreateBatch}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Sản Phẩm (*):
              </label>
              <select
                className="select"
                style={{ width: "100%" }}
                value={newBatchProductId}
                onChange={(e) => setNewBatchProductId(e.target.value ? Number(e.target.value) : "")}
                required
              >
                <option value="">-- Chọn sản phẩm --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.sku}] {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  Hạn Sử Dụng (Date) (*):
                </label>
                <input
                  type="date"
                  className="input"
                  style={{ width: "100%" }}
                  value={newBatchExpiry}
                  onChange={(e) => setNewBatchExpiry(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  Ngày Sản Xuất (tùy chọn):
                </label>
                <input
                  type="date"
                  className="input"
                  style={{ width: "100%" }}
                  value={newBatchMfg}
                  onChange={(e) => setNewBatchMfg(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  Số Lượng Nhập (*):
                </label>
                <input
                  type="number"
                  min="1"
                  className="input"
                  style={{ width: "100%" }}
                  value={newBatchQty}
                  onChange={(e) => setNewBatchQty(Number(e.target.value) || "")}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  Mã Lô (để trống tự sinh):
                </label>
                <input
                  className="input"
                  placeholder="vd: LOT-202610-01"
                  style={{ width: "100%" }}
                  value={newBatchCode}
                  onChange={(e) => setNewBatchCode(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  Vị Trí Kệ / Pallet:
                </label>
                <input
                  className="input"
                  placeholder="vd: Kệ A1, Pallet 02"
                  style={{ width: "100%" }}
                  value={newBatchLocation}
                  onChange={(e) => setNewBatchLocation(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  Số Cont / Phiếu Nhập:
                </label>
                <input
                  className="input"
                  placeholder="vd: Cont #OOLU-8821"
                  style={{ width: "100%" }}
                  value={newBatchRef}
                  onChange={(e) => setNewBatchRef(e.target.value)}
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Ghi Chú:
              </label>
              <textarea
                className="input"
                rows={2}
                style={{ width: "100%" }}
                value={newBatchNotes}
                onChange={(e) => setNewBatchNotes(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" onClick={() => setShowAddModal(false)}>
                Hủy
              </button>
              <button type="submit" className="btn primary" disabled={savingNewBatch}>
                {savingNewBatch ? "⏳ Đang lưu..." : "Lưu Lô Hàng"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CHỈNH SỬA LÔ                                                       */}
      {/* ========================================================================= */}
      {editingBatch && (
        <Modal open={!!editingBatch} title={`✏️ Sửa Lô Hàng: ${editingBatch.batch_code}`} onClose={() => setEditingBatch(null)}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              Sản phẩm: <strong>{editingBatch.product_name}</strong> | HSD: <strong>{formatDate(editingBatch.expiration_date)}</strong>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Tồn Kho Thực Tế:
              </label>
              <input
                type="number"
                min="0"
                className="input"
                style={{ width: "100%" }}
                value={editQty}
                onChange={(e) => setEditQty(Number(e.target.value) || 0)}
              />
            </div>

            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Vị Trí Kệ:
              </label>
              <input
                className="input"
                style={{ width: "100%" }}
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Trạng Thái Lô:
            </label>
            <select
              className="select"
              style={{ width: "100%" }}
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
            >
              <option value="ACTIVE">🟢 Đang hoạt động (ACTIVE)</option>
              <option value="DEPLETED">⚪ Đã xuất hết (DEPLETED)</option>
              <option value="EXPIRED">⚫ Đã hết hạn (EXPIRED)</option>
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Ghi Chú:
            </label>
            <textarea
              className="input"
              rows={2}
              style={{ width: "100%" }}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn" onClick={() => setEditingBatch(null)}>
              Hủy
            </button>
            <button type="button" className="btn primary" onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? "⏳ Đang lưu..." : "Cập Nhật"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
