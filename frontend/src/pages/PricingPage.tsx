import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import type { Category, Product } from "../types";
import type { SortState } from "../utils/table";
import { sortBy, toggleSort } from "../utils/table";

type PriceDraft = {
  unit_price: string;
};

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

export default function PricingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [drafts, setDrafts] = useState<Record<number, PriceDraft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<
    SortState<"id" | "sku" | "name" | "category" | "cost_base" | "cost_sale" | "sale_base" | "sale_sale" | "currency">
  >({
    key: "id",
    dir: "asc",
  });

  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, c] = await Promise.all([apiJson<Product[]>("/api/v1/products"), apiJson<Category[]>("/api/v1/categories")]);
      setProducts(p);
      setCategories(c);
      const nextDrafts: Record<number, PriceDraft> = {};
      for (const item of p) {
        nextDrafts[item.id] = {
          unit_price: item.unit_price,
        };
      }
      setDrafts(nextDrafts);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const categoryName = p.category_id ? categoryNameById.get(p.category_id) ?? "" : "";
      return (
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        categoryName.toLowerCase().includes(q)
      );
    });
  }, [products, query, categoryNameById]);
  const displayed = useMemo(() => {
    return sortBy(
      filtered,
      (p) => {
        const draft = drafts[p.id] ?? { unit_price: p.unit_price };
        const multiplier = Math.max(1, Number(p.uom_multiplier || 1));
        const costBase = toNumber(p.cost_price);
        const saleSale = toNumber(draft.unit_price);
        switch (sort.key) {
          case "id":
            return p.id;
          case "sku":
            return p.sku;
          case "name":
            return p.name;
          case "category":
            return p.category_id ? categoryNameById.get(p.category_id) ?? "" : "";
          case "cost_base":
            return costBase;
          case "cost_sale":
            return costBase * multiplier;
          case "sale_base":
            return saleSale / multiplier;
          case "sale_sale":
            return saleSale;
          case "currency":
            return p.currency;
          default:
            return p.id;
        }
      },
      sort.dir,
    );
  }, [filtered, drafts, categoryNameById, sort]);

  function mark(col: typeof sort.key): string {
    if (sort.key !== col) return "";
    return sort.dir === "asc" ? " ↑" : " ↓";
  }

  async function saveProductPrice(product: Product) {
    const draft = drafts[product.id];
    if (!draft) return;
    setSavingId(product.id);
    setError(null);
    try {
      await apiJson<Product>(`/api/v1/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          unit_price: draft.unit_price,
        }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Pricing</h2>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <input
            className="input"
            style={{ minWidth: 260 }}
            placeholder="Search SKU / tên / category..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        Giá vốn (cost) tự tính theo moving average từ Receipt. Trang này chỉ sửa giá bán.
      </div>
      {error && <div className="error">{error}</div>}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "id"))}>ID{mark("id")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "sku"))}>SKU{mark("sku")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "name"))}>Product{mark("name")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "category"))}>Category{mark("category")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "cost_base"))}>Cost (Base UOM){mark("cost_base")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "cost_sale"))}>Cost (Sale UOM){mark("cost_sale")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "sale_base"))}>Sale (Base UOM){mark("sale_base")}</button></th>
              <th className="right"><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "sale_sale"))}>Sale (Sale UOM){mark("sale_sale")}</button></th>
              <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "currency"))}>Currency{mark("currency")}</button></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((p) => {
              const draft = drafts[p.id] ?? { unit_price: p.unit_price };
              const multiplier = Math.max(1, Number(p.uom_multiplier || 1));
              const costBase = toNumber(p.cost_price);
              const costSale = costBase * multiplier;
              const saleSale = toNumber(draft.unit_price);
              const saleBase = saleSale / multiplier;
              return (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.category_id ? categoryNameById.get(p.category_id) ?? "" : ""}</td>
                  <td className="right">
                    <div>{formatMoney(costBase)}</div>
                    <div className="muted">{p.base_uom}</div>
                  </td>
                  <td className="right">
                    <div>{formatMoney(costSale)}</div>
                    <div className="muted">{p.uom}</div>
                  </td>
                  <td className="right">
                    <div>{formatMoney(saleBase)}</div>
                    <div className="muted">{p.base_uom}</div>
                  </td>
                  <td className="right">
                    <input
                      className="input"
                      style={{ width: 120, textAlign: "right" }}
                      value={draft.unit_price}
                      onChange={(e) =>
                        setDrafts((s) => ({ ...s, [p.id]: { ...draft, unit_price: e.target.value } }))
                      }
                    />
                    <div className="muted">{p.uom}</div>
                  </td>
                  <td>
                    {p.currency}
                  </td>
                  <td className="right">
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => void saveProductPrice(p)}
                      disabled={savingId === p.id}
                    >
                      {savingId === p.id ? "Saving..." : "Save"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && displayed.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  Không có sản phẩm nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
