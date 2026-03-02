import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { apiJson } from "../api/client";
import type { InventoryReceiptSummary } from "../types";
import type { SortState } from "../utils/table";
import { matchesQuery, sortBy, toggleSort } from "../utils/table";

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function InventorySummaryPage() {
  const [rows, setRows] = useState<InventoryReceiptSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [categorySort, setCategorySort] = useState<
    SortState<"category_name" | "products" | "received_base_qty" | "on_hand_base_qty" | "value">
  >({
    key: "category_name",
    dir: "asc",
  });
  const [detailSort, setDetailSort] = useState<
    SortState<"category_name" | "sku" | "product_name" | "received_base" | "received_sale" | "onhand" | "receipts" | "lines" | "value" | "last_received">
  >({
    key: "last_received",
    dir: "desc",
  });

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
    return Array.from(grouped.values());
  }, [rows]);

  const displayedCategoryRows = useMemo(() => {
    const filtered = categoryRows.filter((row) => matchesQuery(query, row.category_name));
    return sortBy(
      filtered,
      (row) => {
        switch (categorySort.key) {
          case "category_name":
            return row.category_name;
          case "products":
            return row.products;
          case "received_base_qty":
            return row.received_base_qty;
          case "on_hand_base_qty":
            return row.on_hand_base_qty;
          case "value":
            return row.value;
          default:
            return row.category_name;
        }
      },
      categorySort.dir,
    );
  }, [categoryRows, query, categorySort]);

  const displayedRows = useMemo(() => {
    const filtered = rows.filter((row) =>
      matchesQuery(query, row.category_name || "No category", row.sku, row.product_name),
    );
    return sortBy(
      filtered,
      (row) => {
        switch (detailSort.key) {
          case "category_name":
            return row.category_name || "No category";
          case "sku":
            return row.sku;
          case "product_name":
            return row.product_name;
          case "received_base":
            return row.total_received_base_qty;
          case "received_sale":
            return toNumber(row.total_received_sale_qty);
          case "onhand":
            return row.quantity_on_hand;
          case "receipts":
            return row.receipt_count;
          case "lines":
            return row.line_count;
          case "value":
            return toNumber(row.total_received_amount);
          case "last_received":
            return row.last_received_at ? new Date(row.last_received_at).getTime() : 0;
          default:
            return row.product_name;
        }
      },
      detailSort.dir,
    );
  }, [rows, query, detailSort]);

  function markCategory(col: typeof categorySort.key): string {
    if (categorySort.key !== col) return "";
    return categorySort.dir === "asc" ? " ↑" : " ↓";
  }

  function markDetail(col: typeof detailSort.key): string {
    if (detailSort.key !== col) return "";
    return detailSort.dir === "asc" ? " ↑" : " ↓";
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Inventory</h2>
        <div className="tableTools">
          <input
            className="input"
            style={{ minWidth: 260 }}
            placeholder="Search category / SKU / product..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
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
              <th><button className="thSortBtn" type="button" onClick={() => setCategorySort((s) => toggleSort(s, "category_name"))}>Category{markCategory("category_name")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setCategorySort((s) => toggleSort(s, "products"))}>Products{markCategory("products")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setCategorySort((s) => toggleSort(s, "received_base_qty"))}>Received (base){markCategory("received_base_qty")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setCategorySort((s) => toggleSort(s, "on_hand_base_qty"))}>On hand (base){markCategory("on_hand_base_qty")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setCategorySort((s) => toggleSort(s, "value"))}>Value{markCategory("value")}</button></th>
            </tr>
          </thead>
          <tbody>
            {displayedCategoryRows.map((row) => (
              <tr key={row.category_name}>
                <td>{row.category_name}</td>
                <td className="right">{row.products}</td>
                <td className="right">{row.received_base_qty}</td>
                <td className="right">{row.on_hand_base_qty}</td>
                <td className="right">{row.value.toFixed(2)} USD</td>
              </tr>
            ))}
            {!loading && displayedCategoryRows.length === 0 && (
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
              <th><button className="thSortBtn" type="button" onClick={() => setDetailSort((s) => toggleSort(s, "category_name"))}>Category{markDetail("category_name")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setDetailSort((s) => toggleSort(s, "sku"))}>SKU{markDetail("sku")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setDetailSort((s) => toggleSort(s, "product_name"))}>Product{markDetail("product_name")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setDetailSort((s) => toggleSort(s, "received_base"))}>Received (base){markDetail("received_base")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setDetailSort((s) => toggleSort(s, "received_sale"))}>Received (sale){markDetail("received_sale")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setDetailSort((s) => toggleSort(s, "onhand"))}>On hand (base){markDetail("onhand")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setDetailSort((s) => toggleSort(s, "receipts"))}>Receipts{markDetail("receipts")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setDetailSort((s) => toggleSort(s, "lines"))}>Lines{markDetail("lines")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setDetailSort((s) => toggleSort(s, "value"))}>Value{markDetail("value")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setDetailSort((s) => toggleSort(s, "last_received"))}>Last received{markDetail("last_received")}</button></th>
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((row) => (
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
            {!loading && displayedRows.length === 0 && (
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
