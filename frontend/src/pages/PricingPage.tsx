import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import type { Category, Customer, CustomerPriceItem, Product } from "../types";
import type { SortState } from "../utils/table";
import { sortBy, toggleSort } from "../utils/table";

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number | string | null | undefined): string {
  const n = toNumber(value);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(isoStr: string | null | undefined): string {
  if (!isoStr) return "-";
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return isoStr.slice(0, 10);
  }
}

type MarketSortKey =
  | "id"
  | "sku"
  | "name"
  | "category"
  | "default_price"
  | "custom_price"
  | "last_sold_at";

type DefaultSortKey =
  | "id"
  | "sku"
  | "name"
  | "category"
  | "sale_price"
  | "currency";

export default function PricingPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

  // Default mode state
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [defaultDrafts, setDefaultDrafts] = useState<Record<number, string>>({});

  // Market mode state
  const [marketPrices, setMarketPrices] = useState<CustomerPriceItem[]>([]);
  const [marketDrafts, setMarketDrafts] = useState<Record<number, string>>({});
  const [marketFilterTab, setMarketFilterTab] = useState<"all" | "custom" | "default">("all");

  const [savingId, setSavingId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [marketSort, setMarketSort] = useState<SortState<MarketSortKey>>({
    key: "sku",
    dir: "asc",
  });

  const [defaultSort, setDefaultSort] = useState<SortState<DefaultSortKey>>({
    key: "sku",
    dir: "asc",
  });

  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  // Load initial customers and categories
  useEffect(() => {
    async function init() {
      try {
        const [cList, catList] = await Promise.all([
          apiJson<Customer[]>("/api/v1/customers"),
          apiJson<Category[]>("/api/v1/categories"),
        ]);
        setCustomers(cList);
        setCategories(catList);

        // Auto select World Market if found, otherwise keep null or first customer
        const wm = cList.find((c) => c.name.toLowerCase().includes("world market"));
        if (wm) {
          setSelectedCustomerId(wm.id);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
    void init();
  }, []);

  // Load price data whenever selectedCustomerId changes
  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      if (selectedCustomerId == null) {
        const pList = await apiJson<Product[]>("/api/v1/products");
        setProducts(pList);
        const nextDrafts: Record<number, string> = {};
        for (const p of pList) {
          nextDrafts[p.id] = String(p.unit_price || 0);
        }
        setDefaultDrafts(nextDrafts);
      } else {
        const cpList = await apiJson<CustomerPriceItem[]>(`/api/v1/customers/${selectedCustomerId}/prices`);
        setMarketPrices(cpList);
        const nextDrafts: Record<number, string> = {};
        for (const cp of cpList) {
          nextDrafts[cp.product_id] = cp.custom_price != null ? String(cp.custom_price) : String(cp.default_price);
        }
        setMarketDrafts(nextDrafts);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [selectedCustomerId]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  // Market stats
  const marketStats = useMemo(() => {
    let customCount = 0;
    let defaultCount = 0;
    for (const item of marketPrices) {
      if (item.custom_price != null) {
        customCount++;
      } else {
        defaultCount++;
      }
    }
    return { total: marketPrices.length, customCount, defaultCount };
  }, [marketPrices]);

  // Filtered & sorted for Market Mode
  const displayedMarketPrices = useMemo(() => {
    let list = marketPrices;
    if (marketFilterTab === "custom") {
      list = list.filter((item) => item.custom_price != null);
    } else if (marketFilterTab === "default") {
      list = list.filter((item) => item.custom_price == null);
    }

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.sku.toLowerCase().includes(q) ||
          p.product_name.toLowerCase().includes(q) ||
          (p.category_name && p.category_name.toLowerCase().includes(q))
      );
    }

    return sortBy(
      list,
      (p) => {
        switch (marketSort.key) {
          case "id":
            return p.product_id;
          case "sku":
            return p.sku;
          case "name":
            return p.product_name;
          case "category":
            return p.category_name || "";
          case "default_price":
            return toNumber(p.default_price);
          case "custom_price":
            return toNumber(marketDrafts[p.product_id] ?? p.effective_price);
          case "last_sold_at":
            return p.last_sold_at ? new Date(p.last_sold_at).getTime() : 0;
          default:
            return p.product_id;
        }
      },
      marketSort.dir
    );
  }, [marketPrices, marketFilterTab, query, marketSort, marketDrafts]);

  // Filtered & sorted for Default Mode
  const displayedDefaultProducts = useMemo(() => {
    let list = products;
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        const catName = p.category_id ? categoryNameById.get(p.category_id) ?? "" : "";
        return (
          p.sku.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          catName.toLowerCase().includes(q)
        );
      });
    }

    return sortBy(
      list,
      (p) => {
        const draftPrice = toNumber(defaultDrafts[p.id] ?? p.unit_price);
        switch (defaultSort.key) {
          case "id":
            return p.id;
          case "sku":
            return p.sku;
          case "name":
            return p.name;
          case "category":
            return p.category_id ? categoryNameById.get(p.category_id) ?? "" : "";
          case "sale_price":
            return draftPrice;
          case "currency":
            return p.currency;
          default:
            return p.id;
        }
      },
      defaultSort.dir
    );
  }, [products, query, defaultSort, defaultDrafts, categoryNameById]);

  function markMarket(col: MarketSortKey): string {
    if (marketSort.key !== col) return "";
    return marketSort.dir === "asc" ? " ↑" : " ↓";
  }

  function markDefault(col: DefaultSortKey): string {
    if (defaultSort.key !== col) return "";
    return defaultSort.dir === "asc" ? " ↑" : " ↓";
  }

  // Save market custom price
  async function saveMarketPrice(item: CustomerPriceItem) {
    if (!selectedCustomerId) return;
    const draftVal = marketDrafts[item.product_id];
    const priceNum = toNumber(draftVal);
    if (priceNum <= 0) {
      setError("Giá bán phải lớn hơn 0");
      return;
    }

    setSavingId(item.product_id);
    setError(null);
    setSuccessMessage(null);
    try {
      await apiJson(`/api/v1/customers/${selectedCustomerId}/prices/${item.product_id}`, {
        method: "PUT",
        body: JSON.stringify({
          product_id: item.product_id,
          price: priceNum,
        }),
      });
      setSuccessMessage(`Đã cập nhật giá bán "${item.product_name}" cho ${selectedCustomer?.name}: $${formatMoney(priceNum)}`);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  // Reset to default price (delete custom price)
  async function resetToDefaultPrice(item: CustomerPriceItem) {
    if (!selectedCustomerId) return;
    setSavingId(item.product_id);
    setError(null);
    setSuccessMessage(null);
    try {
      await apiJson(`/api/v1/customers/${selectedCustomerId}/prices/${item.product_id}`, {
        method: "PUT",
        body: JSON.stringify({
          product_id: item.product_id,
          price: 0,
        }),
      });
      setSuccessMessage(`Đã hủy giá riêng của "${item.product_name}", chuyển về dùng giá gốc ($${formatMoney(item.default_price)})`);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  // Save default product price
  async function saveDefaultPrice(product: Product) {
    const draftVal = defaultDrafts[product.id];
    const priceNum = toNumber(draftVal);
    setSavingId(product.id);
    setError(null);
    setSuccessMessage(null);
    try {
      await apiJson<Product>(`/api/v1/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          unit_price: priceNum,
        }),
      });
      setSuccessMessage(`Đã lưu giá niêm yết mặc định cho "${product.name}": $${formatMoney(priceNum)}`);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  const worldMarketCustomer = customers.find((c) => c.name.toLowerCase().includes("world market"));

  return (
    <div className="card">
      {/* Top Header & Market Picker */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <span>Bảng Giá Bán</span>
            {selectedCustomer ? (
              <span
                style={{
                  fontSize: "0.88rem",
                  padding: "3px 10px",
                  borderRadius: 16,
                  background: "#ecfdf5",
                  color: "#065f46",
                  border: "1px solid #a7f3d0",
                  fontWeight: 600,
                }}
              >
                🏪 {selectedCustomer.name}
              </span>
            ) : (
              <span
                style={{
                  fontSize: "0.88rem",
                  padding: "3px 10px",
                  borderRadius: 16,
                  background: "#fef3c7",
                  color: "#92400e",
                  border: "1px solid #fde68a",
                  fontWeight: 600,
                }}
              >
                ⭐ Bảng Giá Gốc Niêm Yết
              </span>
            )}
          </h2>
          <div className="muted" style={{ fontSize: "0.88rem", marginTop: 4 }}>
            {selectedCustomer
              ? `Tự động lưu & ghi nhớ giá đã bán cho ${selectedCustomer.name} qua hóa đơn. Bạn có thể sửa trực tiếp bất cứ lúc nào.`
              : "Giá niêm yết chuẩn của kho cho tất cả sản phẩm."}
          </div>
        </div>

        {/* Quick Customer Switcher Buttons & Dropdown */}
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          {worldMarketCustomer && (
            <button
              type="button"
              className={`btn ${selectedCustomerId === worldMarketCustomer.id ? "primary" : ""}`}
              style={{ fontWeight: 600 }}
              onClick={() => setSelectedCustomerId(worldMarketCustomer.id)}
            >
              🏪 Chợ World Market
            </button>
          )}

          <button
            type="button"
            className={`btn ${selectedCustomerId === null ? "primary" : ""}`}
            style={{ fontWeight: 600 }}
            onClick={() => setSelectedCustomerId(null)}
          >
            ⭐ Giá Gốc Niêm Yết
          </button>

          <select
            className="select"
            style={{ minWidth: 200, fontWeight: 500 }}
            value={selectedCustomerId ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedCustomerId(val ? Number(val) : null);
            }}
          >
            <option value="">-- Chọn chợ / khách hàng khác --</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.phone ? `(${c.phone})` : ""}
              </option>
            ))}
          </select>

          <button className="btn" onClick={() => void loadData()} disabled={loading}>
            {loading ? "Đang tải..." : "Làm mới"}
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        className="row"
        style={{
          marginTop: 16,
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid var(--border)",
          paddingTop: 14,
        }}
      >
        {selectedCustomer ? (
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className={`btn ${marketFilterTab === "all" ? "primary" : ""}`}
              style={{ fontSize: "0.85rem", padding: "5px 10px" }}
              onClick={() => setMarketFilterTab("all")}
            >
              Tất cả SP ({marketStats.total})
            </button>
            <button
              type="button"
              className={`btn ${marketFilterTab === "custom" ? "primary" : ""}`}
              style={{ fontSize: "0.85rem", padding: "5px 10px" }}
              onClick={() => setMarketFilterTab("custom")}
            >
              ⭐ Đã có giá riêng ({marketStats.customCount})
            </button>
            <button
              type="button"
              className={`btn ${marketFilterTab === "default" ? "primary" : ""}`}
              style={{ fontSize: "0.85rem", padding: "5px 10px" }}
              onClick={() => setMarketFilterTab("default")}
            >
              Theo giá gốc ({marketStats.defaultCount})
            </button>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: "0.88rem" }}>
            Tổng cộng: <strong>{products.length}</strong> sản phẩm niêm yết
          </div>
        )}

        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ minWidth: 260 }}
            placeholder="Tìm SKU / tên sản phẩm / category..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="error" style={{ marginTop: 10, padding: 8, background: "#fee2e2", borderRadius: 8 }}>
          {error}
        </div>
      )}
      {successMessage && (
        <div style={{ marginTop: 10, padding: 8, background: "#d1fae5", color: "#065f46", borderRadius: 8, fontWeight: 500 }}>
          ✓ {successMessage}
        </div>
      )}

      {/* VIEW 1: CUSTOMER / MARKET MODE */}
      {selectedCustomer ? (
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>
                  <button className="thSortBtn" type="button" onClick={() => setMarketSort((s) => toggleSort(s, "id"))}>
                    ID{markMarket("id")}
                  </button>
                </th>
                <th style={{ width: 60 }}>Ảnh</th>
                <th>
                  <button className="thSortBtn" type="button" onClick={() => setMarketSort((s) => toggleSort(s, "sku"))}>
                    SKU{markMarket("sku")}
                  </button>
                </th>
                <th>
                  <button className="thSortBtn" type="button" onClick={() => setMarketSort((s) => toggleSort(s, "name"))}>
                    Tên sản phẩm{markMarket("name")}
                  </button>
                </th>
                <th>
                  <button className="thSortBtn" type="button" onClick={() => setMarketSort((s) => toggleSort(s, "category"))}>
                    Danh mục{markMarket("category")}
                  </button>
                </th>
                <th className="right">
                  <button className="thSortBtn" type="button" onClick={() => setMarketSort((s) => toggleSort(s, "default_price"))}>
                    Giá niêm yết gốc{markMarket("default_price")}
                  </button>
                </th>
                <th className="right" style={{ minWidth: 160 }}>
                  <button className="thSortBtn" type="button" onClick={() => setMarketSort((s) => toggleSort(s, "custom_price"))}>
                    Giá bán cho {selectedCustomer.name}{markMarket("custom_price")}
                  </button>
                </th>
                <th>
                  <button className="thSortBtn" type="button" onClick={() => setMarketSort((s) => toggleSort(s, "last_sold_at"))}>
                    Lần bán gần nhất{markMarket("last_sold_at")}
                  </button>
                </th>
                <th className="right" style={{ minWidth: 150 }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {displayedMarketPrices.map((item) => {
                const currentDraft = marketDrafts[item.product_id] ?? (item.custom_price != null ? String(item.custom_price) : String(item.default_price));
                const isCustom = item.custom_price != null;
                const isChanged = toNumber(currentDraft) !== toNumber(item.custom_price ?? item.default_price);
                const isSaving = savingId === item.product_id;

                return (
                  <tr key={item.product_id} style={{ background: isCustom ? "#f0fdf4" : undefined }}>
                    <td>{item.product_id}</td>
                    <td>
                      <div className="thumbCell">
                        {item.product_image_url ? (
                          <img
                            loading="lazy"
                            decoding="async"
                            src={item.product_image_url}
                            alt={item.product_name}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="thumbFallback">{(item.product_name || item.sku || "?").slice(0, 1).toUpperCase()}</div>
                        )}
                      </div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{item.sku}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{item.product_name}</div>
                      {isCustom ? (
                        <span
                          style={{
                            fontSize: "0.75rem",
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "#bbf7d0",
                            color: "#166534",
                            fontWeight: 600,
                          }}
                        >
                          ✓ Giá riêng cho chợ
                        </span>
                      ) : (
                        <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Theo giá gốc</span>
                      )}
                    </td>
                    <td>{item.category_name || "-"}</td>
                    <td className="right" style={{ color: "#6b7280" }}>
                      ${formatMoney(item.default_price)}
                    </td>
                    <td className="right">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                        <span style={{ fontWeight: 600, color: "#374151" }}>$</span>
                        <input
                          className="input"
                          style={{
                            width: 110,
                            textAlign: "right",
                            fontWeight: 700,
                            color: isCustom ? "#047857" : "#111827",
                            borderColor: isCustom ? "#10b981" : undefined,
                            background: isCustom ? "#ffffff" : "#f9fafb",
                          }}
                          value={currentDraft}
                          onChange={(e) =>
                            setMarketDrafts((s) => ({ ...s, [item.product_id]: e.target.value }))
                          }
                        />
                      </div>
                    </td>
                    <td>
                      {item.last_sold_at || item.last_invoice_number ? (
                        <div>
                          {item.last_invoice_number && (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: "#e0e7ff",
                                color: "#3730a3",
                                fontWeight: 600,
                                fontSize: "0.78rem",
                                marginRight: 6,
                              }}
                            >
                              {item.last_invoice_number}
                            </span>
                          )}
                          <span style={{ fontSize: "0.82rem", color: "#4b5563" }}>
                            {formatDate(item.last_sold_at)}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: "#9ca3af", fontSize: "0.85rem" }}>Chưa xuất hóa đơn</span>
                      )}
                    </td>
                    <td className="right">
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button
                          className={`btn ${isChanged ? "primary" : ""}`}
                          style={{ fontSize: "0.82rem", padding: "5px 9px" }}
                          type="button"
                          onClick={() => void saveMarketPrice(item)}
                          disabled={isSaving}
                        >
                          {isSaving ? "Lưu..." : "Lưu giá"}
                        </button>
                        {isCustom && (
                          <button
                            className="btn"
                            style={{ fontSize: "0.82rem", padding: "5px 8px", color: "#b91c1c" }}
                            type="button"
                            title="Bỏ giá riêng và dùng lại giá niêm yết mặc định"
                            onClick={() => void resetToDefaultPrice(item)}
                            disabled={isSaving}
                          >
                            Dùng giá gốc
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && displayedMarketPrices.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    Không tìm thấy sản phẩm nào phù hợp với bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* VIEW 2: DEFAULT BASE CATALOG PRICING */
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>
                  <button className="thSortBtn" type="button" onClick={() => setDefaultSort((s) => toggleSort(s, "id"))}>
                    ID{markDefault("id")}
                  </button>
                </th>
                <th style={{ width: 60 }}>Ảnh</th>
                <th>
                  <button className="thSortBtn" type="button" onClick={() => setDefaultSort((s) => toggleSort(s, "sku"))}>
                    SKU{markDefault("sku")}
                  </button>
                </th>
                <th>
                  <button className="thSortBtn" type="button" onClick={() => setDefaultSort((s) => toggleSort(s, "name"))}>
                    Tên sản phẩm{markDefault("name")}
                  </button>
                </th>
                <th>
                  <button className="thSortBtn" type="button" onClick={() => setDefaultSort((s) => toggleSort(s, "category"))}>
                    Danh mục{markDefault("category")}
                  </button>
                </th>
                <th>Đơn vị (UOM)</th>
                <th className="right" style={{ minWidth: 160 }}>
                  <button className="thSortBtn" type="button" onClick={() => setDefaultSort((s) => toggleSort(s, "sale_price"))}>
                    Giá bán niêm yết (Default){markDefault("sale_price")}
                  </button>
                </th>
                <th>Tiền tệ</th>
                <th className="right" style={{ minWidth: 100 }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {displayedDefaultProducts.map((p) => {
                const currentDraft = defaultDrafts[p.id] ?? String(p.unit_price || 0);
                const isChanged = toNumber(currentDraft) !== toNumber(p.unit_price);
                const isSaving = savingId === p.id;

                return (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>
                      <div className="thumbCell">
                        {p.image_url ? (
                          <img
                            loading="lazy"
                            decoding="async"
                            src={p.image_url}
                            alt={p.name}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="thumbFallback">{(p.name || p.sku || "?").slice(0, 1).toUpperCase()}</div>
                        )}
                      </div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{p.sku}</td>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td>{p.category_id ? categoryNameById.get(p.category_id) ?? "-" : "-"}</td>
                    <td>
                      <div>{p.uom || "Pc"}</div>
                      {p.base_uom && p.base_uom !== p.uom && (
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          1 {p.uom} = {p.uom_multiplier} {p.base_uom}
                        </div>
                      )}
                    </td>
                    <td className="right">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                        <span style={{ fontWeight: 600, color: "#374151" }}>$</span>
                        <input
                          className="input"
                          style={{
                            width: 120,
                            textAlign: "right",
                            fontWeight: 700,
                            borderColor: isChanged ? "#2563eb" : undefined,
                          }}
                          value={currentDraft}
                          onChange={(e) =>
                            setDefaultDrafts((s) => ({ ...s, [p.id]: e.target.value }))
                          }
                        />
                      </div>
                    </td>
                    <td>{p.currency}</td>
                    <td className="right">
                      <button
                        className={`btn ${isChanged ? "primary" : ""}`}
                        type="button"
                        style={{ fontSize: "0.82rem", padding: "5px 10px" }}
                        onClick={() => void saveDefaultPrice(p)}
                        disabled={isSaving}
                      >
                        {isSaving ? "Lưu..." : "Lưu"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && displayedDefaultProducts.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    Không có sản phẩm nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
