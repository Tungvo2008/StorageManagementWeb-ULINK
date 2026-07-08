import { useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { apiJson, apiUpload, downloadFile, previewFile } from "../api/client";
import type { Customer, Invoice } from "../types";
import type { SortState } from "../utils/table";
import { matchesQuery, sortBy, toggleSort } from "../utils/table";

type InvoiceSortKey =
  | "id"
  | "invoice_number"
  | "customer_name"
  | "sale_order_id"
  | "status"
  | "payment_status"
  | "total_amount"
  | "amount_paid"
  | "balance_due";

type EditLineForm = {
  id: number | null;
  line_type: "PRODUCT" | "FREE";
  product_id: number | null;
  sku: string;
  product_name: string;
  uom: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
};

type EditInvoiceForm = {
  invoice_number: string;
  issued_at: string;
  due_at: string;
  status: "DRAFT" | "ISSUED" | "VOID";
  client_name_snapshot: string;
  tele_snapshot: string;
  address_snapshot: string;
  city_snapshot: string;
  zip_code_snapshot: string;
  note: string;
  tax_rate: string;
  order_discount_amount: string;
  shipping_amount: string;
  currency: string;
  lines: EditLineForm[];
};

type PaymentForm = {
  amount: string;
  paid_at: string;
  method: string;
  note: string;
};

type MergeForm = {
  invoice_number: string;
  issued_at: string;
  due_at: string;
};

type InvoiceImportPayload = {
  invoice_number: string | null;
  issued_at: string | null;
  due_at: string | null;
  client_name_snapshot: string;
  tele_snapshot: string;
  address_snapshot: string;
  city_snapshot: string;
  zip_code_snapshot: string;
  note?: string | null;
  currency: string;
  tax_rate: number;
  order_discount_amount: number;
  shipping_amount: number;
  lines: EditLineForm[];
};

function toInputDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromInputDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toMoneyString(value: string | number | null | undefined): string {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
}

function formatMoney(value: string | number, currency: string): string {
  const num = Number(value ?? 0);
  return `${Number.isFinite(num) ? num.toFixed(2) : "0.00"} ${currency}`;
}

function findMatchingCustomerId(
  customers: Customer[],
  snapshot: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
  },
): number | "" {
  const name = (snapshot.name || "").trim().toLowerCase();
  const phone = (snapshot.phone || "").trim();
  const address = (snapshot.address || "").trim().toLowerCase();
  if (!name) return "";

  const exact = customers.find((customer) => {
    if (customer.name.trim().toLowerCase() !== name) return false;
    if (phone && (customer.phone || "").trim() !== phone) return false;
    if (address && (customer.address || "").trim().toLowerCase() !== address) return false;
    return true;
  });
  if (exact) return exact.id;

  const byName = customers.find((customer) => customer.name.trim().toLowerCase() === name);
  return byName ? byName.id : "";
}

function buildEditForm(invoice: Invoice): EditInvoiceForm {
  return {
    invoice_number: invoice.invoice_number,
    issued_at: toInputDateTime(invoice.issued_at),
    due_at: toInputDateTime(invoice.due_at),
    status: invoice.status === "VOID" ? "VOID" : invoice.status === "DRAFT" ? "DRAFT" : "ISSUED",
    client_name_snapshot: invoice.client_name_snapshot ?? invoice.customer_name ?? "",
    tele_snapshot: invoice.tele_snapshot ?? "",
    address_snapshot: invoice.address_snapshot ?? "",
    city_snapshot: invoice.city_snapshot ?? "",
    zip_code_snapshot: invoice.zip_code_snapshot ?? "",
    note: invoice.note ?? "",
    tax_rate: String(invoice.tax_rate ?? "0"),
    order_discount_amount: toMoneyString(invoice.order_discount_amount),
    shipping_amount: toMoneyString(invoice.shipping_amount),
    currency: invoice.currency,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      line_type: line.line_type,
      product_id: line.product_id,
      sku: line.sku,
      product_name: line.product_name,
      uom: line.uom,
      quantity: String(line.quantity),
      unit_price: toMoneyString(line.unit_price),
      discount_amount: toMoneyString(line.discount_amount),
    })),
  };
}

function buildCreateForm(): EditInvoiceForm {
  return {
    invoice_number: "",
    issued_at: toInputDateTime(new Date().toISOString()),
    due_at: "",
    status: "DRAFT",
    client_name_snapshot: "",
    tele_snapshot: "",
    address_snapshot: "",
    city_snapshot: "",
    zip_code_snapshot: "",
    note: "",
    tax_rate: "0",
    order_discount_amount: "0.00",
    shipping_amount: "0.00",
    currency: "USD",
    lines: [
      {
        id: null,
        line_type: "FREE",
        product_id: null,
        sku: "",
        product_name: "",
        uom: "Pc",
        quantity: "1",
        unit_price: "0.00",
        discount_amount: "0.00",
      },
    ],
  };
}

