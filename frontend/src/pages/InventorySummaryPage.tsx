import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { apiJson } from "../api/client";
import type { InventoryReceiptSummary } from "../types";

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function InventorySummaryPage() {
  const [rows, setRows] = useState<InventoryReceiptSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<InventoryReceiptSummary[]>("/api/v1/inventory/receipt-summary");
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.products += 1;
        acc.categories.add(row.category_name?.trim() || "No category");
        acc.receipts += row.receipt_count;
        acc.receivedBase += row.total_received_base_qty;
        acc.onHandBase += row.quantity_on_hand;
        acc.receivedAmount += toNumber(row.total_received_amount);
        return acc;
      },
      { products: 0, categories: new Set<string>(), receipts: 0, receivedBase: 0, onHandBase: 0, receivedAmount: 0 }
    );
  }, [rows]);

  const categoryRows = useMemo(() => {
    const grouped = new Map<
      string,
      { category_name: string; products: number; received_base_qty: number; on_hand_base_qty: number; value: number }
    >();
    for (const row of rows) {
      const categoryName = row.category_name?.trim() || "No category";
      const current = grouped.get(categoryName) ?? {
        category_name: categoryName,
        products: 0,
        received_base_qty: 0,
        on_hand_base_qty: 0,
        value: 0,
      };
      current.products += 1;
      current.received_base_qty += row.total_received_base_qty;
      current.on_hand_base_qty += row.quantity_on_hand;
      current.value += toNumber(row.total_received_amount);
      grouped.set(categoryName, current);
    }
    return Array.from(grouped.values()).sort((a, b) => a.category_name.localeCompare(b.category_name));
  }, [rows]);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Inventory</h2>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        Thống kê tổng hợp tất cả sản phẩm đã nhập kho từ receipt lines.
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

      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <span className="pill">Products: {totals.products}</span>
        <span className="pill">Categories: {totals.categories.size}</span>
        <span className="pill">Receipt refs: {totals.receipts}</span>
        <span className="pill">Received (base): {totals.receivedBase}</span>
        <span className="pill">On hand (base): {totals.onHandBase}</span>
        <span className="pill">Value: {totals.receivedAmount.toFixed(2)} USD</span>
      </div>

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th className="right">Products</th>
              <th className="right">Received (base)</th>
              <th className="right">On hand (base)</th>
              <th className="right">Value</th>
            </tr>
          </thead>
          <tbody>
            {categoryRows.map((row) => (
              <tr key={row.category_name}>
                <td>{row.category_name}</td>
                <td className="right">{row.products}</td>
                <td className="right">{row.received_base_qty}</td>
                <td className="right">{row.on_hand_base_qty}</td>
                <td className="right">{row.value.toFixed(2)} USD</td>
              </tr>
            ))}
            {!loading && categoryRows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Chưa có dữ liệu theo category.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error && <div className="error">{error}</div>}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>SKU</th>
              <th>Product</th>
              <th className="right">Received (base)</th>
              <th className="right">Received (sale)</th>
              <th className="right">On hand (base)</th>
              <th className="right">Receipts</th>
              <th className="right">Lines</th>
              <th className="right">Value</th>
              <th>Last received</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.product_id}>
                <td>{row.category_name || "No category"}</td>
                <td>{row.sku}</td>
                <td>{row.product_name}</td>
                <td className="right">
                  {row.total_received_base_qty} {row.base_uom}
                </td>
                <td className="right">
                  {toNumber(row.total_received_sale_qty).toFixed(2)} {row.uom}
                </td>
                <td className="right">
                  {row.quantity_on_hand} {row.base_uom}
                </td>
                <td className="right">{row.receipt_count}</td>
                <td className="right">{row.line_count}</td>
                <td className="right">
                  {toNumber(row.total_received_amount).toFixed(2)} {row.currency}
                </td>
                <td>{row.last_received_at ? new Date(row.last_received_at).toLocaleString() : "-"}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  Chưa có dữ liệu nhập kho.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
