import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { apiJson, apiUpload, downloadFile, assetUrl } from "../api/client";
import type { InventoryReceipt, Product } from "../types";
import { getCurrentUsername } from "../auth";
import Modal from "../components/Modal";
import type { SortState } from "../utils/table";
import { matchesQuery, sortBy, toggleSort } from "../utils/table";

type WorkflowType = "CONTAINER" | "GROCERY" | "BULK" | "STANDARD";

type ReceiptLineDraft = {
  product_id: number | null;
  quantity: number;
  unit: "BASE" | "SALE";
  unit_cost: string;
  note?: string | null;
  // Specialized fields
  lot_number?: string;
  expiry_date?: string; // YYYY-MM-DD
  carton_count?: number;
  pieces_per_carton?: number;
  allocated_cost?: string;
};

type ReceiptDraft = {
  receipt_type: WorkflowType;
  receipt_number?: string | null;
  supplier_name?: string | null;
  container_number?: string | null;
  container_cost?: string;
  received_at?: string | null; // datetime-local
  received_by?: string | null;
  note?: string | null;
  lines: ReceiptLineDraft[];
};

function toIsoFromLocal(dtLocal: string | null | undefined): string | null {
  if (!dtLocal) return null;
  const d = new Date(dtLocal);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function InventoryReceivePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [receipts, setReceipts] = useState<InventoryReceipt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<InventoryReceipt | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const currentUsername = useMemo(() => getCurrentUsername(), []);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | WorkflowType>("ALL");
  const [sort, setSort] = useState<SortState<"id" | "received_at" | "received_by" | "receipt_number" | "line_count">>({
    key: "id",
    dir: "desc",
  });

  const [form, setForm] = useState<ReceiptDraft>({
    receipt_type: "CONTAINER",
    receipt_number: "",
    supplier_name: "",
    container_number: "",
    container_cost: "0",
    received_at: "",
    received_by: currentUsername,
    note: "",
    lines: [
      {
        product_id: null,
        quantity: 100,
        unit: "BASE",
        unit_cost: "1.50",
        carton_count: 5,
        pieces_per_carton: 20,
        allocated_cost: "0",
      },
    ],
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, r] = await Promise.all([
        apiJson<Product[]>("/api/v1/products"),
        apiJson<InventoryReceipt[]>("/api/v1/inventory/receipts?limit=100"),
      ]);
      setProducts(p);
      setReceipts(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);



  const displayedReceipts = useMemo(() => {
    const filtered = receipts.filter((r) => {
      if (typeFilter !== "ALL" && (r.receipt_type || "STANDARD") !== typeFilter) {
        return false;
      }
      return matchesQuery(
        query,
        r.id,
        r.receipt_type,
        r.supplier_name,
        r.container_number,
        r.received_at,
        r.received_by,
        r.receipt_number,
        r.lines.length,
      );
    });

    return sortBy(
      filtered,
      (r) => {
        switch (sort.key) {
          case "id":
            return r.id;
          case "received_at":
            return new Date(r.received_at).getTime();
          case "received_by":
            return r.received_by ?? "";
          case "receipt_number":
            return r.receipt_number ?? "";
          case "line_count":
            return r.lines.length;
          default:
            return r.id;
        }
      },
      sort.dir,
    );
  }, [receipts, query, typeFilter, sort]);

  function mark(col: typeof sort.key): string {
    if (sort.key !== col) return "";
    return sort.dir === "asc" ? " ↑" : " ↓";
  }

  async function onImportFile(f: File) {
    setImportBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await apiUpload<InventoryReceipt>("/api/v1/inventory/receipts/import", fd);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }

  function addLine() {
    if (form.receipt_type === "CONTAINER") {
      setForm((s) => ({
        ...s,
        lines: [
          ...s.lines,
          {
            product_id: null,
            quantity: 100,
            unit: "BASE",
            unit_cost: "1.50",
            carton_count: 5,
            pieces_per_carton: 20,
            allocated_cost: "0",
          },
        ],
      }));
    } else if (form.receipt_type === "GROCERY") {
      setForm((s) => ({
        ...s,
        lines: [
          ...s.lines,
          {
            product_id: null,
            quantity: 10,
            unit: "SALE",
            unit_cost: "5.00",
            lot_number: "",
            expiry_date: "",
          },
        ],
      }));
    } else {
      setForm((s) => ({
        ...s,
        lines: [...s.lines, { product_id: null, quantity: 1, unit: "BASE", unit_cost: "0" }],
      }));
    }
  }

  function removeLine(idx: number) {
    setForm((s) => ({ ...s, lines: s.lines.filter((_, i) => i !== idx) }));
  }

  function openReceiptDetail(r: InventoryReceipt) {
    setSelectedReceipt(r);
    setDetailOpen(true);
  }

  async function onDeleteReceipt(receiptId: number) {
    const ok = window.confirm(`Xoá phiếu nhập #${receiptId}? Tồn kho sẽ được rollback tự động.`);
    if (!ok) return;
    setError(null);
    try {
      await apiJson<void>(`/api/v1/inventory/receipts/${receiptId}`, { method: "DELETE" });
      if (selectedReceipt?.id === receiptId) {
        setDetailOpen(false);
        setSelectedReceipt(null);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const lines = form.lines
      .filter((l) => l.product_id != null)
      .map((l) => ({
        product_id: l.product_id as number,
        quantity: l.quantity,
        unit: l.unit,
        unit_cost: l.unit_cost,
        note: l.note ?? null,
        lot_number: l.lot_number || null,
        expiry_date: l.expiry_date || null,
        carton_count: l.carton_count || null,
        pieces_per_carton: l.pieces_per_carton || null,
        allocated_cost: l.allocated_cost || "0",
      }));

    if (lines.length === 0) {
      setError("Chưa chọn sản phẩm nào để nhập kho.");
      return;
    }

    try {
      await apiJson<InventoryReceipt>("/api/v1/inventory/receipts", {
        method: "POST",
        body: JSON.stringify({
          receipt_type: form.receipt_type,
          receipt_number: (form.receipt_number ?? "").trim() || null,
          supplier_name: (form.supplier_name ?? "").trim() || null,
          container_number: (form.container_number ?? "").trim() || null,
          container_cost: parseFloat(form.container_cost || "0") || 0,
          received_at: toIsoFromLocal(form.received_at),
          received_by: (form.received_by ?? "").trim() || null,
          note: (form.note ?? "").trim() || null,
          lines,
        }),
      });

      setCreateOpen(false);
      setForm({
        receipt_type: "CONTAINER",
        receipt_number: "",
        supplier_name: "",
        container_number: "",
        container_cost: "0",
        received_at: "",
        received_by: currentUsername,
        note: "",
        lines: [{ product_id: null, quantity: 100, unit: "BASE", unit_cost: "1.50", carton_count: 5, pieces_per_carton: 20 }],
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Top Header Card */}
      <div className="card" style={{ background: "white" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ margin: "0 0 4px 0", color: "#1e293b", display: "flex", alignItems: "center", gap: 8 }}>
              <span>📥</span> Quản Lý Nhập Kho (Inventory Receipts Hub)
            </h2>
            <div className="muted" style={{ fontSize: 13 }}>
              Hỗ trợ 4 quy trình nhập chuẩn: 🚢 Container FCL Khăn/Dép, 🍿 Bách Hóa / Đồ Ăn Vặt (Theo Đợt Nhập & Quy Cách), ⚖️ Hàng Xá và 📦 Tiêu Chuẩn.
            </div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label className="btn" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <span>📤</span> {importBusy ? "Đang import..." : "Import Excel"}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: "none" }}
                disabled={importBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImportFile(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button
              className="btn"
              onClick={() => void downloadFile("/api/v1/inventory/receipts/template", "mau_nhap_kho.xlsx")}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <span>📄</span> Tải File Mẫu
            </button>
            <button
              className="btn primary"
              onClick={() => setCreateOpen(true)}
              style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}
            >
              <span>➕</span> Tạo Phiếu Nhập Mới
            </button>
          </div>
        </div>

        {/* 4 KPIs Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 16 }}>
          <div className="card" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", padding: "12px 16px" }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>TỔNG SỐ PHIẾU NHẬP</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#1e293b", marginTop: 4 }}>
              {receipts.length} <span style={{ fontSize: 13, fontWeight: 500, color: "#64748b" }}>phiếu</span>
            </div>
          </div>

          <div className="card" style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "12px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#1e40af" }}>🚢 NHẬP CONTAINER (FCL)</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#1d4ed8", marginTop: 4 }}>
              {receipts.filter((r) => r.receipt_type === "CONTAINER").length}{" "}
              <span style={{ fontSize: 13, fontWeight: 500 }}>cont</span>
            </div>
          </div>

          <div className="card" style={{ background: "#fef3c7", border: "1px solid #fde68a", padding: "12px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#92400e" }}>🍿 BÁCH HÓA / ĂN VẶT</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#b45309", marginTop: 4 }}>
              {receipts.filter((r) => r.receipt_type === "GROCERY").length}{" "}
              <span style={{ fontSize: 13, fontWeight: 500 }}>đợt nhập</span>
            </div>
          </div>

          <div className="card" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "12px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#166534" }}>📦 TIÊU CHUẨN & KHÁC</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#15803d", marginTop: 4 }}>
              {receipts.filter((r) => !r.receipt_type || r.receipt_type === "STANDARD" || r.receipt_type === "BULK").length}{" "}
              <span style={{ fontSize: 13, fontWeight: 500 }}>phiếu</span>
            </div>
          </div>
        </div>
      </div>



      {/* Receipts Table Card */}
      <div className="card" style={{ background: "white" }}>
        {/* Filter bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          {/* Workflow Filter Pills */}
          <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Lọc theo quy trình:</span>
            <button
              type="button"
              className={`btn ${typeFilter === "ALL" ? "primary" : ""}`}
              style={{ padding: "4px 10px", fontSize: 12, borderRadius: 6 }}
              onClick={() => setTypeFilter("ALL")}
            >
              Tất Cả ({receipts.length})
            </button>
            <button
              type="button"
              className={`btn ${typeFilter === "CONTAINER" ? "primary" : ""}`}
              style={{ padding: "4px 10px", fontSize: 12, borderRadius: 6 }}
              onClick={() => setTypeFilter("CONTAINER")}
            >
              🚢 Container FCL ({receipts.filter((r) => r.receipt_type === "CONTAINER").length})
            </button>
            <button
              type="button"
              className={`btn ${typeFilter === "GROCERY" ? "primary" : ""}`}
              style={{ padding: "4px 10px", fontSize: 12, borderRadius: 6 }}
              onClick={() => setTypeFilter("GROCERY")}
            >
              🍿 Bách Hóa / Ăn Vặt ({receipts.filter((r) => r.receipt_type === "GROCERY").length})
            </button>
            <button
              type="button"
              className={`btn ${typeFilter === "BULK" ? "primary" : ""}`}
              style={{ padding: "4px 10px", fontSize: 12, borderRadius: 6 }}
              onClick={() => setTypeFilter("BULK")}
            >
              ⚖️ Hàng Xá ({receipts.filter((r) => r.receipt_type === "BULK").length})
            </button>
            <button
              type="button"
              className={`btn ${typeFilter === "STANDARD" ? "primary" : ""}`}
              style={{ padding: "4px 10px", fontSize: 12, borderRadius: 6 }}
              onClick={() => setTypeFilter("STANDARD")}
            >
              📦 Tiêu Chuẩn ({receipts.filter((r) => !r.receipt_type || r.receipt_type === "STANDARD").length})
            </button>
          </div>

          <div style={{ flex: "0 1 300px" }}>
            <input
              className="input"
              style={{ width: "100%", padding: "6px 10px", fontSize: 13 }}
              placeholder="🔍 Tìm theo mã phiếu, số cont, NCC, người nhận..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left", color: "#475569", borderBottom: "2px solid #e2e8f0" }}>
                <th style={{ width: 65, padding: "8px 10px" }}>
                  <button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "id"))}>
                    #ID{mark("id")}
                  </button>
                </th>
                <th style={{ width: 140, padding: "8px 10px" }}>Loại Quy Trình</th>
                <th style={{ width: 170, padding: "8px 10px" }}>
                  <button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "receipt_number"))}>
                    Mã Phiếu / Số Cont{mark("receipt_number")}
                  </button>
                </th>
                <th style={{ padding: "8px 10px" }}>Nhà Cung Cấp / Xưởng</th>
                <th style={{ width: 150, padding: "8px 10px" }}>
                  <button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "received_at"))}>
                    Thời Gian Nhận{mark("received_at")}
                  </button>
                </th>
                <th style={{ width: 120, padding: "8px 10px" }}>
                  <button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "received_by"))}>
                    Người Nhận{mark("received_by")}
                  </button>
                </th>
                <th className="right" style={{ width: 100, padding: "8px 10px" }}>
                  <button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "line_count"))}>
                    Số Dòng{mark("line_count")}
                  </button>
                </th>
                <th className="right" style={{ width: 140, padding: "8px 10px" }}>Tổng Số Lượng</th>
                <th style={{ width: 130, padding: "8px 10px", textAlign: "center" }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {displayedReceipts.map((r) => {
                const totalAmt = r.lines.reduce((s, l) => s + parseFloat(l.line_total || "0"), 0);
                const rType = r.receipt_type || "STANDARD";

                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 700, color: "#64748b" }}>#{r.id}</td>
                    <td style={{ padding: "8px 10px" }}>
                      {rType === "CONTAINER" ? (
                        <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#eff6ff", color: "#1d4ed8" }}>
                          🚢 Cont FCL
                        </span>
                      ) : rType === "GROCERY" ? (
                        <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#fef3c7", color: "#b45309" }}>
                          🍿 Bách Hóa
                        </span>
                      ) : rType === "BULK" ? (
                        <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#f3e8ff", color: "#7e22ce" }}>
                          ⚖️ Hàng Xá
                        </span>
                      ) : (
                        <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#f0fdf4", color: "#166534" }}>
                          📦 Tiêu Chuẩn
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <div style={{ fontWeight: 700, color: "#1e3a8a" }}>
                        {r.receipt_number || `PN-${r.id}`}
                      </div>
                      {r.container_number && (
                        <div style={{ fontSize: 11, color: "#0284c7", fontWeight: 600 }}>
                          Cont: {r.container_number}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px 10px", color: "#334155" }}>
                      {r.supplier_name || "--"}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 12, color: "#475569", whiteSpace: "nowrap" }}>
                      {new Date(r.received_at).toLocaleString("vi-VN", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 12 }}>{r.received_by || "--"}</td>
                    <td className="right" style={{ padding: "8px 10px", fontWeight: 600 }}>
                      {r.lines.length} món
                    </td>
                    <td className="right" style={{ padding: "8px 10px", fontWeight: 700, color: "#15803d", fontSize: 14 }}>
                      +{r.lines.reduce((s, l) => s + (l.quantity * (l.uom_multiplier || 1)), 0).toLocaleString()} <span style={{ fontSize: 11, fontWeight: 500, color: "#64748b" }}>cái</span>
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>
                      <div className="row" style={{ gap: 6, justifyContent: "center" }}>
                        <button
                          className="btn"
                          style={{ padding: "3px 8px", fontSize: 12 }}
                          onClick={() => openReceiptDetail(r)}
                        >
                          👁️ Chi Tiết
                        </button>
                        <button
                          className="btn"
                          style={{ padding: "3px 8px", fontSize: 12, color: "#dc2626", borderColor: "#fca5a5" }}
                          onClick={() => void onDeleteReceipt(r.id)}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && displayedReceipts.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "36px 12px", color: "#94a3b8" }}>
                    Chưa có phiếu nhập nào khớp với bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Tạo Phiếu Nhập Chuyên Nghiệp */}
      <Modal open={createOpen} title="Tạo Phiếu Nhập Kho Mới" onClose={() => setCreateOpen(false)}>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Quy Trình Selector Pills */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6, color: "#475569" }}>
              CHỌN QUY TRÌNH NHẬP KHO:
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
              <button
                type="button"
                className={`btn ${form.receipt_type === "CONTAINER" ? "primary" : ""}`}
                style={{ padding: "8px", fontSize: 12, fontWeight: 700, textAlign: "center" }}
                onClick={() => setForm((s) => ({ ...s, receipt_type: "CONTAINER" }))}
              >
                🚢 Cont FCL (Khăn/Dép)
              </button>
              <button
                type="button"
                className={`btn ${form.receipt_type === "GROCERY" ? "primary" : ""}`}
                style={{ padding: "8px", fontSize: 12, fontWeight: 700, textAlign: "center" }}
                onClick={() => setForm((s) => ({ ...s, receipt_type: "GROCERY" }))}
              >
                🍿 Bách Hóa / Ăn Vặt
              </button>
              <button
                type="button"
                className={`btn ${form.receipt_type === "BULK" ? "primary" : ""}`}
                style={{ padding: "8px", fontSize: 12, fontWeight: 700, textAlign: "center" }}
                onClick={() => setForm((s) => ({ ...s, receipt_type: "BULK" }))}
              >
                ⚖️ Hàng Xá (Bao Tải)
              </button>
              <button
                type="button"
                className={`btn ${form.receipt_type === "STANDARD" ? "primary" : ""}`}
                style={{ padding: "8px", fontSize: 12, fontWeight: 700, textAlign: "center" }}
                onClick={() => setForm((s) => ({ ...s, receipt_type: "STANDARD" }))}
              >
                📦 Tiêu Chuẩn Nhanh
              </button>
            </div>
          </div>

          {/* Form Header Inputs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Mã Phiếu Nhập:</label>
              <input
                className="input"
                style={{ width: "100%" }}
                placeholder="VD: PN-CONT-2026-01 (để trống tự sinh)"
                value={form.receipt_number ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, receipt_number: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Nhà Cung Cấp / Xưởng:</label>
              <input
                className="input"
                style={{ width: "100%" }}
                placeholder="VD: Xưởng Dệt Nam Định / NCC SG"
                value={form.supplier_name ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, supplier_name: e.target.value }))}
              />
            </div>
          </div>

          {/* Container specific inputs */}
          {form.receipt_type === "CONTAINER" && (
            <div style={{ padding: "10px 12px", background: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe" }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1e40af", marginBottom: 4 }}>
                  🚢 Số Container (FCL) & Ký Hiệu Lô Hàng:
                </label>
                <input
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="VD: TCLU1234567 hoặc OOLU9876543 (Cont 40HC Khăn Cập Cảng)"
                  value={form.container_number ?? ""}
                  onChange={(e) => setForm((s) => ({ ...s, container_number: e.target.value }))}
                />
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Thời Gian Nhận:</label>
              <input
                type="datetime-local"
                className="input"
                style={{ width: "100%" }}
                value={form.received_at ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, received_at: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Người Nhận Hàng:</label>
              <input
                className="input"
                style={{ width: "100%" }}
                value={form.received_by ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, received_by: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Ghi Chú Chung:</label>
            <input
              className="input"
              style={{ width: "100%" }}
              placeholder="VD: Nhập lô hàng đợt 1 / cont khăn 40HC cập cảng"
              value={form.note ?? ""}
              onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
            />
          </div>

          {/* Lines section */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                DANH SÁCH MẶT HÀNG NHẬP ({form.lines.length} dòng):
              </span>
              <button type="button" className="btn" style={{ fontSize: 12, padding: "4px 8px" }} onClick={addLine}>
                ➕ Thêm Dòng
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto", paddingRight: 4 }}>
              {form.lines.map((l, idx) => {
                const prod = l.product_id != null ? productById.get(l.product_id) : undefined;
                return (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: "8px 10px",
                      background: "#f8fafc",
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {/* Product select */}
                      <select
                        className="input"
                        style={{ flex: 2 }}
                        value={l.product_id ?? ""}
                        onChange={(e) => {
                          const pid = e.target.value ? parseInt(e.target.value) : null;
                          const p = pid != null ? productById.get(pid) : undefined;
                          setForm((s) => ({
                            ...s,
                            lines: s.lines.map((line, i) =>
                              i === idx
                                ? {
                                    ...line,
                                    product_id: pid,
                                    unit_cost: p ? String(p.cost_price ?? "0") : line.unit_cost,
                                  }
                                : line,
                            ),
                          }));
                        }}
                        required
                      >
                        <option value="">-- Chọn Sản Phẩm ({products.length} SP) --</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} — {p.name} (Tồn: {p.quantity_on_hand} {p.base_uom})
                          </option>
                        ))}
                      </select>

                      {/* Quantity */}
                      <div style={{ width: 100 }}>
                        <input
                          type="number"
                          className="input"
                          style={{ width: "100%" }}
                          placeholder="Số lượng"
                          min={1}
                          value={l.quantity}
                          onChange={(e) => {
                            const val = Math.max(1, parseInt(e.target.value) || 1);
                            setForm((s) => ({
                              ...s,
                              lines: s.lines.map((line, i) => (i === idx ? { ...line, quantity: val } : line)),
                            }));
                          }}
                          required
                        />
                      </div>

                      {/* Unit */}
                      <div style={{ width: 85 }}>
                        <select
                          className="input"
                          style={{ width: "100%" }}
                          value={l.unit}
                          onChange={(e) => {
                            const u = e.target.value as "BASE" | "SALE";
                            setForm((s) => ({
                              ...s,
                              lines: s.lines.map((line, i) => (i === idx ? { ...line, unit: u } : line)),
                            }));
                          }}
                        >
                          <option value="BASE">Cơ sở ({prod?.base_uom || "Pc"})</option>
                          <option value="SALE">Bán lẻ ({prod?.uom || "Unit"})</option>
                        </select>
                      </div>

                      {/* Line Note */}
                      <div style={{ flex: 1 }}>
                        <input
                          type="text"
                          className="input"
                          style={{ width: "100%", padding: "6px 8px", fontSize: 12 }}
                          placeholder="Ghi chú dòng (VD: Màu, phân loại...)"
                          value={l.note ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setForm((s) => ({
                              ...s,
                              lines: s.lines.map((line, i) => (i === idx ? { ...line, note: val } : line)),
                            }));
                          }}
                        />
                      </div>

                      {/* Remove line */}
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "4px 8px", color: "#dc2626" }}
                        disabled={form.lines.length === 1}
                        onClick={() => removeLine(idx)}
                      >
                        ✕
                      </button>
                    </div>

                    {/* Specialized sub-row based on workflow */}
                    {form.receipt_type === "CONTAINER" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
                        <div>
                          <label style={{ display: "block", color: "#1e40af", fontWeight: 600, marginBottom: 2 }}>Số Kiện / Bao (Cartons/Bales):</label>
                          <input
                            type="number"
                            className="input"
                            style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                            placeholder="VD: 10 kiện"
                            value={l.carton_count ?? ""}
                            onChange={(e) => {
                              const cc = parseInt(e.target.value) || 0;
                              const ppc = l.pieces_per_carton || 1;
                              setForm((s) => ({
                                ...s,
                                lines: s.lines.map((line, i) =>
                                  i === idx ? { ...line, carton_count: cc, quantity: cc * ppc } : line,
                                ),
                              }));
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", color: "#1e40af", fontWeight: 600, marginBottom: 2 }}>Số Cái / Kiện (Pieces/Carton):</label>
                          <input
                            type="number"
                            className="input"
                            style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                            placeholder="VD: 50 cái/kiện (➔ Tự nhân tổng số cái)"
                            value={l.pieces_per_carton ?? ""}
                            onChange={(e) => {
                              const ppc = parseInt(e.target.value) || 1;
                              const cc = l.carton_count || 1;
                              setForm((s) => ({
                                ...s,
                                lines: s.lines.map((line, i) =>
                                  i === idx ? { ...line, pieces_per_carton: ppc, quantity: cc * ppc } : line,
                                ),
                              }));
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {form.receipt_type === "GROCERY" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                        <div>
                          <label style={{ display: "block", color: "#b45309", fontWeight: 600, marginBottom: 2 }}>
                            Đợt Hàng / Mã Lô Nhập:
                          </label>
                          <input
                            type="text"
                            className="input"
                            style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                            placeholder="VD: Đợt Bò Khô 24/09, Lô Kẹo 01..."
                            value={l.lot_number ?? ""}
                            onChange={(e) => {
                              const lot = e.target.value;
                              setForm((s) => ({
                                ...s,
                                lines: s.lines.map((line, i) => (i === idx ? { ...line, lot_number: lot } : line)),
                              }));
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", color: "#b45309", fontWeight: 600, marginBottom: 2 }}>
                            Quy Cách Đóng Gói / Ghi Chú:
                          </label>
                          <input
                            type="text"
                            className="input"
                            style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                            placeholder="VD: Bao 10kg, Thùng 24 gói..."
                            value={l.note ?? ""}
                            onChange={(e) => {
                              const n = e.target.value;
                              setForm((s) => ({
                                ...s,
                                lines: s.lines.map((line, i) => (i === idx ? { ...line, note: n } : line)),
                              }));
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
            <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
              Hủy
            </button>
            <button type="submit" className="btn primary" style={{ fontWeight: 700, padding: "8px 18px" }}>
              Xác Nhận Nhập Kho ➔
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Chi Tiết Phiếu Nhập */}
      <Modal open={detailOpen} title={`Chi Tiết Phiếu Nhập #${selectedReceipt?.id}`} onClose={() => setDetailOpen(false)}>
        {selectedReceipt && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, background: "#f8fafc", padding: 12, borderRadius: 8 }}>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>MÃ PHIẾU:</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#1e3a8a" }}>{selectedReceipt.receipt_number || `PN-${selectedReceipt.id}`}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>QUY TRÌNH:</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {selectedReceipt.receipt_type === "CONTAINER"
                    ? "🚢 Container FCL"
                    : selectedReceipt.receipt_type === "GROCERY"
                    ? "🍿 Bách Hóa"
                    : selectedReceipt.receipt_type === "BULK"
                    ? "⚖️ Hàng Xá"
                    : "📦 Tiêu Chuẩn"}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>NHÀ CUNG CẤP:</div>
                <div style={{ fontWeight: 600 }}>{selectedReceipt.supplier_name || "--"}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>THỜI GIAN NHẬN:</div>
                <div style={{ fontSize: 13 }}>{new Date(selectedReceipt.received_at).toLocaleString("vi-VN")}</div>
              </div>
              {selectedReceipt.container_number && (
                <div>
                  <div className="muted" style={{ fontSize: 11 }}>SỐ CONTAINER:</div>
                  <div style={{ fontWeight: 700, color: "#0284c7" }}>{selectedReceipt.container_number}</div>
                </div>
              )}

            </div>

            <div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>DANH SÁCH SẢN PHẨM:</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>SKU</th>
                    <th style={{ padding: "6px 8px" }}>Tên Sản Phẩm</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Số Lượng Nhập</th>
                    <th style={{ padding: "6px 8px" }}>Đơn Vị</th>
                    <th style={{ padding: "6px 8px" }}>Số Kiện / Quy Cách</th>
                    <th style={{ padding: "6px 8px" }}>Đợt / Lô Nhập</th>
                    <th style={{ padding: "6px 8px" }}>Ghi Chú</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedReceipt.lines.map((l) => (
                    <tr key={l.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "6px 8px", fontWeight: 700, color: "#1e3a8a" }}>{l.sku}</td>
                      <td style={{ padding: "6px 8px" }}>{l.product_name}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: "#15803d" }}>
                        +{l.quantity.toLocaleString()}
                      </td>
                      <td style={{ padding: "6px 8px" }}>{l.uom}</td>
                      <td style={{ padding: "6px 8px", color: "#475569" }}>
                        {l.carton_count ? `${l.carton_count} kiện (${l.pieces_per_carton || 1} cái/kiện)` : "--"}
                      </td>
                      <td style={{ padding: "6px 8px", color: "#b45309", fontWeight: 600 }}>
                        {l.lot_number || "--"}
                      </td>
                      <td style={{ padding: "6px 8px", color: "#64748b" }}>
                        {l.note || "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn" onClick={() => setDetailOpen(false)}>
                Đóng
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
