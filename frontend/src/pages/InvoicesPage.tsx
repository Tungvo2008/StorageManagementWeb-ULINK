import { useEffect, useMemo, useState } from "react";
import { apiJson, downloadFile } from "../api/client";
import type { Invoice } from "../types";
import type { SortState } from "../utils/table";
import { matchesQuery, sortBy, toggleSort } from "../utils/table";

export default function InvoicesPage() {
  const [items, setItems] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<
    SortState<"id" | "invoice_number" | "customer_name" | "sale_order_id" | "status" | "total_amount">
  >({
    key: "id",
    dir: "desc",
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<Invoice[]>("/api/v1/invoices");
      setItems(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
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
        inv.total_amount,
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
          case "total_amount":
            return Number(inv.total_amount);
          default:
            return inv.id;
        }
      },
      sort.dir,
    );
  }, [items, query, sort]);

  function mark(col: typeof sort.key): string {
    if (sort.key !== col) return "";
    return sort.dir === "asc" ? " ↑" : " ↓";
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Invoices</h2>
        <div className="tableTools">
          <input
            className="input"
            style={{ minWidth: 260 }}
            placeholder="Search invoice..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "id"))}>ID{mark("id")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "invoice_number"))}>No{mark("invoice_number")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "customer_name"))}>Customer{mark("customer_name")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "sale_order_id"))}>Sale{mark("sale_order_id")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "status"))}>Status{mark("status")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "total_amount"))}>Total{mark("total_amount")}</button></th>
              <th style={{ width: 180 }}>Export</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.id}</td>
                <td>{inv.invoice_number}</td>
                <td>{inv.customer_name || "-"}</td>
                <td>{inv.sale_order_id}</td>
                <td>{inv.status}</td>
                <td className="right">
                  {inv.total_amount} {inv.currency}
                </td>
                <td>
                  <div className="row">
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
                <td colSpan={7} className="muted">
                  No matching invoices.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
