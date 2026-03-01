import { useMemo, useState } from "react";
import type { Category, Product } from "../types";

function norm(s: string) {
  return s.trim().toLowerCase();
}

function truncateText(s: string, maxChars: number) {
  const chars = Array.from(String(s ?? ""));
  if (chars.length <= maxChars) return chars.join("");
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

export default function PosProductSearch({
  products,
  categories,
  onAdd,
}: {
  products: Product[];
  categories: Category[];
  onAdd: (p: Product) => void;
}) {
  const [q, setQ] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<"all" | "none" | number>("all");

  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const searchBase = useMemo(() => {
    const qq = norm(q);
    const active = products.filter((p) => p.is_active);
    if (!qq) return active;
    return active.filter((p) => norm(`${p.sku} ${p.name}`).includes(qq));
  }, [products, q]);

  const categoryCounts = useMemo(() => {
    const byId = new Map<number | null, number>();
    let total = 0;
    for (const p of searchBase) {
      total += 1;
      const id = p.category_id ?? null;
      byId.set(id, (byId.get(id) || 0) + 1);
    }
    return { total, byId };
  }, [searchBase]);

  const filtered = useMemo(() => {
    if (selectedCategoryId === "all") return searchBase;
    if (selectedCategoryId === "none") return searchBase.filter((p) => p.category_id == null);
    return searchBase.filter((p) => p.category_id === selectedCategoryId);
  }, [searchBase, selectedCategoryId]);

  function addExactMatch() {
    const qq = q.trim();
    if (!qq) return;
    const upper = qq.toUpperCase();
    const exact = products.find((p) => p.is_active && p.sku.toUpperCase() === upper);
    if (exact) {
      onAdd(exact);
      setQ("");
    }
  }

  return (
    <div className="posPickShell">
      <div className="posPickToolbar">
        <div className="field" style={{ flex: 1, minWidth: 260 }}>
          <label>Search</label>
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addExactMatch();
              }
            }}
            placeholder="Gõ SKU hoặc tên… (Enter để add SKU match)"
            autoComplete="off"
          />
        </div>
        <button className="btn" type="button" onClick={addExactMatch} disabled={!q.trim()}>
          Add
        </button>
        <div className="pill">{filtered.length} sp</div>
      </div>

      <div className="posPickSplit">
        <div style={{ minWidth: 0 }}>
          {!filtered.length ? <div className="muted">Không có sản phẩm.</div> : null}
          {filtered.length ? (
            <div className="posProdGrid">
              {filtered
                .slice()
                .sort((a, b) => a.sku.localeCompare(b.sku))
                .slice(0, 200)
                .map((p) => {
                  const cat = p.category_id ? categoryNameById.get(p.category_id) ?? "" : "";
                  const onHandUom =
                    p.uom_multiplier > 0 ? (p.quantity_on_hand / p.uom_multiplier).toFixed(2) : "";
                  return (
                    <button key={p.id} type="button" className="posProdCard" onClick={() => onAdd(p)}>
                      <div className="posProdThumb">
                        {p.image_url ? (
                          // eslint-disable-next-line jsx-a11y/alt-text
                          <img
                            src={p.image_url}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                        <div className="posProdThumbFallback">{(p.name || p.sku || "?").slice(0, 1).toUpperCase()}</div>
                      </div>
                      <div className="posProdName">{p.name}</div>
                      <div className="posProdPrice">
                        {p.unit_price} {p.currency}
                      </div>
                      <div className="posProdMeta">
                        <span>
                          Tồn: {onHandUom} {p.uom}
                        </span>
                        {cat ? <span>DM: {truncateText(cat, 18)}</span> : null}
                        <span>SKU: {p.sku}</span>
                      </div>
                    </button>
                  );
                })}
            </div>
          ) : null}
          {filtered.length > 200 ? (
            <div className="muted" style={{ marginTop: 8 }}>
              Hiển thị 200/{filtered.length} sản phẩm. Hãy gõ thêm để lọc.
            </div>
          ) : null}
        </div>

        <div className="posPickCats" role="tablist" aria-label="Danh mục">
          <button
            type="button"
            className={`catVTab ${selectedCategoryId === "all" ? "catVTabActive" : ""}`}
            onClick={() => setSelectedCategoryId("all")}
          >
            <span className="catVTabText">Tất cả ({categoryCounts.total})</span>
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`catVTab ${selectedCategoryId === c.id ? "catVTabActive" : ""}`}
              onClick={() => setSelectedCategoryId(c.id)}
              title={c.name}
            >
              <span className="catVTabText">
                {c.name} ({categoryCounts.byId.get(c.id) || 0})
              </span>
            </button>
          ))}
          {categoryCounts.byId.get(null) ? (
            <button
              type="button"
              className={`catVTab ${selectedCategoryId === "none" ? "catVTabActive" : ""}`}
              onClick={() => setSelectedCategoryId("none")}
              title="No category"
            >
              <span className="catVTabText">No category ({categoryCounts.byId.get(null) || 0})</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
