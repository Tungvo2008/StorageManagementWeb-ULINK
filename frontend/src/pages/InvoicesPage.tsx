import { useEffect, useState } from "react";
import { apiJson, downloadFile } from "../api/client";
import type { Invoice } from "../types";

export default function InvoicesPage() {
  const [items, setItems] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Invoices</h2>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>No</th>
              <th>Sale</th>
              <th>Status</th>
              <th className="right">Total</th>
              <th style={{ width: 180 }}>Export</th>
            </tr>
          </thead>
          <tbody>
            {items.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.id}</td>
                <td>{inv.invoice_number}</td>
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
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No invoices yet. Create a sale, then issue invoice.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