function buildPaymentForm(invoice: Invoice): PaymentForm {
  const balance = Math.max(Number(invoice.balance_due ?? 0), 0);
  return {
    amount: balance > 0 ? balance.toFixed(2) : toMoneyString(invoice.total_amount),
    paid_at: toInputDateTime(new Date().toISOString()),
    method: "",
    note: "",
  };
}

function buildMergeForm(invoices: Invoice[]): MergeForm {
  const issuedAt = invoices.reduce((latest, invoice) => {
    if (!latest) return invoice.issued_at;
    return new Date(invoice.issued_at).getTime() > new Date(latest).getTime() ? invoice.issued_at : latest;
  }, "");
  const dueAt = invoices.reduce((latest, invoice) => {
    if (!invoice.due_at) return latest;
    if (!latest) return invoice.due_at;
    return new Date(invoice.due_at).getTime() > new Date(latest).getTime() ? invoice.due_at : latest;
  }, "");
  return {
    invoice_number: "",
    issued_at: toInputDateTime(issuedAt),
    due_at: toInputDateTime(dueAt),
  };
}

function canMergeInvoice(invoice: Invoice): boolean {
  return (
    invoice.status !== "VOID" &&
    invoice.status !== "DRAFT" &&
    invoice.merged_into_invoice_id == null &&
    Number(invoice.amount_paid || 0) <= 0
  );
}

