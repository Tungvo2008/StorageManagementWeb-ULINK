import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, assetUrl } from "../api/client";
import type { Category, Product, StockMovement } from "../types";
import Modal from "../components/Modal";
import type { SortState } from "../utils/table";
import { matchesQuery, sortBy, toggleSort } from "../utils/table";

type StockFilterType = "ALL" | "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "NEGATIVE";

export default function InventoryStockPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilterType>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<number | "ALL">("ALL");

  // Sorting
  const [sort, setSort] = useState<
    SortState<"sku" | "name" | "category" | "quantity_on_hand" | "unit_price">
  >({
    key: "quantity_on_hand",
    dir: "desc",
  });

  // Quick Adjust Modal State
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [adjustTargetQty, setAdjustTargetQty] = useState<number>(0);
  const [adjustNote, setAdjustNote] = useState<string>("");
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustSuccessMsg, setAdjustSuccessMsg] = useState<string | null>(null);

  // History Quick View Modal State
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [historyMovements, setHistoryMovements] = useState<StockMovement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Fast Category Lookup Map
  const categoryMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of categories) {
      map.set(c.id, c.name);
    }
    return map;
  }, [categories]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [prodData, catData] = await Promise.all([
        apiJson<Product[]>("/api/v1/products?limit=1000"),
        apiJson<Category[]>("/api/v1/categories?limit=200").catch(() => []),
      ]);
      setProducts(prodData);
      setCategories(catData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  // Compute KPI Counts
  const stats = useMemo(() => {
    let totalSKUs = products.length;
    let totalUnits = 0;
    let inStockCount = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let negativeCount = 0;

    for (const p of products) {
      const q = p.quantity_on_hand || 0;
      totalUnits += q;
      if (q > 10) {
        inStockCount++;
      } else if (q > 0 && q <= 10) {
        lowStockCount++;
      } else if (q === 0) {
        outOfStockCount++;
      } else if (q < 0) {
        negativeCount++;
      }
    }

    return { totalSKUs, totalUnits, inStockCount, lowStockCount, outOfStockCount, negativeCount };
  }, [products]);

  // Filtered List
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // 1. Category Filter
      if (categoryFilter !== "ALL" && p.category_id !== categoryFilter) {
        return false;
      }

      // 2. Stock Status Filter
      const q = p.quantity_on_hand || 0;
      if (stockFilter === "IN_STOCK" && q <= 10) return false;
      if (stockFilter === "LOW_STOCK" && (q <= 0 || q > 10)) return false;
      if (stockFilter === "OUT_OF_STOCK" && q !== 0) return false;
      if (stockFilter === "NEGATIVE" && q >= 0) return false;

      // 3. Search Query
      if (query.trim()) {
        const catName = p.category_id ? categoryMap.get(p.category_id) || "" : "";
        const match = matchesQuery(
          query,
          p.sku,
          p.name,
          p.upc || "",
          p.amazon_sku || "",
          catName,
          p.business_unit || ""
        );
        if (!match) return false;
      }

      return true;
    });
  }, [products, categoryFilter, stockFilter, query, categoryMap]);

  // Sorted List
  const sortedProducts = useMemo(() => {
    return sortBy(
      filteredProducts,
      (p: Product) => {
        switch (sort.key) {
          case "sku":
            return p.sku;
          case "name":
            return p.name;
          case "category":
            return p.category_id ? categoryMap.get(p.category_id) || "" : "";
          case "quantity_on_hand":
            return p.quantity_on_hand || 0;
          case "unit_price":
            return Number(p.unit_price || 0);
          default:
            return "";
        }
      },
      sort.dir
    );
  }, [filteredProducts, sort, categoryMap]);

  // Handle Quick Adjust Open
  function openQuickAdjust(p: Product) {
    setAdjustProduct(p);
    setAdjustTargetQty(p.quantity_on_hand || 0);
    setAdjustNote("");
    setAdjustSuccessMsg(null);
    setAdjustModalOpen(true);
  }

  // Submit Quick Adjust
  async function submitQuickAdjust() {
    if (!adjustProduct) return;
    setAdjustBusy(true);
    setAdjustSuccessMsg(null);
    try {
      const updated = await apiJson<Product>(
        `/api/v1/inventory/products/${adjustProduct.id}/stock`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quantity_on_hand: adjustTargetQty,
            note: adjustNote || "Kiểm kê điều chỉnh tức thời tại giao diện Tồn Kho",
          }),
        }
      );

      // Update state in place
      setProducts((prev) =>
        prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );
      setAdjustSuccessMsg("✅ Cập nhật số lượng tồn kho thành công!");
      setTimeout(() => {
        setAdjustModalOpen(false);
      }, 900);
    } catch (e) {
      alert(`Lỗi điều chỉnh tồn kho: ${(e as Error).message}`);
    } finally {
      setAdjustBusy(false);
    }
  }

  // Handle View History
  async function openQuickHistory(p: Product) {
    setHistoryProduct(p);
    setHistoryModalOpen(true);
    setHistoryLoading(true);
    try {
      const movements = await apiJson<StockMovement[]>(
        `/api/v1/inventory/movements?product_id=${p.id}&limit=20`
      );
      setHistoryMovements(movements);
    } catch (e) {
      console.error(e);
      setHistoryMovements([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1400, margin: "0 auto", padding: "16px 20px" }}>
      {/* Page Header */}
      <div
        className="page-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: "#0f172a" }}>
            📦 Tra Cứu Tồn Kho Siêu Tốc (Fast Inventory)
          </h1>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 14 }}>
            Quản lý số lượng tồn vật lý tức thời, hỗ trợ tra cứu hai đơn vị tính và điều chỉnh kiểm kê tại chỗ.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link
            to="/receipts"
            className="btn"
            style={{
              background: "#eff6ff",
              color: "#1d4ed8",
              border: "1px solid #bfdbfe",
              fontWeight: 600,
              padding: "8px 16px",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            📥 Tạo Phiếu Nhập
          </Link>
          <Link
            to="/issue"
            className="btn"
            style={{
              background: "#fff1f2",
              color: "#e11d48",
              border: "1px solid #fecdd3",
              fontWeight: 600,
              padding: "8px 16px",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            📤 Tạo Phiếu Xuất
          </Link>
          <Link
            to="/stock-history"
            className="btn"
            style={{
              background: "#f8fafc",
              color: "#334155",
              border: "1px solid #cbd5e1",
              fontWeight: 600,
              padding: "8px 16px",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            📜 Xem Sổ Cái Kho
          </Link>
        </div>
      </div>

      {/* KPI Cards Banner */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            background: "white",
            padding: "14px 18px",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
            Tổng SKU Hàng Hóa
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
            {stats.totalSKUs.toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            Tổng số lượng: <b>{stats.totalUnits.toLocaleString()}</b> cái
          </div>
        </div>

        <div
          onClick={() => setStockFilter("IN_STOCK")}
          style={{
            background: stockFilter === "IN_STOCK" ? "#f0fdf4" : "white",
            borderColor: stockFilter === "IN_STOCK" ? "#86efac" : "#e2e8f0",
            padding: "14px 18px",
            borderRadius: 12,
            border: "1px solid",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#166534", textTransform: "uppercase" }}>
            🟢 Dồi Dào (&gt;10)
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#15803d", marginTop: 4 }}>
            {stats.inStockCount} <span style={{ fontSize: 13, fontWeight: 400 }}>mặt hàng</span>
          </div>
          <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>Bấm để lọc danh sách</div>
        </div>

        <div
          onClick={() => setStockFilter("LOW_STOCK")}
          style={{
            background: stockFilter === "LOW_STOCK" ? "#fffbeb" : "white",
            borderColor: stockFilter === "LOW_STOCK" ? "#fde68a" : "#e2e8f0",
            padding: "14px 18px",
            borderRadius: 12,
            border: "1px solid",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#b45309", textTransform: "uppercase" }}>
            ⚠️ Sắp Hết (1 - 10)
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#d97706", marginTop: 4 }}>
            {stats.lowStockCount} <span style={{ fontSize: 13, fontWeight: 400 }}>mặt hàng</span>
          </div>
          <div style={{ fontSize: 12, color: "#b45309", marginTop: 2 }}>Cần lên đơn nhập thêm</div>
        </div>

        <div
          onClick={() => setStockFilter("OUT_OF_STOCK")}
          style={{
            background: stockFilter === "OUT_OF_STOCK" ? "#f8fafc" : "white",
            borderColor: stockFilter === "OUT_OF_STOCK" ? "#cbd5e1" : "#e2e8f0",
            padding: "14px 18px",
            borderRadius: 12,
            border: "1px solid",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
            ⚪ Hết Hàng (=0)
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#64748b", marginTop: 4 }}>
            {stats.outOfStockCount} <span style={{ fontSize: 13, fontWeight: 400 }}>mặt hàng</span>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Tồn kho bằng 0</div>
        </div>

        <div
          onClick={() => setStockFilter("NEGATIVE")}
          style={{
            background: stockFilter === "NEGATIVE" ? "#fef2f2" : "white",
            borderColor: stockFilter === "NEGATIVE" ? "#fca5a5" : "#e2e8f0",
            padding: "14px 18px",
            borderRadius: 12,
            border: "1px solid",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#991b1b", textTransform: "uppercase" }}>
            🔴 Âm Kho (&lt;0)
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#b91c1c", marginTop: 4 }}>
            {stats.negativeCount} <span style={{ fontSize: 13, fontWeight: 400 }}>mặt hàng</span>
          </div>
          <div style={{ fontSize: 12, color: "#991b1b", marginTop: 2 }}>Xuất nhiều hơn tồn thực</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          background: "white",
          padding: "14px 18px",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          marginBottom: 16,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        }}
      >
        {/* Search Input */}
        <div style={{ flex: "1 1 300px", minWidth: 260, position: "relative" }}>
          <input
            type="text"
            className="input"
            placeholder="🔍 Tìm nhanh theo tên, mã SKU, UPC, Barcode..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              fontSize: 14,
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Quick Filter Buttons */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            onClick={() => setStockFilter("ALL")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: stockFilter === "ALL" ? "#0f172a" : "#f1f5f9",
              color: stockFilter === "ALL" ? "white" : "#475569",
              border: "none",
            }}
          >
            Tất cả ({products.length})
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setStockFilter("IN_STOCK")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: stockFilter === "IN_STOCK" ? "#15803d" : "#f0fdf4",
              color: stockFilter === "IN_STOCK" ? "white" : "#166534",
              border: "1px solid #bbf7d0",
            }}
          >
            Còn hàng ({stats.inStockCount})
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setStockFilter("LOW_STOCK")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: stockFilter === "LOW_STOCK" ? "#d97706" : "#fffbeb",
              color: stockFilter === "LOW_STOCK" ? "white" : "#b45309",
              border: "1px solid #fde68a",
            }}
          >
            Sắp hết ({stats.lowStockCount})
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setStockFilter("OUT_OF_STOCK")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: stockFilter === "OUT_OF_STOCK" ? "#475569" : "#f8fafc",
              color: stockFilter === "OUT_OF_STOCK" ? "white" : "#64748b",
              border: "1px solid #cbd5e1",
            }}
          >
            Hết hàng ({stats.outOfStockCount})
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setStockFilter("NEGATIVE")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: stockFilter === "NEGATIVE" ? "#b91c1c" : "#fef2f2",
              color: stockFilter === "NEGATIVE" ? "white" : "#991b1b",
              border: "1px solid #fecaca",
            }}
          >
            Âm kho ({stats.negativeCount})
          </button>
        </div>

        {/* Category Select Filter */}
        <div style={{ marginLeft: "auto", minWidth: 160 }}>
          <select
            className="select"
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value === "ALL" ? "ALL" : Number(e.target.value))
            }
            style={{
              padding: "9px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              fontSize: 13,
              width: "100%",
            }}
          >
            <option value="ALL">Tất cả danh mục</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Inventory Table */}
      <div
        style={{
          background: "white",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
            ⏳ Đang tải dữ liệu tồn kho...
          </div>
        ) : error ? (
          <div style={{ padding: 24, textAlign: "center", color: "#e11d48" }}>
            ❌ Lỗi: {error}
          </div>
        ) : sortedProducts.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
            🔍 Không tìm thấy sản phẩm nào khớp với điều kiện lọc!
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                  <th style={{ padding: "12px 14px", width: 50 }}>Ảnh</th>
                  <th
                    style={{ padding: "12px 14px", cursor: "pointer", width: 140 }}
                    onClick={() => setSort((s) => toggleSort(s, "sku"))}
                  >
                    Mã SKU {sort.key === "sku" ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th
                    style={{ padding: "12px 14px", cursor: "pointer" }}
                    onClick={() => setSort((s) => toggleSort(s, "name"))}
                  >
                    Tên Sản Phẩm {sort.key === "name" ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th
                    style={{ padding: "12px 14px", cursor: "pointer", width: 130 }}
                    onClick={() => setSort((s) => toggleSort(s, "category"))}
                  >
                    Danh Mục {sort.key === "category" ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th
                    style={{ padding: "12px 14px", cursor: "pointer", textAlign: "right", width: 190 }}
                    onClick={() => setSort((s) => toggleSort(s, "quantity_on_hand"))}
                  >
                    Tồn Vật Lý {sort.key === "quantity_on_hand" ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th
                    style={{ padding: "12px 14px", cursor: "pointer", textAlign: "right", width: 110 }}
                    onClick={() => setSort((s) => toggleSort(s, "unit_price"))}
                  >
                    Đơn Giá {sort.key === "unit_price" ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th style={{ padding: "12px 14px", textAlign: "center", width: 180 }}>Thao Tác Nhanh</th>
                </tr>
              </thead>
              <tbody>
                {sortedProducts.map((p) => {
                  const qty = p.quantity_on_hand || 0;
                  const baseUom = p.base_uom || "Pc";
                  const uom = p.uom || baseUom;
                  const mult = p.uom_multiplier || 1;

                  // Dual UOM Calculation
                  let packageStr = "";
                  if (mult > 1 && uom.toLowerCase() !== baseUom.toLowerCase()) {
                    const packages = Math.floor(Math.abs(qty) / mult);
                    const rem = Math.abs(qty) % mult;
                    const sign = qty < 0 ? "-" : "";
                    packageStr = `${sign}${packages} ${uom}` + (rem ? ` + ${rem} ${baseUom}` : "");
                  }

                  // Badge Colors
                  let badgeBg = "#f1f5f9";
                  let badgeColor = "#475569";
                  let badgeText = "Đủ hàng";

                  if (qty > 10) {
                    badgeBg = "#dcfce7";
                    badgeColor = "#15803d";
                    badgeText = "Dồi dào";
                  } else if (qty > 0 && qty <= 10) {
                    badgeBg = "#fef3c7";
                    badgeColor = "#b45309";
                    badgeText = "Sắp hết";
                  } else if (qty === 0) {
                    badgeBg = "#f1f5f9";
                    badgeColor = "#64748b";
                    badgeText = "Hết hàng";
                  } else if (qty < 0) {
                    badgeBg = "#fee2e2";
                    badgeColor = "#b91c1c";
                    badgeText = "Âm kho";
                  }

                  return (
                    <tr
                      key={p.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        transition: "background 0.1s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {/* Product Image */}
                      <td style={{ padding: "10px 14px" }}>
                        {p.image_url ? (
                          <img
                            src={assetUrl(p.image_url)}
                            alt={p.name}
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 6,
                              objectFit: "cover",
                              border: "1px solid #e2e8f0",
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 6,
                              background: "#f1f5f9",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 16,
                              color: "#94a3b8",
                            }}
                          >
                            📦
                          </div>
                        )}
                      </td>

                      {/* SKU */}
                      <td style={{ padding: "10px 14px", fontWeight: 600, color: "#1e293b" }}>
                        <code>{p.sku}</code>
                        {p.upc && (
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                            UPC: {p.upc}
                          </div>
                        )}
                      </td>

                      {/* Product Name */}
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ fontWeight: 600, color: "#0f172a" }}>{p.name}</div>
                        {p.is_sold_on_amazon && p.amazon_sku && (
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: 10,
                              background: "#fef3c7",
                              color: "#b45309",
                              padding: "2px 6px",
                              borderRadius: 4,
                              marginTop: 4,
                            }}
                          >
                            Amazon: {p.amazon_sku}
                          </span>
                        )}
                      </td>

                      {/* Category */}
                      <td style={{ padding: "10px 14px", color: "#64748b" }}>
                        {p.category_id ? categoryMap.get(p.category_id) || "—" : "—"}
                      </td>

                      {/* Stock Quantity (Dual UOM) */}
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                          <span
                            style={{
                              fontSize: 15,
                              fontWeight: 700,
                              color: qty < 0 ? "#b91c1c" : qty <= 10 ? "#d97706" : "#0f172a",
                            }}
                          >
                            {qty.toLocaleString()}
                          </span>
                          <span style={{ fontSize: 12, color: "#64748b" }}>{baseUom}</span>
                          <span
                            style={{
                              fontSize: 10,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: badgeBg,
                              color: badgeColor,
                              fontWeight: 600,
                            }}
                          >
                            {badgeText}
                          </span>
                        </div>
                        {packageStr && (
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                            ≈ <b>{packageStr}</b>
                          </div>
                        )}
                      </td>

                      {/* Price */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155", fontWeight: 500 }}>
                        ${Number(p.unit_price || 0).toFixed(2)}
                      </td>

                      {/* Quick Actions */}
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
                          <button
                            type="button"
                            className="btn"
                            title="Kiểm kê điều chỉnh số lượng tồn nhanh"
                            onClick={() => openQuickAdjust(p)}
                            style={{
                              padding: "4px 8px",
                              fontSize: 12,
                              borderRadius: 6,
                              background: "#e0f2fe",
                              color: "#0369a1",
                              border: "1px solid #bae6fd",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            ⚙️ Sửa tồn
                          </button>
                          <button
                            type="button"
                            className="btn"
                            title="Xem lịch sử xuất nhập kho gần nhất"
                            onClick={() => openQuickHistory(p)}
                            style={{
                              padding: "4px 8px",
                              fontSize: 12,
                              borderRadius: 6,
                              background: "#f1f5f9",
                              color: "#475569",
                              border: "1px solid #cbd5e1",
                              fontWeight: 500,
                              cursor: "pointer",
                            }}
                          >
                            📜 Lịch sử
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* QUICK ADJUST MODAL */}
      {adjustProduct && (
        <Modal
          open={adjustModalOpen}
          title={`⚙️ Kiểm Kê / Điều Chỉnh Tồn Kho`}
          onClose={() => setAdjustModalOpen(false)}
        >
          <div style={{ padding: "4px 0" }}>
            <div
              style={{
                background: "#f8fafc",
                padding: "12px 16px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                marginBottom: 16,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>
                {adjustProduct.name}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                Mã SKU: <code>{adjustProduct.sku}</code> | Tồn thực hiện tại:{" "}
                <b>{adjustProduct.quantity_on_hand || 0} {adjustProduct.base_uom || "Pc"}</b>
              </div>
            </div>

            {adjustSuccessMsg && (
              <div
                style={{
                  background: "#dcfce7",
                  color: "#15803d",
                  padding: "10px 14px",
                  borderRadius: 8,
                  marginBottom: 14,
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                {adjustSuccessMsg}
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Số lượng tồn thực tế sau kiểm kê ({adjustProduct.base_uom || "Pc"}):
              </label>
              <input
                type="number"
                className="input"
                value={adjustTargetQty}
                onChange={(e) => setAdjustTargetQty(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: 16,
                  fontWeight: 700,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              />
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                Chênh lệch điều chỉnh (Delta):{" "}
                <b
                  style={{
                    color:
                      adjustTargetQty - (adjustProduct.quantity_on_hand || 0) < 0
                        ? "#dc2626"
                        : "#16a34a",
                  }}
                >
                  {adjustTargetQty - (adjustProduct.quantity_on_hand || 0) >= 0 ? "+" : ""}
                  {adjustTargetQty - (adjustProduct.quantity_on_hand || 0)}{" "}
                  {adjustProduct.base_uom || "Pc"}
                </b>
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Lý do kiểm kê / Ghi chú:
              </label>
              <textarea
                className="input"
                rows={2}
                placeholder="VD: Kiểm đếm thực tế đầu tháng, bù hao hụt..."
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: 13,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setAdjustModalOpen(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={adjustBusy}
                onClick={() => void submitQuickAdjust()}
                style={{
                  padding: "8px 20px",
                  borderRadius: 8,
                  background: "#2563eb",
                  color: "white",
                  fontWeight: 600,
                  border: "none",
                }}
              >
                {adjustBusy ? "Đang lưu..." : "Xác nhận lưu tồn"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* QUICK HISTORY MODAL */}
      {historyProduct && (
        <Modal
          open={historyModalOpen}
          title={`📜 Lịch Sử Biến Động: ${historyProduct.name}`}
          onClose={() => setHistoryModalOpen(false)}
        >
          <div style={{ minWidth: 500, maxHeight: 450, overflowY: "auto" }}>
            {historyLoading ? (
              <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                ⏳ Đang tải lịch sử xuất nhập...
              </div>
            ) : historyMovements.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>
                Chưa có giao dịch biến động nào cho sản phẩm này.
              </div>
            ) : (
              <table className="table" style={{ width: "100%", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    <th style={{ padding: "8px 10px" }}>Thời gian</th>
                    <th style={{ padding: "8px 10px" }}>Loại</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Biến động</th>
                    <th style={{ padding: "8px 10px" }}>Nguồn / Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {historyMovements.map((m) => {
                    const isPositive = m.quantity_delta > 0;
                    return (
                      <tr key={m.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                          {new Date(m.created_at).toLocaleString("vi-VN")}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <span
                            style={{
                              padding: "2px 6px",
                              borderRadius: 4,
                              fontWeight: 600,
                              fontSize: 11,
                              background:
                                m.movement_type === "IN"
                                  ? "#dcfce7"
                                  : m.movement_type === "OUT"
                                  ? "#fee2e2"
                                  : "#fef3c7",
                              color:
                                m.movement_type === "IN"
                                  ? "#15803d"
                                  : m.movement_type === "OUT"
                                  ? "#b91c1c"
                                  : "#b45309",
                            }}
                          >
                            {m.movement_type}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "8px 10px",
                            textAlign: "right",
                            fontWeight: 700,
                            color: isPositive ? "#16a34a" : "#dc2626",
                          }}
                        >
                          {isPositive ? `+${m.quantity_delta}` : m.quantity_delta}
                        </td>
                        <td style={{ padding: "8px 10px", color: "#64748b" }}>
                          {m.note || (m.receipt_id ? `Phiếu nhập #${m.receipt_id}` : m.issue_id ? `Phiếu xuất #${m.issue_id}` : "—")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <Link
                to={`/stock-history?query=${encodeURIComponent(historyProduct.sku)}`}
                style={{ fontSize: 13, color: "#2563eb", fontWeight: 600, textDecoration: "none" }}
              >
                👉 Xem toàn bộ trên sổ cái kho &rarr;
              </Link>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
