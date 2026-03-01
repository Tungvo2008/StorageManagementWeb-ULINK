import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { apiJson, apiUpload, downloadFile } from "../api/client";
import type { InventoryIssue, Invoice, Product } from "../types";
import { NavLink } from "react-router-dom";
import { getCurrentUsername } from "../auth";
import Modal from "../components/Modal";

type IssueLineDraft = {
  product_id: number | null;
  quantity: number;
  unit: "BASE" | "SALE";
  note?: string | null;
};

type IssueDraft = {
  issue_number?: string | null;
  issued_at?: string | null; // datetime-local
  issued_by?: string | null;
  issued_to?: string | null;
  purpose: string;
  note?: string | null;
  lines: IssueLineDraft[];
};

type IssueListRow =
  | {
      kind: "ISSUE";
      key: string;
      idText: string;
      refText: string;
      issued_at: string;
      issued_by: string;
      issued_to: string;
      purpose: string;
      line_count: number;
      issue: InventoryIssue;
    }
  | {
      kind: "INVOICE";
      key: string;
      idText: string;
      refText: string;
      issued_at: string;
      issued_by: string;
      issued_to: string;
      purpose: string;
      line_count: number;
      invoice: Invoice;
    };

type IssueEditDraft = {
  issue_number: string;
  issued_at: string;
  issued_to: string;
  purpose: string;
  note: string;
};

type InvoiceEditDraft = {
  invoice_number: string;
  issued_at: string;
  due_at: string;
  status: Invoice["status"];
};

