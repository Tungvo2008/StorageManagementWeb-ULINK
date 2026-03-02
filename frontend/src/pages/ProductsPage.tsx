import { Fragment, useEffect, useMemo, useState } from "react";
import { apiJson, apiUpload, downloadFile } from "../api/client";
import type { Category, Product } from "../types";
import type { FormEvent } from "react";
import Modal from "../components/Modal";
import type { SortState } from "../utils/table";
import { compareValues, matchesQuery, toggleSort } from "../utils/table";

type ProductCreate = {
  sku: string;
  name: string;
  base_uom?: string | null;
  uom?: string | null;
  is_active: boolean;
};

type ProductUpdate = {
  category_id?: number | null;
  sku?: string | null;
  name?: string | null;
  image_url?: string | null;
  base_uom?: string | null;
  unit_price?: string | null;
  currency?: string | null;
  uom?: string | null;
  uom_multiplier?: number | null;
  is_active?: boolean | null;
};

type ProductImportResult = {
  created: number;
  updated: number;
};

export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState<"id" | "sku" | "name" | "unit_price" | "quantity_on_hand" | "is_active">>({
    key: "sku",
    dir: "asc",
  });

  const [form, setForm] = useState<ProductCreate>({
    sku: "",
    name: "",
    base_uom: "Pc",
    uom: "Dozen",
    is_active: true,
  });

  const [editId, setEditId] = useState<number | "">("");
  const [editForm, setEditForm] = useState<ProductUpdate>({});
  const [editOpen, setEditOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, c] = await Promise.all([
        apiJson<Product[]>("/api/v1/products"),
        apiJson<Category[]>("/api/v1/categories"),
      ]);
      setItems(p);
      setCategories(c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiJson<Product>("/api/v1/products", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ sku: "", name: "", base_uom: "Pc", uom: "Dozen", is_active: true });
      setAddProductOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onImportProducts(file: File) {
    setImportBusy(true);
    setError(null);
    setImportInfo(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await apiUpload<ProductImportResult>("/api/v1/products/import", fd);
      setImportInfo(`Imported: created ${result.created}, updated ${result.updated}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }

  async function onCreateCategory(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      await apiJson<Category>("/api/v1/categories", { method: "POST", body: JSON.stringify({ name }) });
      setNewCategoryName("");
      setAddCategoryOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const grouped = useMemo(() => {
    const byKey = new Map<string, { key: string; categoryId: number | null; name: string; items: Product[] }>();
    for (const p of items) {
      const categoryNameForFilter = p.category_id != null ? categoryNameById.get(p.category_id) ?? "" : "Uncategorized";
      if (!matchesQuery(query, p.id, p.sku, p.name, categoryNameForFilter, p.currency, p.uom)) continue;
      const key = p.category_id != null ? String(p.category_id) : "uncat";
      const name =
        p.category_id != null ? categoryNameById.get(p.category_id) ?? `Category #${p.category_id}` : "Uncategorized";
      if (!byKey.has(key)) byKey.set(key, { key, categoryId: p.category_id, name, items: [] });
      byKey.get(key)!.items.push(p);
    }
    const groups = Array.from(byKey.values());
    groups.sort((a, b) => {
      if (a.categoryId == null && b.categoryId != null) return 1;
      if (a.categoryId != null && b.categoryId == null) return -1;
      return a.name.localeCompare(b.name);
    });
    for (const g of groups) {
      g.items.sort((a, b) => {
        const av =
          sort.key === "id"
            ? a.id
            : sort.key === "sku"
              ? a.sku
              : sort.key === "name"
                ? a.name
                : sort.key === "unit_price"
                  ? Number(a.unit_price)
                  : sort.key === "quantity_on_hand"
                    ? a.quantity_on_hand
                    : a.is_active ? 1 : 0;
        const bv =
          sort.key === "id"
            ? b.id
            : sort.key === "sku"
              ? b.sku
              : sort.key === "name"
                ? b.name
                : sort.key === "unit_price"
                  ? Number(b.unit_price)
                  : sort.key === "quantity_on_hand"
                    ? b.quantity_on_hand
                    : b.is_active ? 1 : 0;
        const base = compareValues(av, bv);
        return sort.dir === "asc" ? base : -base;
      });
    }
    return groups;
  }, [items, categoryNameById, query, sort]);

  function mark(col: typeof sort.key): string {
    if (sort.key !== col) return "";
    return sort.dir === "asc" ? " ↑" : " ↓";
  }

  function isExpanded(key: string): boolean {
    return expanded[key] ?? true;
  }

  function toggle(key: string) {
    setExpanded((s) => ({ ...s, [key]: !(s[key] ?? true) }));
  }

  function onSelectEdit(idStr: string) {
    if (!idStr) {
      setEditId("");
      setEditForm({});
      setEditOpen(false);
      return;
    }
    const id = Number(idStr);
    const p = items.find((x) => x.id === id);
    if (!p) return;
    setEditId(id);
    setEditForm({
      category_id: p.category_id,
      sku: p.sku,
      name: p.name,
      image_url: p.image_url,
      base_uom: p.base_uom,
      unit_price: p.unit_price,
      currency: p.currency,
      uom: p.uom,
      uom_multiplier: p.uom_multiplier,
      is_active: p.is_active,
    });
    setEditOpen(true);
  }

  async function onUpdateProduct(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (editId === "") return;
    try {
      await apiJson<Product>(`/api/v1/products/${editId}`, {
        method: "PATCH",
        body: JSON.stringify(editForm),
      });
      setEditOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: 1, minWidth: 340 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Products</h2>
          <div className="tableTools">
            <input
              className="input"
              style={{ minWidth: 260 }}
              placeholder="Search product..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className="btn"
              type="button"
              onClick={() => void downloadFile("/api/v1/products/template.xlsx", "products-import-template.xlsx")}
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
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void onImportProducts(file);
                }}
              />
            </label>
            <button
              className="btn"
              type="button"
              onClick={() => void downloadFile("/api/v1/products/export.xlsx", "products-export.xlsx")}
            >
              Export Excel
            </button>
            <button className="btn" type="button" onClick={() => setAddCategoryOpen(true)}>
              + Category
            </button>
            <button className="btn primary" type="button" onClick={() => setAddProductOpen(true)}>
              + Product
            </button>
            <button className="btn" onClick={() => void load()} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        {importInfo && <div className="muted">{importInfo}</div>}
        <div className="muted" style={{ marginTop: 6 }}>
          Quản lý danh mục hàng hoá + tồn kho hiện tại.
        </div>
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "id"))}>ID{mark("id")}</button></th>
                <th>Image</th>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "sku"))}>SKU{mark("sku")}</button></th>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "name"))}>Name{mark("name")}</button></th>
                <th>Category</th>
                <th>UOM</th>
                <th className="right"><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "unit_price"))}>Price{mark("unit_price")}</button></th>
                <th>Currency</th>
                <th className="right"><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "quantity_on_hand"))}>On hand (base){mark("quantity_on_hand")}</button></th>
                <th className="right">On hand (UOM)</th>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "is_active"))}>Active{mark("is_active")}</button></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => {
                const open = isExpanded(g.key);
                return (
                  <Fragment key={`grp-${g.key}`}>
                    <tr key={`cat-${g.key}`} className="category-row">
                      <td colSpan={12}>
                        <div className="row" style={{ justifyContent: "space-between" }}>
                          <div className="row" style={{ gap: 10 }}>
                            <button className="btn" type="button" onClick={() => toggle(g.key)}>
                              {open ? "▾" : "▸"}
                            </button>
                            <div>{g.name}</div>
                            <div className="muted">({g.items.length})</div>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {open
                      ? g.items.map((p) => (
                          <tr key={p.id}>
                            <td>{p.id}</td>
                            <td>
                              <div className="thumbCell">
                                {p.image_url ? (
                                  // eslint-disable-next-line jsx-a11y/alt-text
                                  <img
                                    src={p.image_url}
                                    onError={(e) => {
                                      e.currentTarget.style.display = "none";
                                    }}
                                  />
                                ) : (
                                  <div className="thumbFallback">{(p.name || p.sku || "?").slice(0, 1).toUpperCase()}</div>
                                )}
                              </div>
                            </td>
                            <td>{p.sku}</td>
                            <td>{p.name}</td>
                            <td>{p.category_id ? categoryNameById.get(p.category_id) ?? "" : ""}</td>
                            <td>
                              {p.uom}
                              {p.uom_multiplier > 1 ? <span className="muted"> (x{p.uom_multiplier})</span> : null}
                            </td>
                            <td className="right">{p.unit_price}</td>
                            <td>{p.currency}</td>
                            <td className="right">{p.quantity_on_hand}</td>
                            <td className="right">
                              {p.uom_multiplier > 0 ? (p.quantity_on_hand / p.uom_multiplier).toFixed(2) : ""}
                            </td>
                            <td>{p.is_active ? "Yes" : "No"}</td>
                            <td className="right">
                              <button className="btn" type="button" onClick={() => onSelectEdit(String(p.id))}>
                                Sửa
                              </button>
                            </td>
                          </tr>
                        ))
                      : null}
                  </Fragment>
                );
              })}
              {!loading && grouped.length === 0 && (
                <tr>
                  <td colSpan={12} className="muted">
                    No matching products.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={editOpen}
        title={`Sửa product${editId !== "" ? ` #${editId}` : ""}`}
        onClose={() => setEditOpen(false)}
      >
        <form onSubmit={onUpdateProduct} className="row" style={{ alignItems: "stretch" }}>
          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ flex: 1, minWidth: 260 }}>
              <label>Category</label>
              <select
                className="input"
                value={editForm.category_id ?? ""}
                onChange={(e) =>
                  setEditForm((s) => ({ ...s, category_id: e.target.value ? Number(e.target.value) : null }))
                }
              >
                <option value="">-- None --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ minWidth: 140 }}>
              <label>Status</label>
              <label className="row" style={{ gap: 8, marginTop: 2 }}>
                <input
                  type="checkbox"
                  checked={Boolean(editForm.is_active)}
                  onChange={(e) => setEditForm((s) => ({ ...s, is_active: e.target.checked }))}
                />
                Active
              </label>
            </div>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label>SKU</label>
              <input
                className="input"
                value={editForm.sku ?? ""}
                onChange={(e) => setEditForm((s) => ({ ...s, sku: e.target.value }))}
              />
            </div>
            <div className="field" style={{ flex: 2, minWidth: 260 }}>
              <label>Name</label>
              <input
                className="input"
                value={editForm.name ?? ""}
                onChange={(e) => setEditForm((s) => ({ ...s, name: e.target.value }))}
              />
            </div>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ flex: 1, minWidth: 320 }}>
              <label>Image URL</label>
              <input
                className="input"
                value={editForm.image_url ?? ""}
                onChange={(e) => setEditForm((s) => ({ ...s, image_url: e.target.value || null }))}
                placeholder="https://..."
              />
              <div className="muted">Tip: dán link ảnh (png/jpg). Ảnh lỗi sẽ fallback chữ cái.</div>
            </div>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ width: 200 }}>
              <label>Base UOM (stock)</label>
              <input
                className="input"
                value={editForm.base_uom ?? ""}
                onChange={(e) => setEditForm((s) => ({ ...s, base_uom: e.target.value || null }))}
                placeholder="Pc"
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>UOM</label>
              <input
                className="input"
                value={editForm.uom ?? ""}
                onChange={(e) => setEditForm((s) => ({ ...s, uom: e.target.value }))}
              />
            </div>
            <div className="field" style={{ width: 160 }}>
              <label>UOM multiplier</label>
              <input
                className="input"
                type="number"
                min={1}
                value={editForm.uom_multiplier ?? 1}
                onChange={(e) => setEditForm((s) => ({ ...s, uom_multiplier: Number(e.target.value) }))}
              />
            </div>
            <div className="field" style={{ width: 160 }}>
              <label>Unit price</label>
              <input
                className="input"
                value={editForm.unit_price ?? ""}
                onChange={(e) => setEditForm((s) => ({ ...s, unit_price: e.target.value }))}
              />
            </div>
            <div className="field" style={{ width: 120 }}>
              <label>Currency</label>
              <input
                className="input"
                value={editForm.currency ?? ""}
                onChange={(e) => setEditForm((s) => ({ ...s, currency: e.target.value }))}
              />
            </div>
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" type="submit" disabled={editId === ""}>
              Save
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={addProductOpen} title="Add product" onClose={() => setAddProductOpen(false)}>
        {error && <div className="error">{error}</div>}
        <form onSubmit={onCreate} className="row" style={{ alignItems: "stretch" }}>
          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ minWidth: 140 }}>
              <label>Status</label>
              <label className="row" style={{ gap: 8, marginTop: 2 }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((s) => ({ ...s, is_active: e.target.checked }))}
                />
                Active
              </label>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ width: 240 }}>
              <label>SKU</label>
              <input
                className="input"
                value={form.sku}
                onChange={(e) => setForm((s) => ({ ...s, sku: e.target.value }))}
                required
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 320 }}>
              <label>Name</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                required
              />
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ width: 200 }}>
              <label>Base UOM (stock)</label>
              <input
                className="input"
                value={form.base_uom ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, base_uom: e.target.value || null }))}
                placeholder="Pc"
                required
              />
            </div>
            <div className="field" style={{ width: 200 }}>
              <label>Sale UOM</label>
              <input
                className="input"
                value={form.uom ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, uom: e.target.value || null }))}
                placeholder="Dozen"
                required
              />
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" type="submit">
              Create
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={addCategoryOpen} title="Add category" onClose={() => setAddCategoryOpen(false)}>
        {error && <div className="error">{error}</div>}
        <form onSubmit={onCreateCategory} className="row" style={{ alignItems: "stretch" }}>
          <div className="field" style={{ flex: 1, minWidth: 320 }}>
            <label>Category name</label>
            <input
              className="input"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              required
            />
          </div>
          <button className="btn primary" type="submit">
            Add
          </button>
        </form>
      </Modal>
    </div>
  );
}
