import { useMemo, useState } from "react";
import Modal from "./Modal";
import type { Category, Product } from "../types";

export default function ProductPickerModal({
  open,
  products,
  categories,
  onAdd,
  onClose,
}: {
  open: boolean;
  products: Product[];
  categories: Category[];
  onAdd: (product: Product) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");

  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => {
        if (categoryId !== "" && p.category_id !== categoryId) return false;
        if (!q) return true;
        return `${p.sku} ${p.name}`.toLowerCase().includes(q);
      })
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [products, query, categoryId]);

  return (
    <Modal open={open} title="Chọn sản phẩm" onClose={onClose}>
      <div className="row" style={{ alignItems: "stretch", marginBottom: 10 }}>
        <div className="field" style={{ flex: 1, minWidth: 260 }}>
          <label>Search</label>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SKU hoặc tên…"
          />
        </div>
        <div className="field" style={{ width: 260 }}>
          <label>Category</label>
          <select
            className="select"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Category</th>
              <th>UOM</th>
              <th className="right">Price</th>
              <th className="right">On hand (UOM)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td>{p.sku}</td>
                <td>{p.name}</td>
                <td>{p.category_id ? categoryNameById.get(p.category_id) ?? "" : ""}</td>
                <td>
                  {p.uom}
                  {p.uom_multiplier > 1 ? <span className="muted"> (x{p.uom_multiplier})</span> : null}
                </td>
                <td className="right">
                  {p.unit_price} {p.currency}
                </td>
                <td className="right">
                  {p.uom_multiplier > 0 ? (p.quantity_on_hand / p.uom_multiplier).toFixed(2) : ""}
                </td>
                <td className="right">
                  <button className="btn primary" type="button" onClick={() => onAdd(p)}>
                    Add
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No products.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ marginTop: 10 }}>
        Tip: bấm Add để thêm vào đơn; bạn có thể giữ popup mở để thêm nhiều món.
      </div>
    </Modal>
  );
}

