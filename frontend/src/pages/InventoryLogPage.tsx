import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import type { Product, StockMovement } from "../types";
import { NavLink } from "react-router-dom";

function fmtDelta(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

export default function InventoryLogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, m] = await Promise.all([
        apiJson<Product[]>("/api/v1/products"),
        apiJson<StockMovement[]>("/api/v1/inventory/movements?limit=200"),
      ]);
      setProducts(p);
      setMovements(m);
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
        <h2 style={{ margin: 0 }}>Tồn kho / In-Out Log</h2>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        Ledger các lần nhập/xuất/điều chỉnh (theo base units). Phiếu Receive/Issue sẽ có link receipt_id/issue_id.
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

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Time</th>
              <th>Type</th>
              <th>SKU</th>
              <th>Product</th>
              <th className="right">Delta (base)</th>
              <th>Source</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => {
              const p = productById.get(m.product_id);
              const source =
                m.receipt_id != null
                  ? `Receipt#${m.receipt_id}`
                  : m.issue_id != null
                    ? `Issue#${m.issue_id}`
                    : m.sale_order_id != null
                      ? `Sale#${m.sale_order_id}`
                      : "-";
              return (
                <tr key={m.id}>
                  <td>{m.id}</td>
                  <td>{new Date(m.created_at).toLocaleString()}</td>
                  <td>{m.movement_type}</td>
                  <td>{p?.sku ?? ""}</td>
                  <td>{p?.name ?? ""}</td>
                  <td className="right">{fmtDelta(m.quantity_delta)}</td>
                  <td>{source}</td>
                  <td>{m.note ?? ""}</td>
                </tr>
              );
            })}
            {!loading && movements.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No movements yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