function toIsoFromLocal(dtLocal: string | null | undefined): string | null {
  if (!dtLocal) return null;
  const d = new Date(dtLocal);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toLocalInputFromIso(isoValue: string | null | undefined): string {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export default function InventoryIssuePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [issues, setIssues] = useState<InventoryIssue[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<"ALL" | "ISSUE" | "INVOICE">("ALL");
  const [purposeFilter, setPurposeFilter] = useState<string>("ALL");
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<InventoryIssue | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [editIssueOpen, setEditIssueOpen] = useState(false);
  const [editInvoiceOpen, setEditInvoiceOpen] = useState(false);
  const [editIssueTarget, setEditIssueTarget] = useState<InventoryIssue | null>(null);
  const [editInvoiceTarget, setEditInvoiceTarget] = useState<Invoice | null>(null);
  const [editIssueBusy, setEditIssueBusy] = useState(false);
  const [editInvoiceBusy, setEditInvoiceBusy] = useState(false);
  const [issueEditForm, setIssueEditForm] = useState<IssueEditDraft>({
    issue_number: "",
    issued_at: "",
    issued_to: "",
    purpose: "OTHER",
    note: "",
  });
  const [invoiceEditForm, setInvoiceEditForm] = useState<InvoiceEditDraft>({
    invoice_number: "",
    issued_at: "",
    due_at: "",
    status: "ISSUED",
  });
  const currentUsername = useMemo(() => getCurrentUsername(), []);

  const [form, setForm] = useState<IssueDraft>({
    issue_number: "",
    issued_at: "",
    issued_by: currentUsername,
    issued_to: "",
    purpose: "TEST",
    note: "",
    lines: [{ product_id: null, quantity: 1, unit: "BASE" }],
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const listRows = useMemo<IssueListRow[]>(() => {
    const issueRows: IssueListRow[] = issues.map((issue) => ({
      kind: "ISSUE",
      key: `issue-${issue.id}`,
      idText: `${issue.id}`,
      refText: issue.issue_number ?? "",
      issued_at: issue.issued_at,
      issued_by: issue.issued_by ?? "",
      issued_to: issue.issued_to ?? "",
      purpose: issue.purpose,
      line_count: issue.lines.length,
      issue,
    }));
    const invoiceRows: IssueListRow[] = invoices.map((invoice) => ({
      kind: "INVOICE",
      key: `invoice-${invoice.id}`,
      idText: `${invoice.id}`,
      refText: invoice.invoice_number,
      issued_at: invoice.issued_at,
      issued_by: "",
      issued_to: `Sale #${invoice.sale_order_id}`,
      purpose: "SALE_INVOICE",
      line_count: invoice.lines.length,
      invoice,
    }));
    return [...issueRows, ...invoiceRows].sort(
      (a, b) => new Date(b.issued_at).getTime() - new Date(a.issued_at).getTime()
    );
  }, [issues, invoices]);
  const purposeOptions = useMemo(
    () => Array.from(new Set(listRows.map((row) => row.purpose))).sort(),
    [listRows]
  );
  const filteredRows = useMemo(() => {
    return listRows.filter((row) => {
      if (sourceFilter !== "ALL" && row.kind !== sourceFilter) return false;
      if (purposeFilter !== "ALL" && row.purpose !== purposeFilter) return false;
      return true;
    });
  }, [listRows, sourceFilter, purposeFilter]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, r, inv] = await Promise.all([
        apiJson<Product[]>("/api/v1/products"),
        apiJson<InventoryIssue[]>("/api/v1/inventory/issues?limit=50"),
        apiJson<Invoice[]>("/api/v1/invoices?limit=200"),
      ]);
      setProducts(p);
      setIssues(r);
      setInvoices(inv);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onImportFile(f: File) {
    setImportBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await apiUpload<InventoryIssue>("/api/v1/inventory/issues/import", fd);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }

  function addLine() {
    setForm((s) => ({ ...s, lines: [...s.lines, { product_id: null, quantity: 1, unit: "BASE" }] }));
  }

  function removeLine(idx: number) {
    setForm((s) => ({ ...s, lines: s.lines.filter((_, i) => i !== idx) }));
  }

  function openIssueDetail(issue: InventoryIssue) {
    setSelectedInvoice(null);
    setSelectedIssue(issue);
    setDetailOpen(true);
  }

  function openInvoiceDetail(invoice: Invoice) {
    setSelectedIssue(null);
    setSelectedInvoice(invoice);
    setDetailOpen(true);
  }

  function openEditIssue(issue: InventoryIssue) {
    setEditIssueTarget(issue);
    setIssueEditForm({
      issue_number: issue.issue_number ?? "",
      issued_at: toLocalInputFromIso(issue.issued_at),
      issued_to: issue.issued_to ?? "",
      purpose: issue.purpose,
      note: issue.note ?? "",
    });
    setEditIssueOpen(true);
  }

  function openEditInvoice(invoice: Invoice) {
    setEditInvoiceTarget(invoice);
    setInvoiceEditForm({
      invoice_number: invoice.invoice_number,
      issued_at: toLocalInputFromIso(invoice.issued_at),
      due_at: toLocalInputFromIso(invoice.due_at),
      status: invoice.status,
    });
    setEditInvoiceOpen(true);
  }

  async function onDeleteIssue(issueId: number) {
    const ok = window.confirm(`Xoá phiếu xuất #${issueId}? Tồn kho sẽ được rollback.`);
    if (!ok) return;
    setError(null);
    try {
      await apiJson<void>(`/api/v1/inventory/issues/${issueId}`, { method: "DELETE" });
      if (selectedIssue?.id === issueId) {
        setDetailOpen(false);
        setSelectedIssue(null);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDeleteInvoice(invoiceId: number) {
    const ok = window.confirm(`Xoá invoice #${invoiceId}?`);
    if (!ok) return;
    setError(null);
    try {
      await apiJson<void>(`/api/v1/invoices/${invoiceId}`, { method: "DELETE" });
      if (selectedInvoice?.id === invoiceId) {
        setDetailOpen(false);
        setSelectedInvoice(null);
      }
      if (editInvoiceTarget?.id === invoiceId) {
        setEditInvoiceOpen(false);
        setEditInvoiceTarget(null);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSubmitIssueEdit(e: FormEvent) {
    e.preventDefault();
    if (!editIssueTarget) return;
    setEditIssueBusy(true);
    setError(null);
    try {
      await apiJson<InventoryIssue>(`/api/v1/inventory/issues/${editIssueTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          issue_number: issueEditForm.issue_number.trim() || null,
          issued_at: toIsoFromLocal(issueEditForm.issued_at),
          issued_to: issueEditForm.issued_to.trim() || null,
          purpose: issueEditForm.purpose.trim() || "OTHER",
          note: issueEditForm.note.trim() || null,
        }),
      });
      setEditIssueOpen(false);
      setEditIssueTarget(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEditIssueBusy(false);
    }
  }

  async function onSubmitInvoiceEdit(e: FormEvent) {
    e.preventDefault();
    if (!editInvoiceTarget) return;
    setEditInvoiceBusy(true);
    setError(null);
    try {
      await apiJson<Invoice>(`/api/v1/invoices/${editInvoiceTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          invoice_number: invoiceEditForm.invoice_number.trim(),
          issued_at: toIsoFromLocal(invoiceEditForm.issued_at),
          due_at: toIsoFromLocal(invoiceEditForm.due_at),
          status: invoiceEditForm.status,
        }),
      });
      setEditInvoiceOpen(false);
      setEditInvoiceTarget(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEditInvoiceBusy(false);
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
        note: l.note ?? null,
      }));

    if (lines.length === 0) {
      setError("Chưa chọn sản phẩm nào.");
      return;
    }

    try {
      await apiJson<InventoryIssue>("/api/v1/inventory/issues", {
        method: "POST",
        body: JSON.stringify({
          issue_number: (form.issue_number ?? "").trim() || null,
          issued_at: toIsoFromLocal(form.issued_at),
          issued_by: (form.issued_by ?? "").trim() || null,
          issued_to: (form.issued_to ?? "").trim() || null,
          purpose: (form.purpose ?? "").trim() || "OTHER",
          note: (form.note ?? "").trim() || null,
          lines,
        }),
      });
      setForm({
        issue_number: "",
        issued_at: "",
        issued_by: currentUsername,
        issued_to: "",
        purpose: "TEST",
        note: "",
        lines: [{ product_id: null, quantity: 1, unit: "BASE" }],
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: 1, minWidth: 360 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Xuất hàng</h2>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button
              className="btn"
              type="button"
              onClick={() => void downloadFile("/api/v1/inventory/issues/template.xlsx", "issue-import-template.xlsx")}
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
              onClick={() => void downloadFile("/api/v1/inventory/issues/export.xlsx?limit=50", "issues-export.xlsx")}
            >
              Export Excel
            </button>
            <button className="btn" onClick={() => void load()} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          Tạo phiếu xuất thủ công và xem luôn các invoice đã đồng bộ.
        </div>
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
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <div className="field" style={{ width: 180 }}>
            <label>Type</label>
            <select className="input" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as "ALL" | "ISSUE" | "INVOICE")}>
              <option value="ALL">ALL</option>
              <option value="ISSUE">ISSUE</option>
              <option value="INVOICE">INVOICE</option>
            </select>
          </div>
          <div className="field" style={{ width: 220 }}>
            <label>Purpose</label>
            <select className="input" value={purposeFilter} onChange={(e) => setPurposeFilter(e.target.value)}>
              <option value="ALL">ALL</option>
              {purposeOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>ID</th>
                <th>Ref #</th>
                <th>Issued at</th>
                <th>By</th>
                <th>To</th>
                <th>Purpose</th>
                <th className="right">Lines</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr
                  key={row.key}
                  className="click-row"
                  onClick={() => {
                    if (row.kind === "ISSUE") openIssueDetail(row.issue);
                    else openInvoiceDetail(row.invoice);
                  }}
                >
                  <td>{row.kind}</td>
                  <td>{row.idText}</td>
                  <td>{row.refText}</td>
                  <td>{new Date(row.issued_at).toLocaleString()}</td>
                  <td>{row.issued_by}</td>
                  <td>{row.issued_to}</td>
                  <td>{row.purpose}</td>
                  <td className="right">{row.line_count}</td>
                  <td>
                    <div className="row">
                      {row.kind === "ISSUE" ? (
                        <>
                          <button
                            className="btn"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditIssue(row.issue);
                            }}
                          >
                            Sửa
                          </button>
                          <button
                            className="btn"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onDeleteIssue(row.issue.id);
                            }}
                          >
                            Xoá
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditInvoice(row.invoice);
                            }}
                          >
                            Sửa
                          </button>
                          <button
                            className="btn"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onDeleteInvoice(row.invoice.id);
                            }}
                          >
                            Xoá
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filteredRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    Không có dữ liệu theo filter hiện tại.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ width: 520 }}>
        <h3 style={{ marginTop: 0 }}>Tạo phiếu xuất</h3>
        <form onSubmit={onSubmit} className="row" style={{ alignItems: "stretch" }}>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder="Issue number (optional)"
              value={form.issue_number ?? ""}
              onChange={(e) => setForm((s) => ({ ...s, issue_number: e.target.value }))}
            />
            <input
              className="input"
              type="datetime-local"
              value={form.issued_at ?? ""}
              onChange={(e) => setForm((s) => ({ ...s, issued_at: e.target.value }))}
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder="Đăng nhập để hiển thị người xuất"
              value={form.issued_by ?? ""}
              readOnly
            />
            <input
              className="input"
              placeholder="Xuất cho ai (optional)"
              value={form.issued_to ?? ""}
              onChange={(e) => setForm((s) => ({ ...s, issued_to: e.target.value }))}
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <select className="input" value={form.purpose} onChange={(e) => setForm((s) => ({ ...s, purpose: e.target.value }))}>
              <option value="SALE">SALE</option>
              <option value="AMAZON_FBA">AMAZON_FBA</option>
              <option value="AMAZON_FBM">AMAZON_FBM</option>
              <option value="TEST">TEST</option>
              <option value="HOME">HOME</option>
              <option value="SAMPLE">SAMPLE</option>
              <option value="GIFT">GIFT</option>
              <option value="OTHER">OTHER</option>
            </select>
            <input className="input" placeholder="Ghi chú (optional)" value={form.note ?? ""} onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))} />
          </div>

          <div style={{ marginTop: 8, overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>Product</th>
                  <th className="right">Qty</th>
                  <th>Unit</th>
                  <th>UOM</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {form.lines.map((l, idx) => {
                  const p = l.product_id != null ? productById.get(l.product_id) : undefined;
                  const displayUom = l.unit === "BASE" ? (p?.base_uom ?? "Pc") : (p?.uom ?? "Pc");
                  return (
                    <tr key={idx}>
                      <td>
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
                      <td className="right">
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
                      <td>
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
                      <td>
                        {p ? (
                          <>
                            {displayUom}
                            {l.unit === "SALE" && p.uom_multiplier > 1 ? <span className="muted"> (x{p.uom_multiplier})</span> : null}
                          </>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td className="right">
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
              Create issue
            </button>
          </div>
        </form>
        <div className="muted" style={{ marginTop: 10 }}>
          Note: hệ thống sẽ chặn nếu tồn kho không đủ.
        </div>
      </div>

      <Modal
        open={editIssueOpen && editIssueTarget != null}
        title={`Sửa phiếu xuất #${editIssueTarget?.id ?? ""}`}
        onClose={() => setEditIssueOpen(false)}
      >
        <form onSubmit={onSubmitIssueEdit} className="row" style={{ alignItems: "stretch" }}>
          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ minWidth: 180 }}>
              <label>Issue # (Ref)</label>
              <input
                className="input"
                value={issueEditForm.issue_number}
                onChange={(e) => setIssueEditForm((s) => ({ ...s, issue_number: e.target.value }))}
              />
            </div>
            <div className="field" style={{ minWidth: 220 }}>
              <label>Issued at</label>
              <input
                className="input"
                type="datetime-local"
                value={issueEditForm.issued_at}
                onChange={(e) => setIssueEditForm((s) => ({ ...s, issued_at: e.target.value }))}
              />
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ minWidth: 220 }}>
              <label>Purpose</label>
              <select
                className="input"
                value={issueEditForm.purpose}
                onChange={(e) => setIssueEditForm((s) => ({ ...s, purpose: e.target.value }))}
              >
                <option value="SALE">SALE</option>
                <option value="SALE_INVOICE">SALE_INVOICE</option>
                <option value="AMAZON_FBA">AMAZON_FBA</option>
                <option value="AMAZON_FBM">AMAZON_FBM</option>
                <option value="TEST">TEST</option>
                <option value="HOME">HOME</option>
                <option value="SAMPLE">SAMPLE</option>
                <option value="GIFT">GIFT</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>
            <div className="field" style={{ minWidth: 260 }}>
              <label>Issued to</label>
              <input
                className="input"
                value={issueEditForm.issued_to}
                onChange={(e) => setIssueEditForm((s) => ({ ...s, issued_to: e.target.value }))}
              />
            </div>
          </div>
          <div className="field">
            <label>Note</label>
            <input
              className="input"
              value={issueEditForm.note}
              onChange={(e) => setIssueEditForm((s) => ({ ...s, note: e.target.value }))}
            />
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn primary" type="submit" disabled={editIssueBusy}>
              {editIssueBusy ? "Saving..." : "Save issue"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editInvoiceOpen && editInvoiceTarget != null}
        title={`Sửa invoice #${editInvoiceTarget?.invoice_number ?? ""}`}
        onClose={() => setEditInvoiceOpen(false)}
      >
        <form onSubmit={onSubmitInvoiceEdit} className="row" style={{ alignItems: "stretch" }}>
          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ minWidth: 200 }}>
              <label>Invoice #</label>
              <input
                className="input"
                value={invoiceEditForm.invoice_number}
                onChange={(e) => setInvoiceEditForm((s) => ({ ...s, invoice_number: e.target.value }))}
              />
            </div>
            <div className="field" style={{ minWidth: 180 }}>
              <label>Status</label>
              <select
                className="input"
                value={invoiceEditForm.status}
                onChange={(e) => setInvoiceEditForm((s) => ({ ...s, status: e.target.value as Invoice["status"] }))}
              >
                <option value="ISSUED">ISSUED</option>
                <option value="PAID">PAID</option>
                <option value="VOID">VOID</option>
              </select>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ minWidth: 220 }}>
              <label>Issued at</label>
              <input
                className="input"
                type="datetime-local"
                value={invoiceEditForm.issued_at}
                onChange={(e) => setInvoiceEditForm((s) => ({ ...s, issued_at: e.target.value }))}
              />
            </div>
            <div className="field" style={{ minWidth: 220 }}>
              <label>Due at</label>
              <input
                className="input"
                type="datetime-local"
                value={invoiceEditForm.due_at}
                onChange={(e) => setInvoiceEditForm((s) => ({ ...s, due_at: e.target.value }))}
              />
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn primary" type="submit" disabled={editInvoiceBusy}>
              {editInvoiceBusy ? "Saving..." : "Save invoice"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={detailOpen && (selectedIssue != null || selectedInvoice != null)}
        title={
          selectedIssue
            ? `Chi tiết phiếu xuất #${selectedIssue.id}`
            : selectedInvoice
              ? `Chi tiết invoice #${selectedInvoice.invoice_number}`
              : "Chi tiết"
        }
        onClose={() => setDetailOpen(false)}
      >
        {selectedIssue ? (
          <div className="row" style={{ alignItems: "stretch" }}>
            <div className="row" style={{ gap: 8 }}>
              <div className="field" style={{ minWidth: 180 }}>
                <label>Issue #</label>
                <input className="input" value={selectedIssue.issue_number ?? ""} readOnly />
              </div>
              <div className="field" style={{ minWidth: 220 }}>
                <label>Issued at</label>
                <input className="input" value={new Date(selectedIssue.issued_at).toLocaleString()} readOnly />
              </div>
              <div className="field" style={{ minWidth: 200 }}>
                <label>By</label>
                <input className="input" value={selectedIssue.issued_by ?? ""} readOnly />
              </div>
              <div className="field" style={{ minWidth: 200 }}>
                <label>To</label>
                <input className="input" value={selectedIssue.issued_to ?? ""} readOnly />
              </div>
              <div className="field" style={{ minWidth: 170 }}>
                <label>Purpose</label>
                <input className="input" value={selectedIssue.purpose} readOnly />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 240 }}>
                <label>Note</label>
                <input className="input" value={selectedIssue.note ?? ""} readOnly />
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
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedIssue.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.sku}</td>
                      <td>{l.product_name}</td>
                      <td className="right">{l.quantity}</td>
                      <td>
                        {l.uom}
                        {l.uom_multiplier > 1 ? <span className="muted"> (x{l.uom_multiplier})</span> : null}
                      </td>
                      <td>{l.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : selectedInvoice ? (
          <div className="row" style={{ alignItems: "stretch" }}>
            <div className="row" style={{ gap: 8 }}>
              <div className="field" style={{ minWidth: 170 }}>
                <label>Invoice #</label>
                <input className="input" value={selectedInvoice.invoice_number} readOnly />
              </div>
              <div className="field" style={{ minWidth: 160 }}>
                <label>Invoice ID</label>
                <input className="input" value={selectedInvoice.id} readOnly />
              </div>
              <div className="field" style={{ minWidth: 180 }}>
                <label>Issued at</label>
                <input className="input" value={new Date(selectedInvoice.issued_at).toLocaleString()} readOnly />
              </div>
              <div className="field" style={{ minWidth: 140 }}>
                <label>Purpose</label>
                <input className="input" value="SALE_INVOICE" readOnly />
              </div>
              <div className="field" style={{ minWidth: 150 }}>
                <label>Sale #</label>
                <input className="input" value={selectedInvoice.sale_order_id} readOnly />
              </div>
              <div className="field" style={{ minWidth: 180 }}>
                <label>Total</label>
                <input className="input" value={`${selectedInvoice.total_amount} ${selectedInvoice.currency}`} readOnly />
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
                    <th className="right">Unit price</th>
                    <th className="right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.sku}</td>
                      <td>{l.product_name}</td>
                      <td className="right">{l.quantity}</td>
                      <td>{l.uom}</td>
                      <td className="right">{l.unit_price}</td>
                      <td className="right">{l.line_total}</td>
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
