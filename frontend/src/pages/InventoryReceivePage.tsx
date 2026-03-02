import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { apiJson, apiUpload, downloadFile } from "../api/client";
import type { InventoryReceipt, Product } from "../types";
import { NavLink } from "react-router-dom";
import { getCurrentUsername } from "../auth";
import Modal from "../components/Modal";
import type { SortState } from "../utils/table";
import { matchesQuery, sortBy, toggleSort } from "../utils/table";

type ReceiptLineDraft = {
  product_id: number | null;
  quantity: number;
  unit: "BASE" | "SALE";
  unit_cost: string;
  note?: string | null;
};

type ReceiptDraft = {
  receipt_number?: string | null;
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
  const [sort, setSort] = useState<SortState<"id" | "received_at" | "received_by" | "receipt_number" | "line_count">>({
    key: "id",
    dir: "desc",
  });

  const [form, setForm] = useState<ReceiptDraft>({
    receipt_number: "",
    received_at: "",
    received_by: currentUsername,
    note: "",
    lines: [{ product_id: null, quantity: 1, unit: "BASE", unit_cost: "0" }],
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, r] = await Promise.all([
        apiJson<Product[]>("/api/v1/products"),
        apiJson<InventoryReceipt[]>("/api/v1/inventory/receipts?limit=50"),
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
    const filtered = receipts.filter((r) =>
      matchesQuery(query, r.id, r.received_at, r.received_by, r.receipt_number, r.lines.length),
    );
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
  }, [receipts, query, sort]);

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
    setForm((s) => ({ ...s, lines: [...s.lines, { product_id: null, quantity: 1, unit: "BASE", unit_cost: "0" }] }));
  }

  function removeLine(idx: number) {
    setForm((s) => ({ ...s, lines: s.lines.filter((_, i) => i !== idx) }));
  }

  function openReceiptDetail(r: InventoryReceipt) {
    setSelectedReceipt(r);
    setDetailOpen(true);
  }

  async function onDeleteReceipt(receiptId: number) {
    const ok = window.confirm(`Xoá phiếu nhập #${receiptId}? Tồn kho sẽ được rollback.`);
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
      }));

    if (lines.length === 0) {
      setError("Chưa chọn sản phẩm nào.");
      return;
    }

    try {
      await apiJson<InventoryReceipt>("/api/v1/inventory/receipts", {
        method: "POST",
        body: JSON.stringify({
          receipt_number: (form.receipt_number ?? "").trim() || null,
          received_at: toIsoFromLocal(form.received_at),
          received_by: (form.received_by ?? "").trim() || null,
          note: (form.note ?? "").trim() || null,
          lines,
        }),
      });
      setForm({
        receipt_number: "",
        received_at: "",
        received_by: currentUsername,
        note: "",
        lines: [{ product_id: null, quantity: 1, unit: "BASE", unit_cost: "0" }],
      });
      setCreateOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: 1, minWidth: 360 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Receipt log</h2>
          <div className="tableTools">
            <input
              className="input"
              style={{ minWidth: 260 }}
              placeholder="Search receipt..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className="btn"
              type="button"
              onClick={() => void downloadFile("/api/v1/inventory/receipts/template.xlsx", "receipt-import-template.xlsx")}
            >
              Template Excel
            </button>
            <label className="btn" style={{ cursor: importBusy ? "not-allowed" : "pointer", opacity: importBusy ? 0.6 : 1 }}>
              Import Excel
              <input
                type="file"
                accept=".xlsx"
                style={{ display: "none" }}
                disabled={importBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onImportFile(f);
                }}
              />
            </label>
            <button
              className="btn"
              type="button"
              onClick={() => void downloadFile("/api/v1/inventory/receipts/export.xlsx?limit=50", "receipts-export.xlsx")}
            >
              Export Excel
            </button>
            <button className="btn primary" type="button" onClick={() => setCreateOpen(true)}>
              + Phiếu nhập
            </button>
            <button className="btn" onClick={() => void load()} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>Danh sách phiếu nhập và tạo phiếu nhập mới.</div>
        <div className="inventoryTabs">
          <NavLink to="/inventory" end className={({ isActive }) => (isActive ? "active" : "")}>
            Inventory
          </NavLink>
          <NavLink to="/inventory/receipt-log" className={({ isActive }) => (isActive ? "active" : "")}>
            Receipt log
          </NavLink>
          <NavLink to="/inventory/issue" className={({ isActive }) => (isActive ? "active" : "")}>
            Issue
          </NavLink>
        </div>
        {error && <div className="error">{error}</div>}

        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "id"))}>ID{mark("id")}</button></th>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "received_at"))}>Received at{mark("received_at")}</button></th>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "received_by"))}>By{mark("received_by")}</button></th>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "receipt_number"))}>Receipt #{mark("receipt_number")}</button></th>
                <th className="right"><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "line_count"))}>Lines{mark("line_count")}</button></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {displayedReceipts.map((r) => (
                <tr key={r.id} className="click-row" onClick={() => openReceiptDetail(r)}>
                  <td>{r.id}</td>
                  <td>{new Date(r.received_at).toLocaleString()}</td>
                  <td>{r.received_by ?? ""}</td>
                  <td>{r.receipt_number ?? ""}</td>
                  <td className="right">{r.lines.length}</td>
                  <td className="right">
                    <button
                      className="btn"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteReceipt(r.id);
                      }}
                    >
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && displayedReceipts.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Không có dữ liệu theo filter hiện tại.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={createOpen} title="Tạo phiếu nhập" onClose={() => setCreateOpen(false)}>
        {error && <div className="error">{error}</div>}
        <form onSubmit={onSubmit} className="row" style={{ alignItems: "stretch" }}>
          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ flex: 1, minWidth: 240 }}>
              <label>Receipt number</label>
              <input
                className="input"
                placeholder="(optional)"
                value={form.receipt_number ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, receipt_number: e.target.value }))}
              />
            </div>
            <div className="field" style={{ width: 220 }}>
              <label>Received at</label>
              <input
                className="input"
                type="datetime-local"
                value={form.received_at ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, received_at: e.target.value }))}
              />
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ flex: 1, minWidth: 240 }}>
              <label>Người nhập</label>
              <input
                className="input"
                placeholder="Đăng nhập để hiển thị người nhập"
                value={form.received_by ?? ""}
                readOnly
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 240 }}>
              <label>Ghi chú</label>
              <input
                className="input"
                placeholder="(optional)"
                value={form.note ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
              />
            </div>
          </div>

          <div style={{ marginTop: 8, overflowX: "auto" }}>
            <table className="receiptLinesTable">
              <thead>
                <tr>
                  <th className="colProd">Product</th>
                  <th className="right colQty">Qty</th>
                  <th className="colUnit">Unit</th>
                  <th className="right colCost">Unit cost</th>
                  <th className="colUom">UOM</th>
                  <th className="colAction"></th>
                </tr>
              </thead>
              <tbody>
                {form.lines.map((l, idx) => {
                  const p = l.product_id != null ? productById.get(l.product_id) : undefined;
                  const displayUom = l.unit === "BASE" ? (p?.base_uom ?? "Pc") : (p?.uom ?? "Pc");
                  return (
                    <tr key={idx}>
                      <td className="colProd">
                        <select
                          className="input"
                          value={l.product_id ?? ""}
                          onChange={(e) =>
                            setForm((s) => ({
                              ...s,
                              lines: s.lines.map((x, i) =>
                                i === idx ? { ...x, product_id: e.target.value ? Number(e.target.value) : null } : x
                              ),
                            }))
                          }
                        >
                          <option value="">-- Select --</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku} - {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="right colQty">
                        <input
                          className="input"
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) =>
                            setForm((s) => ({
                              ...s,
                              lines: s.lines.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) } : x)),
                            }))
                          }
                          style={{ width: 110 }}
                        />
                      </td>
                      <td className="colUnit">
                        <select
                          className="input"
                          value={l.unit}
                          onChange={(e) =>
                            setForm((s) => ({
                              ...s,
                              lines: s.lines.map((x, i) =>
                                i === idx ? { ...x, unit: (e.target.value as "BASE" | "SALE") } : x
                              ),
                            }))
                          }
                        >
                          <option value="BASE">Base</option>
                          <option value="SALE">Sale</option>
                        </select>
                      </td>
                      <td className="right colCost">
                        <input
                          className="input"
                          value={l.unit_cost}
                          onChange={(e) =>
                            setForm((s) => ({
                              ...s,
                              lines: s.lines.map((x, i) => (i === idx ? { ...x, unit_cost: e.target.value } : x)),
                            }))
                          }
                          style={{ width: 120 }}
                        />
                      </td>
                      <td className="colUom">
                        {p ? (
                          <>
                            {displayUom}
                            {l.unit === "SALE" && p.uom_multiplier > 1 ? (
                              <span className="muted"> (x{p.uom_multiplier})</span>
                            ) : null}
                          </>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td className="right colAction">
                        <button className="btn" type="button" onClick={() => removeLine(idx)} disabled={form.lines.length <= 1}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
            <button className="btn" type="button" onClick={addLine}>
              + Add line
            </button>
            <button className="btn primary" type="submit">
              Create receipt
            </button>
          </div>
        </form>
        <div className="muted" style={{ marginTop: 10 }}>
          Tip: khăn/towel nhập kho chọn Unit=Base (Pc). Bán hàng dùng Unit=Sale (Dozen x12).
        </div>
      </Modal>

      <Modal
        open={detailOpen && selectedReceipt != null}
        title={`Chi tiết phiếu nhập #${selectedReceipt?.id ?? ""}`}
        onClose={() => setDetailOpen(false)}
      >
        {selectedReceipt ? (
          <div className="row" style={{ alignItems: "stretch" }}>
            <div className="row" style={{ gap: 8 }}>
              <div className="field" style={{ minWidth: 180 }}>
                <label>Receipt #</label>
                <input className="input" value={selectedReceipt.receipt_number ?? ""} readOnly />
              </div>
              <div className="field" style={{ minWidth: 220 }}>
                <label>Received at</label>
                <input className="input" value={new Date(selectedReceipt.received_at).toLocaleString()} readOnly />
              </div>
              <div className="field" style={{ minWidth: 200 }}>
                <label>By</label>
                <input className="input" value={selectedReceipt.received_by ?? ""} readOnly />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 260 }}>
                <label>Note</label>
                <input className="input" value={selectedReceipt.note ?? ""} readOnly />
              </div>
            </div>

            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th className="right">Qty</th>
                    <th>UOM</th>
                    <th className="right">Unit cost</th>
                    <th className="right">Line total</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedReceipt.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.sku}</td>
                      <td>{l.product_name}</td>
                      <td className="right">{l.quantity}</td>
                      <td>{l.uom}</td>
                      <td className="right">
                        {l.unit_cost} {l.currency}
                      </td>
                      <td className="right">
                        {l.line_total} {l.currency}
                      </td>
                      <td>{l.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
