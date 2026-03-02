import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import type { Product, StockMovement } from "../types";
import { NavLink } from "react-router-dom";
import type { SortState } from "../utils/table";
import { matchesQuery, sortBy, toggleSort } from "../utils/table";

function fmtDelta(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

export default function InventoryLogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState<"id" | "time" | "type" | "sku" | "product" | "delta" | "source">>({
    key: "id",
    dir: "desc",
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const rows = useMemo(() => {
    return movements.map((m) => {
      const p = productById.get(m.product_id);
      const source =
        m.receipt_id != null
          ? `Receipt#${m.receipt_id}`
          : m.issue_id != null
            ? `Issue#${m.issue_id}`
            : m.sale_order_id != null
              ? `Sale#${m.sale_order_id}`
              : "-";
      return {
        movement: m,
        sku: p?.sku ?? "",
        productName: p?.name ?? "",
        source,
      };
    });
  }, [movements, productById]);

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

  const displayed = useMemo(() => {
    const filtered = rows.filter((row) =>
      matchesQuery(
        query,
        row.movement.id,
        row.movement.movement_type,
        row.sku,
        row.productName,
        row.source,
        row.movement.note,
      ),
    );
    return sortBy(
      filtered,
      (row) => {
        switch (sort.key) {
          case "id":
            return row.movement.id;
          case "time":
            return new Date(row.movement.created_at).getTime();
          case "type":
            return row.movement.movement_type;
          case "sku":
            return row.sku;
          case "product":
            return row.productName;
          case "delta":
            return row.movement.quantity_delta;
          case "source":
            return row.source;
          default:
            return row.movement.id;
        }
      },
      sort.dir,
    );
  }, [rows, query, sort]);

  function mark(col: typeof sort.key): string {
    if (sort.key !== col) return "";
    return sort.dir === "asc" ? " ↑" : " ↓";
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Tồn kho / In-Out Log</h2>
        <div className="tableTools">
          <input
            className="input"
            style={{ minWidth: 260 }}
            placeholder="Search movement..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
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
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "id"))}>ID{mark("id")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "time"))}>Time{mark("time")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "type"))}>Type{mark("type")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "sku"))}>SKU{mark("sku")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "product"))}>Product{mark("product")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "delta"))}>Delta (base){mark("delta")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "source"))}>Source{mark("source")}</button></th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((row) => {
              const m = row.movement;
              return (
                <tr key={m.id}>
                  <td>{m.id}</td>
                  <td>{new Date(m.created_at).toLocaleString()}</td>
                  <td>{m.movement_type}</td>
                  <td>{row.sku}</td>
                  <td>{row.productName}</td>
                  <td className="right">{fmtDelta(m.quantity_delta)}</td>
                  <td>{row.source}</td>
                  <td>{m.note ?? ""}</td>
                </tr>
              );
            })}
            {!loading && displayed.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No matching movements.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