export default function InvoicesPage() {
  const [items, setItems] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState<InvoiceSortKey>>({
    key: "id",
    dir: "desc",
  });
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [editForm, setEditForm] = useState<EditInvoiceForm | null>(null);
  const [editMode, setEditMode] = useState<"create" | "edit">("edit");
  const [paymentForm, setPaymentForm] = useState<PaymentForm | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [draggedLineIndex, setDraggedLineIndex] = useState<number | null>(null);
  const [dragOverLineIndex, setDragOverLineIndex] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingMerge, setSavingMerge] = useState(false);
  const [importingLines, setImportingLines] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | "">("");
  const [mergeForm, setMergeForm] = useState<MergeForm>({ invoice_number: "", issued_at: "", due_at: "" });

  const sortedCustomers = useMemo(() => [...customers].sort((a, b) => a.name.localeCompare(b.name)), [customers]);

  function applyCustomerToForm(customerId: number | "") {
    setSelectedCustomerId(customerId);
    if (!customerId) return;
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) return;
    setEditForm((curr) =>
      curr
        ? {
            ...curr,
            client_name_snapshot: customer.name || "",
            tele_snapshot: customer.phone || "",
            address_snapshot: customer.address || "",
            city_snapshot: customer.city || "",
            zip_code_snapshot: customer.zip_code || "",
          }
        : curr,
    );
  }

  function addFreeLine() {
    setEditForm((curr) =>
      curr
        ? {
            ...curr,
            lines: [
              ...curr.lines,
              {
                id: null,
                line_type: "FREE",
                product_id: null,
                sku: "",
                product_name: "",
                uom: "Pc",
                quantity: "1",
                unit_price: "0.00",
                discount_amount: "0.00",
              },
            ],
          }
        : curr,
    );
  }

  function removeLine(lineIndex: number) {
    setEditForm((curr) => {
      if (!curr || curr.lines.length <= 1) return curr;
      return { ...curr, lines: curr.lines.filter((_, index) => index !== lineIndex) };
    });
  }

  function reorderLine(fromIndex: number, toIndex: number) {
    setEditForm((curr) => {
      if (!curr) return curr;
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= curr.lines.length || toIndex >= curr.lines.length) {
        return curr;
      }
      const lines = [...curr.lines];
      const [moved] = lines.splice(fromIndex, 1);
      lines.splice(toIndex, 0, moved);
      return { ...curr, lines };
    });
  }

  function handleLineDragStart(lineIndex: number, e: DragEvent<HTMLButtonElement>) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(lineIndex));
    setDraggedLineIndex(lineIndex);
    setDragOverLineIndex(lineIndex);
  }

  function handleLineDrop(targetIndex: number) {
    if (draggedLineIndex == null) return;
    reorderLine(draggedLineIndex, targetIndex);
    setDraggedLineIndex(null);
    setDragOverLineIndex(null);
  }

  function resetLineDrag() {
    setDraggedLineIndex(null);
    setDragOverLineIndex(null);
  }

  async function importInvoiceExcel(file: File) {
    setImportingLines(true);
    setModalError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const payload = await apiUpload<InvoiceImportPayload>("/api/v1/invoices/manual/import", formData);
      setEditForm((curr) => ({
        ...(curr ?? buildCreateForm()),
        invoice_number: curr?.invoice_number ?? "",
        issued_at: curr?.issued_at ?? "",
        due_at: curr?.due_at ?? "",
        client_name_snapshot: curr?.client_name_snapshot ?? "",
        tele_snapshot: curr?.tele_snapshot ?? "",
        address_snapshot: curr?.address_snapshot ?? "",
        city_snapshot: curr?.city_snapshot ?? "",
        zip_code_snapshot: curr?.zip_code_snapshot ?? "",
        note: curr?.note ?? payload.note ?? "",
        currency: curr?.currency ?? "USD",
        tax_rate: curr?.tax_rate ?? "0",
        order_discount_amount: curr?.order_discount_amount ?? "0.00",
        shipping_amount: curr?.shipping_amount ?? "0.00",
        lines: payload.lines.map((line) => ({
          ...line,
          quantity: String(line.quantity),
          unit_price: toMoneyString(line.unit_price),
          discount_amount: toMoneyString(line.discount_amount),
        })),
      }));
    } catch (e) {
      setModalError((e as Error).message);
    } finally {
      setImportingLines(false);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [invoiceData, customerData] = await Promise.all([
        apiJson<Invoice[]>("/api/v1/invoices"),
        apiJson<Customer[]>("/api/v1/customers"),
      ]);
      setItems(invoiceData);
      setCustomers(customerData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadInvoiceDetail(invoiceId: number): Promise<Invoice> {
    const data = await apiJson<Invoice>(`/api/v1/invoices/${invoiceId}`);
    setItems((curr) => curr.map((item) => (item.id === data.id ? data : item)));
    return data;
  }

  useEffect(() => {
    void load();
  }, []);

  const displayed = useMemo(() => {
    const filtered = items.filter((inv) =>
      matchesQuery(
        query,
        inv.id,
        inv.invoice_number,
        inv.customer_name,
        inv.sale_order_id,
        inv.status,
        inv.payment_status,
        inv.total_amount,
        inv.amount_paid,
        inv.balance_due,
        inv.currency,
      ),
    );
    return sortBy(
      filtered,
      (inv) => {
        switch (sort.key) {
          case "id":
            return inv.id;
          case "invoice_number":
            return inv.invoice_number;
          case "customer_name":
            return inv.customer_name ?? "";
          case "sale_order_id":
            return inv.sale_order_id;
          case "status":
            return inv.status;
          case "payment_status":
            return inv.payment_status;
          case "total_amount":
            return Number(inv.total_amount);
          case "amount_paid":
            return Number(inv.amount_paid);
          case "balance_due":
            return Number(inv.balance_due);
          default:
            return inv.id;
        }
      },
      sort.dir,
    );
  }, [items, query, sort]);

  const editSummary = useMemo(() => {
    if (!editForm) return null;
    const subtotal = editForm.lines.reduce(
      (sum, line) => sum + Math.max(Number(line.quantity) || 0, 0) * Math.max(Number(line.unit_price) || 0, 0),
      0,
    );
    const lineDiscounts = editForm.lines.reduce((sum, line) => sum + Math.max(Number(line.discount_amount) || 0, 0), 0);
    const orderDiscount = Math.max(Number(editForm.order_discount_amount) || 0, 0);
    const shipping = Math.max(Number(editForm.shipping_amount) || 0, 0);
    const totalDiscount = orderDiscount + lineDiscounts;
    const net = Math.max(subtotal - totalDiscount, 0);
    const tax = net * Math.max(Number(editForm.tax_rate) || 0, 0);
    return {
      subtotal,
      lineDiscounts,
      orderDiscount,
      totalDiscount,
      tax,
      total: net + tax + shipping,
    };
  }, [editForm]);

  const selectedInvoices = useMemo(
    () => selectedIds.map((id) => items.find((item) => item.id === id)).filter(Boolean) as Invoice[],
    [items, selectedIds],
  );
  const mergeSummary = useMemo(() => {
    if (selectedInvoices.length === 0) return null;
    return {
      customer: selectedInvoices[0].customer_name || selectedInvoices[0].client_name_snapshot || "-",
      currency: selectedInvoices[0].currency,
      total: selectedInvoices.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0),
      paid: selectedInvoices.reduce((sum, invoice) => sum + Number(invoice.amount_paid || 0), 0),
      balance: selectedInvoices.reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0),
    };
  }, [selectedInvoices]);

  function mark(col: InvoiceSortKey): string {
    if (sort.key !== col) return "";
    return sort.dir === "asc" ? " ↑" : " ↓";
  }

  async function openEdit(invoice: Invoice) {
    setLoadingDetail(true);
    setModalError(null);
    try {
      const detailed = await loadInvoiceDetail(invoice.id);
      setSelectedInvoice(detailed);
      setEditForm(buildEditForm(detailed));
      setSelectedCustomerId(
        findMatchingCustomerId(customers, {
          name: detailed.client_name_snapshot ?? detailed.customer_name,
          phone: detailed.tele_snapshot,
          address: detailed.address_snapshot,
        }),
      );
      setEditMode("edit");
      setEditOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  }

  function openCreateInvoice() {
    setSelectedInvoice(null);
    setModalError(null);
    setEditMode("create");
    setEditForm(buildCreateForm());
    setSelectedCustomerId("");
    setEditOpen(true);
  }

  async function openPayment(invoice: Invoice) {
    setLoadingDetail(true);
    setModalError(null);
    try {
      const detailed = await loadInvoiceDetail(invoice.id);
      setSelectedInvoice(detailed);
      setPaymentForm(buildPaymentForm(detailed));
      setPaymentOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function submitEdit(options?: {
    statusOverride?: "DRAFT" | "ISSUED" | "VOID";
    previewAfterSave?: boolean;
    closeAfterSave?: boolean;
  }) {
    if (!editForm) return;
    setSavingEdit(true);
    setModalError(null);
    try {
      const statusToSave = options?.statusOverride ?? editForm.status;
      const currentInvoiceId = selectedInvoice?.id ?? null;
      const shouldCreate = editMode === "create" && currentInvoiceId == null;
      const payload = {
        invoice_number: editForm.invoice_number.trim() || null,
        issued_at: fromInputDateTime(editForm.issued_at),
        due_at: fromInputDateTime(editForm.due_at),
        status: statusToSave,
        client_name_snapshot: editForm.client_name_snapshot.trim(),
        tele_snapshot: editForm.tele_snapshot.trim(),
        address_snapshot: editForm.address_snapshot.trim(),
        city_snapshot: editForm.city_snapshot.trim(),
        zip_code_snapshot: editForm.zip_code_snapshot.trim(),
        note: editForm.note.trim() || null,
        currency: editForm.currency.trim() || "USD",
        tax_rate: Number(editForm.tax_rate || 0),
        order_discount_amount: Number(editForm.order_discount_amount || 0),
        shipping_amount: Number(editForm.shipping_amount || 0),
        lines: editForm.lines.map((line) => ({
          id: line.id,
          line_type: line.line_type,
          product_id: line.product_id,
          sku: line.sku.trim(),
          product_name: line.product_name.trim(),
          uom: line.uom.trim(),
          quantity: Number(line.quantity || 0),
          unit_price: Number(line.unit_price || 0),
          discount_amount: Number(line.discount_amount || 0),
        })),
      };
      const updated =
        shouldCreate
          ? await apiJson<Invoice>("/api/v1/invoices/manual", {
              method: "POST",
              body: JSON.stringify(payload),
            })
          : await apiJson<Invoice>(`/api/v1/invoices/${currentInvoiceId}`, {
              method: "PATCH",
              body: JSON.stringify(payload),
            });
      setItems((curr) =>
        editMode === "create"
          ? [updated, ...curr]
          : curr.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelectedInvoice(updated);
      if (options?.previewAfterSave) {
        void previewFile(`/api/v1/invoices/${updated.id}/pdf`);
      }
      if (options?.closeAfterSave ?? statusToSave !== "DRAFT") {
        setEditOpen(false);
        setEditForm(null);
        setSelectedCustomerId("");
      } else {
        setEditMode("edit");
        setEditForm(buildEditForm(updated));
        setSelectedCustomerId(
          findMatchingCustomerId(customers, {
            name: updated.client_name_snapshot ?? updated.customer_name,
            phone: updated.tele_snapshot,
            address: updated.address_snapshot,
          }),
        );
      }
    } catch (e) {
      setModalError((e as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function cancelInvoice() {
    if (!selectedInvoice) return;
    const ok = window.confirm(`Huỷ invoice ${selectedInvoice.invoice_number}?`);
    if (!ok) return;
    await submitEdit({ statusOverride: "VOID" });
  }

  async function submitPayment() {
    if (!selectedInvoice || !paymentForm) return;
    setSavingPayment(true);
    setModalError(null);
    try {
      await apiJson(`/api/v1/invoices/${selectedInvoice.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(paymentForm.amount || 0),
          paid_at: fromInputDateTime(paymentForm.paid_at),
          method: paymentForm.method.trim() || null,
          note: paymentForm.note.trim() || null,
        }),
      });
      const updated = await loadInvoiceDetail(selectedInvoice.id);
      setSelectedInvoice(updated);
      setPaymentOpen(false);
      setPaymentForm(null);
    } catch (e) {
      setModalError((e as Error).message);
    } finally {
      setSavingPayment(false);
    }
  }

  async function submitFullPayment(invoice: Invoice) {
    setLoadingDetail(true);
    setError(null);
    try {
      const detailed = await loadInvoiceDetail(invoice.id);
      const balance = Math.max(Number(detailed.balance_due || 0), 0);
      if (balance <= 0) return;
      await apiJson(`/api/v1/invoices/${invoice.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount: balance,
          paid_at: new Date().toISOString(),
          method: "Full payment",
          note: "Paid in full",
        }),
      });
      await loadInvoiceDetail(invoice.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  }

  function toggleSelectInvoice(invoiceId: number, checked: boolean) {
    setSelectedIds((curr) => {
      if (checked) return curr.includes(invoiceId) ? curr : [...curr, invoiceId];
      return curr.filter((id) => id !== invoiceId);
    });
  }

  function openMerge() {
    if (selectedInvoices.length < 2) return;
    setModalError(null);
    setMergeForm(buildMergeForm(selectedInvoices));
    setMergeOpen(true);
  }

  async function submitMerge() {
    if (selectedInvoices.length < 2) return;
    setSavingMerge(true);
    setModalError(null);
    try {
      const merged = await apiJson<Invoice>("/api/v1/invoices/merge", {
        method: "POST",
        body: JSON.stringify({
          invoice_ids: selectedInvoices.map((invoice) => invoice.id),
          invoice_number: mergeForm.invoice_number.trim() || null,
          issued_at: fromInputDateTime(mergeForm.issued_at),
          due_at: fromInputDateTime(mergeForm.due_at),
        }),
      });
      setSelectedIds([]);
      setMergeOpen(false);
      setItems((curr) => {
        const next = curr.map((invoice) =>
          selectedInvoices.some((selected) => selected.id === invoice.id)
            ? { ...invoice, status: "VOID" as const, merged_into_invoice_id: merged.id }
            : invoice,
        );
        return [merged, ...next.filter((invoice) => invoice.id !== merged.id)];
      });
      await load();
    } catch (e) {
      setModalError((e as Error).message);
    } finally {
      setSavingMerge(false);
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>Invoices</h2>
          <div className="muted">Sửa nhanh nội dung invoice và ghi nhận thanh toán từng lần.</div>
        </div>
        <div className="tableTools">
          <input
            className="input"
            style={{ minWidth: 260 }}
            placeholder="Search invoice..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" onClick={openMerge} disabled={selectedInvoices.length < 2}>
            Gộp invoice
          </button>
          <button className="btn primary" onClick={openCreateInvoice}>
            + Free invoice
          </button>
          <button className="btn" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 44 }} />
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "id"))}>ID{mark("id")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "invoice_number"))}>No{mark("invoice_number")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "customer_name"))}>Customer{mark("customer_name")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "sale_order_id"))}>Sale{mark("sale_order_id")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "status"))}>Invoice{mark("status")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "payment_status"))}>Payment{mark("payment_status")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "total_amount"))}>Total{mark("total_amount")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "amount_paid"))}>Paid{mark("amount_paid")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "balance_due"))}>Balance{mark("balance_due")}</button></th>
              <th style={{ width: 420 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(inv.id)}
                    disabled={!canMergeInvoice(inv)}
                    onChange={(e) => toggleSelectInvoice(inv.id, e.target.checked)}
                  />
                </td>
                <td>{inv.id}</td>
                <td>{inv.invoice_number}</td>
                <td>{inv.customer_name || "-"}</td>
                <td>{inv.sale_order_id ?? "-"}</td>
                <td>
                  {inv.status}
                  {inv.merged_into_invoice_id ? (
                    <div className="muted" style={{ fontSize: 12 }}>MERGED → #{inv.merged_into_invoice_id}</div>
                  ) : null}
                </td>
                <td>{inv.payment_status}</td>
                <td className="right">{formatMoney(inv.total_amount, inv.currency)}</td>
                <td className="right">{formatMoney(inv.amount_paid, inv.currency)}</td>
                <td className="right">{formatMoney(inv.balance_due, inv.currency)}</td>
                <td>
                  <div className="row">
                    <button
                      className="btn"
                      onClick={() => void openEdit(inv)}
                      disabled={loadingDetail || inv.merged_into_invoice_id != null}
                    >
                      Sửa invoice
                    </button>
                    <button
                      className="btn"
                      onClick={() => void openPayment(inv)}
                      disabled={loadingDetail || inv.status === "VOID" || inv.status === "DRAFT" || inv.merged_into_invoice_id != null}
                    >
                      Thanh toán
                    </button>
                    <button
                      className="btn"
                      onClick={() => void submitFullPayment(inv)}
                      disabled={
                        loadingDetail || inv.status === "VOID" || inv.status === "DRAFT" || inv.merged_into_invoice_id != null || Number(inv.balance_due) <= 0
                      }
                    >
                      Thanh toán 100%
                    </button>
                    <button className="btn" onClick={() => void previewFile(`/api/v1/invoices/${inv.id}/pdf`)}>
                      Xem PDF
                    </button>
                    <button
                      className="btn"
                      onClick={() => void downloadFile(`/api/v1/invoices/${inv.id}/pdf`, `invoice-${inv.invoice_number}.pdf`)}
                    >
                      Download PDF
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && displayed.length === 0 && (
              <tr>
                <td colSpan={11} className="muted">
                  No matching invoices.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {mergeOpen && mergeSummary && (
        <div className="modal-backdrop" onClick={() => !savingMerge && setMergeOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>Gộp invoice</h3>
                <div className="muted">Mình sẽ tạo invoice mới và giữ invoice cũ dưới dạng đã merge.</div>
              </div>
              <button className="btn" onClick={() => setMergeOpen(false)} disabled={savingMerge}>Close</button>
            </div>
            {modalError && <div className="error">{modalError}</div>}
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="field">
                <label>Customer</label>
                <div className="input" style={{ display: "flex", alignItems: "center" }}>{mergeSummary.customer}</div>
              </div>
              <div className="field">
                <label>Invoice number (optional)</label>
                <input
                  className="input"
                  value={mergeForm.invoice_number}
                  onChange={(e) => setMergeForm((curr) => ({ ...curr, invoice_number: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Issued at</label>
                <input
                  className="input"
                  type="datetime-local"
                  value={mergeForm.issued_at}
                  onChange={(e) => setMergeForm((curr) => ({ ...curr, issued_at: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Due at</label>
                <input
                  className="input"
                  type="datetime-local"
                  value={mergeForm.due_at}
                  onChange={(e) => setMergeForm((curr) => ({ ...curr, due_at: e.target.value }))}
                />
              </div>
            </div>

            <div className="totalsBox" style={{ marginTop: 16 }}>
              <div className="totalsRow"><span>Total</span><strong>{formatMoney(mergeSummary.total, mergeSummary.currency)}</strong></div>
              <div className="totalsRow"><span>Paid</span><strong>{formatMoney(mergeSummary.paid, mergeSummary.currency)}</strong></div>
              <div className="totalsRow totalsGrand"><span>Balance</span><strong>{formatMoney(mergeSummary.balance, mergeSummary.currency)}</strong></div>
            </div>

            <div style={{ marginTop: 16, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>No</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th className="right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{invoice.id}</td>
                      <td>{invoice.invoice_number}</td>
                      <td>{invoice.status}</td>
                      <td>{invoice.payment_status}</td>
                      <td className="right">{formatMoney(invoice.total_amount, invoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn" onClick={() => setMergeOpen(false)} disabled={savingMerge}>Cancel</button>
              <button className="btn primary" onClick={() => void submitMerge()} disabled={savingMerge}>
                {savingMerge ? "Merging..." : "Merge invoices"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editOpen && editForm && (
        <div className="modal-backdrop" onClick={() => !savingEdit && setEditOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>
                  {editMode === "create" ? "Tạo free invoice" : `Sửa invoice ${selectedInvoice?.invoice_number ?? ""}`}
                </h3>
                <div className="muted">
                  {editMode === "create"
                    ? "Tạo invoice thủ công, lưu nháp nhiều lần rồi preview trước khi phát hành."
                    : "Mình cho sửa header, thông tin khách và line item trực tiếp, kể cả draft."}
                </div>
              </div>
              <button className="btn" onClick={() => setEditOpen(false)} disabled={savingEdit}>Close</button>
            </div>
            {modalError && <div className="error">{modalError}</div>}
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="field">
                <label>Invoice number {editMode === "create" ? "(optional)" : ""}</label>
                <input
                  className="input"
                  value={editForm.invoice_number}
                  placeholder={editMode === "create" ? "Để trống để hệ thống tự cấp số" : ""}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, invoice_number: e.target.value } : curr)}
                />
                {editMode === "create" ? (
                  <div className="muted" style={{ marginTop: 6 }}>
                    Mẹo: cứ để trống ô này khi lưu nháp hoặc preview, hệ thống sẽ tự tạo số invoice.
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>Issued at</label>
                <input
                  className="input"
                  type="datetime-local"
                  value={editForm.issued_at}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, issued_at: e.target.value } : curr)}
                />
              </div>
              <div className="field">
                <label>Due at</label>
                <input
                  className="input"
                  type="datetime-local"
                  value={editForm.due_at}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, due_at: e.target.value } : curr)}
                />
              </div>
              <div className="field">
                <label>Invoice status</label>
                <select
                  className="select"
                  value={editForm.status}
                  onChange={(e) =>
                    setEditForm((curr) => (curr ? { ...curr, status: e.target.value as "DRAFT" | "ISSUED" | "VOID" } : curr))
                  }
                >
                  <option value="DRAFT">DRAFT</option>
                  <option value="ISSUED">ISSUED</option>
                  <option value="VOID">VOID</option>
                </select>
              </div>
              <div className="field">
                <label>Currency</label>
                <input
                  className="input"
                  value={editForm.currency}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, currency: e.target.value.toUpperCase() } : curr)}
                />
              </div>
            </div>

            <div className="row" style={{ marginTop: 12, alignItems: "flex-start" }}>
              <div className="field">
                <label>Chọn client</label>
                <select
                  className="select"
                  value={selectedCustomerId}
                  onChange={(e) => applyCustomerToForm(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">-- Nhập tay / Walk-in --</option>
                  {sortedCustomers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Customer name</label>
                <input
                  className="input"
                  value={editForm.client_name_snapshot}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, client_name_snapshot: e.target.value } : curr)}
                />
              </div>
              <div className="field">
                <label>Phone</label>
                <input
                  className="input"
                  value={editForm.tele_snapshot}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, tele_snapshot: e.target.value } : curr)}
                />
              </div>
              <div className="field" style={{ minWidth: 320, flex: 1 }}>
                <label>Address</label>
                <input
                  className="input"
                  value={editForm.address_snapshot}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, address_snapshot: e.target.value } : curr)}
                />
              </div>
              <div className="field">
                <label>City</label>
                <input
                  className="input"
                  value={editForm.city_snapshot}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, city_snapshot: e.target.value } : curr)}
                />
              </div>
              <div className="field">
                <label>ZIP</label>
                <input
                  className="input"
                  value={editForm.zip_code_snapshot}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, zip_code_snapshot: e.target.value } : curr)}
                />
              </div>
            </div>

            <div className="row" style={{ marginTop: 12, alignItems: "flex-start" }}>
              <div className="field">
                <label>Tax rate</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={editForm.tax_rate}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, tax_rate: e.target.value } : curr)}
                />
              </div>
              <div className="field">
                <label>Order discount</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.order_discount_amount}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, order_discount_amount: e.target.value } : curr)}
                />
              </div>
              <div className="field">
                <label>Shipping</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.shipping_amount}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, shipping_amount: e.target.value } : curr)}
                />
              </div>
              <div className="field" style={{ minWidth: 320, flex: 1 }}>
                <label>Invoice note</label>
                <input
                  className="input"
                  placeholder="Ví dụ: lò bánh mì"
                  value={editForm.note}
                  onChange={(e) => setEditForm((curr) => curr ? { ...curr, note: e.target.value } : curr)}
                />
              </div>
            </div>

            <div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}>
              <div className="muted">Template Excel chỉ import các dòng item. Khách hàng và thông tin header nhập một lần ở form này.</div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void downloadFile("/api/v1/invoices/manual/template.xlsx", "free-invoice-template.xlsx")}
                >
                  Template Excel
                </button>
                <label className="btn" style={{ cursor: importingLines ? "not-allowed" : "pointer", opacity: importingLines ? 0.6 : 1 }}>
                  Import Excel
                  <input
                    type="file"
                    accept=".xlsx"
                    style={{ display: "none" }}
                    disabled={importingLines}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void importInvoiceExcel(file);
                    }}
                  />
                </label>
                <button className="btn" type="button" onClick={addFreeLine}>
                  + Dòng tự do
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Type</th>
                    <th>SKU</th>
                    <th>Description</th>
                    <th>UOM</th>
                    <th>Qty</th>
                    <th>Unit price</th>
                    <th>Discount</th>
                    <th className="right">Line total</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {editForm.lines.map((line, index) => {
                    const lineSubtotal = Math.max(Number(line.quantity) || 0, 0) * Math.max(Number(line.unit_price) || 0, 0);
                    const lineTotal = Math.max(lineSubtotal - Math.max(Number(line.discount_amount) || 0, 0), 0);
                    return (
                      <tr
                        key={line.id ?? `free-${index}`}
                        className={
                          draggedLineIndex === index
                            ? "invoiceLineRow dragging"
                            : dragOverLineIndex === index
                              ? "invoiceLineRow dragOver"
                              : "invoiceLineRow"
                        }
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (dragOverLineIndex !== index) setDragOverLineIndex(index);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleLineDrop(index);
                        }}
                      >
                        <td>{index + 1}</td>
                        <td>{line.line_type}</td>
                        <td>
                          <input
                            className="input"
                            value={line.sku}
                            onChange={(e) =>
                              setEditForm((curr) =>
                                curr
                                  ? {
                                      ...curr,
                                      lines: curr.lines.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, sku: e.target.value }
                                          : item,
                                      ),
                                    }
                                  : curr,
                              )
                            }
                            placeholder={line.line_type === "FREE" ? "Optional" : ""}
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            value={line.product_name}
                            onChange={(e) =>
                              setEditForm((curr) =>
                                curr
                                  ? {
                                      ...curr,
                                      lines: curr.lines.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, product_name: e.target.value }
                                          : item,
                                      ),
                                    }
                                  : curr,
                              )
                            }
                            placeholder={line.line_type === "FREE" ? "Service / fee / custom item" : ""}
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            value={line.uom}
                            onChange={(e) =>
                              setEditForm((curr) =>
                                curr
                                  ? {
                                      ...curr,
                                      lines: curr.lines.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, uom: e.target.value }
                                          : item,
                                      ),
                                    }
                                  : curr,
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            type="number"
                            min="1"
                            step="1"
                            value={line.quantity}
                            onChange={(e) =>
                              setEditForm((curr) =>
                                curr
                                  ? {
                                      ...curr,
                                      lines: curr.lines.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, quantity: e.target.value }
                                          : item,
                                      ),
                                    }
                                  : curr,
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unit_price}
                            onChange={(e) =>
                              setEditForm((curr) =>
                                curr
                                  ? {
                                      ...curr,
                                      lines: curr.lines.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, unit_price: e.target.value }
                                          : item,
                                      ),
                                    }
                                  : curr,
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.discount_amount}
                            onChange={(e) =>
                              setEditForm((curr) =>
                                curr
                                  ? {
                                      ...curr,
                                      lines: curr.lines.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, discount_amount: e.target.value }
                                          : item,
                                      ),
                                    }
                                  : curr,
                              )
                            }
                          />
                        </td>
                        <td className="right">{lineTotal.toFixed(2)}</td>
                        <td>
                          <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                            <button
                              className="btn"
                              type="button"
                              draggable
                              title="Kéo để đổi thứ tự"
                              onDragStart={(e) => handleLineDragStart(index, e)}
                              onDragEnd={resetLineDrag}
                            >
                              ↕ Drag
                            </button>
                            <button className="btn" type="button" onClick={() => removeLine(index)} disabled={editForm.lines.length <= 1}>
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {editSummary && (
              <div className="totalsBox" style={{ marginTop: 16 }}>
                <div className="totalsRow"><span>Subtotal</span><strong>{formatMoney(editSummary.subtotal, editForm.currency)}</strong></div>
                <div className="totalsRow"><span>Line discounts</span><strong>{formatMoney(editSummary.lineDiscounts, editForm.currency)}</strong></div>
                <div className="totalsRow"><span>Order discount</span><strong>{formatMoney(editSummary.orderDiscount, editForm.currency)}</strong></div>
                <div className="totalsRow"><span>Tax</span><strong>{formatMoney(editSummary.tax, editForm.currency)}</strong></div>
                <div className="totalsRow totalsGrand"><span>Total</span><strong>{formatMoney(editSummary.total, editForm.currency)}</strong></div>
              </div>
            )}

            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn" onClick={() => void cancelInvoice()} disabled={savingEdit || editMode === "create"}>
                Huỷ invoice
              </button>
              <button className="btn" onClick={() => setEditOpen(false)} disabled={savingEdit}>Cancel</button>
              <button
                className="btn"
                onClick={() => void submitEdit({ statusOverride: "DRAFT", closeAfterSave: false })}
                disabled={savingEdit}
              >
                {savingEdit ? "Saving..." : "Save draft"}
              </button>
              <button
                className="btn"
                onClick={() => void submitEdit({ statusOverride: "DRAFT", closeAfterSave: false, previewAfterSave: true })}
                disabled={savingEdit}
              >
                {savingEdit ? "Saving..." : "Preview draft"}
              </button>
              <button className="btn primary" onClick={() => void submitEdit({ statusOverride: "ISSUED" })} disabled={savingEdit}>
                {savingEdit ? "Saving..." : editMode === "create" ? "Issue invoice" : "Save & issue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentOpen && selectedInvoice && paymentForm && (
        <div className="modal-backdrop" onClick={() => !savingPayment && setPaymentOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>Ghi nhận thanh toán {selectedInvoice.invoice_number}</h3>
                <div className="muted">Có thể nhập partial payment nhiều lần, hệ thống tự tính còn nợ.</div>
              </div>
              <button className="btn" onClick={() => setPaymentOpen(false)} disabled={savingPayment}>Close</button>
            </div>
            {modalError && <div className="error">{modalError}</div>}
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="field">
                <label>Total</label>
                <div className="input" style={{ display: "flex", alignItems: "center" }}>
                  {formatMoney(selectedInvoice.total_amount, selectedInvoice.currency)}
                </div>
              </div>
              <div className="field">
                <label>Paid</label>
                <div className="input" style={{ display: "flex", alignItems: "center" }}>
                  {formatMoney(selectedInvoice.amount_paid, selectedInvoice.currency)}
                </div>
              </div>
              <div className="field">
                <label>Balance</label>
                <div className="input" style={{ display: "flex", alignItems: "center" }}>
                  {formatMoney(selectedInvoice.balance_due, selectedInvoice.currency)}
                </div>
              </div>
            </div>

            <div className="row" style={{ marginTop: 12, alignItems: "flex-start" }}>
              <div className="field">
                <label>Amount</label>
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm((curr) => curr ? { ...curr, amount: e.target.value } : curr)}
                />
              </div>
              <div className="field">
                <label>Paid at</label>
                <input
                  className="input"
                  type="datetime-local"
                  value={paymentForm.paid_at}
                  onChange={(e) => setPaymentForm((curr) => curr ? { ...curr, paid_at: e.target.value } : curr)}
                />
              </div>
              <div className="field">
                <label>Method</label>
                <input
                  className="input"
                  placeholder="Cash / Bank / Zelle..."
                  value={paymentForm.method}
                  onChange={(e) => setPaymentForm((curr) => curr ? { ...curr, method: e.target.value } : curr)}
                />
              </div>
              <div className="field" style={{ minWidth: 280, flex: 1 }}>
                <label>Note</label>
                <input
                  className="input"
                  placeholder="Optional"
                  value={paymentForm.note}
                  onChange={(e) => setPaymentForm((curr) => curr ? { ...curr, note: e.target.value } : curr)}
                />
              </div>
            </div>

            <div style={{ marginTop: 16, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Paid at</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>By</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{new Date(payment.paid_at).toLocaleString()}</td>
                      <td>{formatMoney(payment.amount, selectedInvoice.currency)}</td>
                      <td>{payment.method || "-"}</td>
                      <td>{payment.created_by || "-"}</td>
                      <td>{payment.note || "-"}</td>
                    </tr>
                  ))}
                  {selectedInvoice.payments.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">Chưa có payment nào.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button
                className="btn"
                onClick={() =>
                  setPaymentForm((curr) =>
                    curr && selectedInvoice
                      ? {
                          ...curr,
                          amount: Math.max(Number(selectedInvoice.balance_due || 0), 0).toFixed(2),
                          method: curr.method || "Full payment",
                          note: curr.note || "Paid in full",
                        }
                      : curr,
                  )
                }
                disabled={savingPayment}
              >
                Điền 100%
              </button>
              <button className="btn" onClick={() => setPaymentOpen(false)} disabled={savingPayment}>Cancel</button>
              <button className="btn primary" onClick={() => void submitPayment()} disabled={savingPayment}>
                {savingPayment ? "Saving..." : "Record payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
