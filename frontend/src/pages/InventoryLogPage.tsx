import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, assetUrl } from "../api/client";
import type { Product, StockMovement } from "../types";
import type { SortState } from "../utils/table";
import { matchesQuery, sortBy, toggleSort } from "../utils/table";

type MovementTypeFilter = "ALL" | "IN" | "OUT" | "ADJUST";
type DateRangeFilter = "ALL" | "TODAY" | "7DAYS" | "30DAYS";

export default function InventoryLogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<MovementTypeFilter>("ALL");
  const [dateFilter, setDateFilter] = useState<DateRangeFilter>("ALL");
  const [sort, setSort] = useState<SortState<"id" | "time" | "type" | "sku" | "product" | "delta" | "source">>({
    key: "time",
    dir: "desc",
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const rows = useMemo(() => {
    return movements.map((m) => {
      const p = productById.get(m.product_id);
      let sourceLabel = "-";
      let sourceType: "invoice" | "receipt" | "issue" | "sale" | "other" = "other";
      let sourceLink: string | null = null;

      if (m.invoice_id != null) {
        sourceLabel = `Hóa đơn #${m.invoice_id}`;
        sourceType = "invoice";
        sourceLink = "/invoices";
      } else if (m.receipt_id != null) {
        sourceLabel = `Phiếu nhập #${m.receipt_id}`;
        sourceType = "receipt";
        sourceLink = "/receipts";
      } else if (m.issue_id != null) {
        sourceLabel = `Phiếu xuất #${m.issue_id}`;
        sourceType = "issue";
        sourceLink = "/issue";
      } else if (m.sale_order_id != null) {
        sourceLabel = `Đơn bán #${m.sale_order_id}`;
        sourceType = "sale";
        sourceLink = "/issue";
      } else {
        sourceLabel = "Điều chỉnh";
        sourceType = "other";
      }

      return {
        movement: m,
        sku: p?.sku ?? `ID:${m.product_id}`,
        productName: p?.name ?? "Sản phẩm không xác định",
        productImage: p?.image_url,
        sourceLabel,
        sourceType,
        sourceLink,
      };
    });
  }, [movements, productById]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, m] = await Promise.all([
        apiJson<Product[]>("/api/v1/products"),
        apiJson<StockMovement[]>("/api/v1/inventory/movements?limit=1000"),
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

  // Filter by date & type & query
  const displayed = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = todayStart - 7 * 86400000;
    const thirtyDaysAgo = todayStart - 30 * 86400000;

    const filtered = rows.filter((row) => {
      // Type filter
      if (typeFilter !== "ALL" && row.movement.movement_type !== typeFilter) {
        return false;
      }

      // Date range filter
      const t = new Date(row.movement.created_at).getTime();
      if (dateFilter === "TODAY" && t < todayStart) return false;
      if (dateFilter === "7DAYS" && t < sevenDaysAgo) return false;
      if (dateFilter === "30DAYS" && t < thirtyDaysAgo) return false;

      // Text query
      return matchesQuery(
        query,
        row.movement.id,
        row.movement.movement_type,
        row.sku,
        row.productName,
        row.sourceLabel,
        row.movement.note,
      );
    });

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
            return row.sourceLabel;
          default:
            return row.movement.id;
        }
      },
      sort.dir,
    );
  }, [rows, query, typeFilter, dateFilter, sort]);

  // Statistics calculation on displayed data
  const stats = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    let totalAdjust = 0;
    let inCount = 0;
    let outCount = 0;
    let adjustCount = 0;

    for (const row of displayed) {
      const delta = row.movement.quantity_delta;
      if (row.movement.movement_type === "IN") {
        totalIn += delta;
        inCount++;
      } else if (row.movement.movement_type === "OUT") {
        totalOut += Math.abs(delta);
        outCount++;
      } else if (row.movement.movement_type === "ADJUST") {
        totalAdjust += delta;
        adjustCount++;
      }
    }

    return {
      totalCount: displayed.length,
      totalIn,
      totalOut,
      totalAdjust,
      inCount,
      outCount,
      adjustCount,
    };
  }, [displayed]);

  // Export CSV
  const handleExportCsv = () => {
    const headers = ["ID", "Thời gian", "Loại", "SKU", "Tên Sản Phẩm", "Biến Động (Base UOM)", "Nguồn Chứng Từ", "Ghi Chú"];
    const csvRows = [headers.join(",")];

    for (const r of displayed) {
      const values = [
        r.movement.id,
        `"${new Date(r.movement.created_at).toLocaleString()}"`,
        r.movement.movement_type,
        `"${r.sku}"`,
        `"${r.productName.replace(/"/g, '""')}"`,
        r.movement.quantity_delta,
        `"${r.sourceLabel}"`,
        `"${(r.movement.note || "").replace(/"/g, '""')}"`,
      ];
      csvRows.push(values.join(","));
    }

    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `so-cai-bien-dong-kho-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  function mark(col: typeof sort.key): string {
    if (sort.key !== col) return "";
    return sort.dir === "asc" ? " ↑" : " ↓";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header card */}
      <div className="card" style={{ background: "white" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ margin: "0 0 4px 0", color: "#1e293b", display: "flex", alignItems: "center", gap: 8 }}>
              <span>📜</span> Sổ Cái Lịch Sử Biến Động Kho (Stock History)
            </h2>
            <div className="muted" style={{ fontSize: 13 }}>
              Sổ cái chung duy nhất ghi nhận toàn bộ biến động Nhập / Xuất / Điều chỉnh theo thời gian thực (Source of Truth).
            </div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <button className="btn" onClick={handleExportCsv} disabled={displayed.length === 0} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>📥</span> Xuất File CSV
            </button>
            <button className="btn primary" onClick={() => void load()} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>🔄</span> {loading ? "Đang tải..." : "Làm Mới"}
            </button>
          </div>
        </div>

        {/* 4 Summary Metric Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 16 }}>
          <div className="card" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", padding: "12px 16px" }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>TỔNG GIAO DỊCH</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#1e293b", marginTop: 4 }}>
              {stats.totalCount} <span style={{ fontSize: 13, fontWeight: 500, color: "#64748b" }}>lượt</span>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Trong phạm vi bộ lọc</div>
          </div>

          <div className="card" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "12px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#166534" }}>📥 TỔNG NHẬP KHO (IN)</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#15803d", marginTop: 4 }}>
              +{stats.totalIn.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 500 }}>cái</span>
            </div>
            <div style={{ fontSize: 11, color: "#166534", marginTop: 2 }}>{stats.inCount} phiếu nhập</div>
          </div>

          <div className="card" style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "12px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#991b1b" }}>📤 TỔNG XUẤT KHO (OUT)</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#dc2626", marginTop: 4 }}>
              -{stats.totalOut.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 500 }}>cái</span>
            </div>
            <div style={{ fontSize: 11, color: "#991b1b", marginTop: 2 }}>{stats.outCount} phiếu xuất / đơn bán</div>
          </div>

          <div className="card" style={{ background: "#fffbeb", border: "1px solid #fde68a", padding: "12px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#92400e" }}>⚙️ ĐIỀU CHỈNH KIỂM KÊ</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: stats.totalAdjust >= 0 ? "#15803d" : "#dc2626", marginTop: 4 }}>
              {stats.totalAdjust > 0 ? `+${stats.totalAdjust}` : stats.totalAdjust} <span style={{ fontSize: 13, fontWeight: 500 }}>cái</span>
            </div>
            <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>{stats.adjustCount} lần kiểm kê</div>
          </div>
        </div>
      </div>

      {/* Filter and Table Card */}
      <div className="card" style={{ background: "white" }}>
        {/* Filter Toolbar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 14, borderBottom: "1px solid #f1f5f9" }}>
          {/* Top row: Search input and Date Range buttons */}
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            {/* Search Input */}
            <div style={{ flex: "1 1 300px", maxWidth: 450 }}>
              <input
                className="input"
                style={{ width: "100%", padding: "7px 12px", fontSize: 13 }}
                placeholder="🔍 Tìm nhanh theo SKU, tên sản phẩm, số chứng từ, ghi chú..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {/* Date Range Filter */}
            <div className="row" style={{ gap: 6, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Thời gian:</span>
              <button
                type="button"
                className={`btn ${dateFilter === "ALL" ? "primary" : ""}`}
                style={{ padding: "4px 10px", fontSize: 12, borderRadius: 6 }}
                onClick={() => setDateFilter("ALL")}
              >
                Tất Cả
              </button>
              <button
                type="button"
                className={`btn ${dateFilter === "TODAY" ? "primary" : ""}`}
                style={{ padding: "4px 10px", fontSize: 12, borderRadius: 6 }}
                onClick={() => setDateFilter("TODAY")}
              >
                Hôm Nay
              </button>
              <button
                type="button"
                className={`btn ${dateFilter === "7DAYS" ? "primary" : ""}`}
                style={{ padding: "4px 10px", fontSize: 12, borderRadius: 6 }}
                onClick={() => setDateFilter("7DAYS")}
              >
                7 Ngày Qua
              </button>
              <button
                type="button"
                className={`btn ${dateFilter === "30DAYS" ? "primary" : ""}`}
                style={{ padding: "4px 10px", fontSize: 12, borderRadius: 6 }}
                onClick={() => setDateFilter("30DAYS")}
              >
                30 Ngày Qua
              </button>
            </div>
          </div>

          {/* Bottom row: Type filter pills */}
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Loại giao dịch:</span>
            <button
              className={`btn ${typeFilter === "ALL" ? "primary" : ""}`}
              type="button"
              onClick={() => setTypeFilter("ALL")}
              style={{ padding: "4px 12px", fontSize: 12, borderRadius: 8 }}
            >
              Tất cả ({movements.length})
            </button>
            <button
              className={`btn ${typeFilter === "IN" ? "primary" : ""}`}
              type="button"
              onClick={() => setTypeFilter("IN")}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                borderRadius: 8,
                background: typeFilter === "IN" ? undefined : "#f0fdf4",
                color: typeFilter === "IN" ? undefined : "#15803d",
                borderColor: "#bbf7d0",
              }}
            >
              📥 Nhập Kho (IN)
            </button>
            <button
              className={`btn ${typeFilter === "OUT" ? "primary" : ""}`}
              type="button"
              onClick={() => setTypeFilter("OUT")}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                borderRadius: 8,
                background: typeFilter === "OUT" ? undefined : "#fef2f2",
                color: typeFilter === "OUT" ? undefined : "#b91c1c",
                borderColor: "#fecaca",
              }}
            >
              📤 Xuất Kho / Bán Hàng (OUT)
            </button>
            <button
              className={`btn ${typeFilter === "ADJUST" ? "primary" : ""}`}
              type="button"
              onClick={() => setTypeFilter("ADJUST")}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                borderRadius: 8,
                background: typeFilter === "ADJUST" ? undefined : "#fffbeb",
                color: typeFilter === "ADJUST" ? undefined : "#b45309",
                borderColor: "#fde68a",
              }}
            >
              ⚙️ Kiểm Kê Điều Chỉnh (ADJUST)
            </button>

            <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
              Hiển thị <strong>{displayed.length}</strong> dòng
            </span>
          </div>
        </div>

        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

        {/* Master Stock Ledger Table */}
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left", color: "#475569", borderBottom: "2px solid #e2e8f0" }}>
                <th style={{ width: 65, padding: "8px 10px" }}>
                  <button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "id"))}>
                    #ID{mark("id")}
                  </button>
                </th>
                <th style={{ width: 155, padding: "8px 10px" }}>
                  <button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "time"))}>
                    Thời Gian{mark("time")}
                  </button>
                </th>
                <th style={{ width: 125, padding: "8px 10px" }}>
                  <button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "type"))}>
                    Loại{mark("type")}
                  </button>
                </th>
                <th style={{ width: 140, padding: "8px 10px" }}>
                  <button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "sku"))}>
                    Mã SKU{mark("sku")}
                  </button>
                </th>
                <th style={{ padding: "8px 10px" }}>
                  <button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "product"))}>
                    Sản Phẩm{mark("product")}
                  </button>
                </th>
                <th className="right" style={{ width: 130, padding: "8px 10px" }}>
                  <button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "delta"))}>
                    Biến Động{mark("delta")}
                  </button>
                </th>
                <th style={{ width: 175, padding: "8px 10px" }}>
                  <button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "source"))}>
                    Nguồn Chứng Từ{mark("source")}
                  </button>
                </th>
                <th style={{ padding: "8px 10px" }}>Ghi Chú</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((row) => {
                const m = row.movement;
                const isPositive = m.quantity_delta > 0;
                const isNegative = m.quantity_delta < 0;

                return (
                  <tr key={m.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 10px", color: "#64748b", fontWeight: 600 }}>
                      #{m.id}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 12, color: "#334155", whiteSpace: "nowrap" }}>
                      {new Date(m.created_at).toLocaleString("vi-VN", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      {m.movement_type === "IN" ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "#dcfce7",
                            color: "#15803d",
                            fontWeight: 700,
                            fontSize: 11,
                            whiteSpace: "nowrap",
                          }}
                        >
                          📥 Nhập (IN)
                        </span>
                      ) : m.movement_type === "OUT" ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "#fee2e2",
                            color: "#b91c1c",
                            fontWeight: 700,
                            fontSize: 11,
                            whiteSpace: "nowrap",
                          }}
                        >
                          📤 Xuất (OUT)
                        </span>
                      ) : (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "#fef3c7",
                            color: "#b45309",
                            fontWeight: 700,
                            fontSize: 11,
                            whiteSpace: "nowrap",
                          }}
                        >
                          ⚙️ Điều Chỉnh
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#1e3a8a" }}>
                        {row.sku}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {row.productImage ? (
                          <img
                            src={assetUrl(row.productImage)}
                            alt=""
                            loading="lazy"
                            style={{ width: 28, height: 28, borderRadius: 4, objectFit: "cover", border: "1px solid #e2e8f0" }}
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                          />
                        ) : null}
                        <span style={{ fontWeight: 600, color: "#1e293b" }}>{row.productName}</span>
                      </div>
                    </td>
                    <td className="right" style={{ padding: "8px 10px" }}>
                      {isPositive ? (
                        <span style={{ color: "#16a34a", fontWeight: 700, fontSize: 14 }}>
                          +{m.quantity_delta.toLocaleString()}
                        </span>
                      ) : isNegative ? (
                        <span style={{ color: "#dc2626", fontWeight: 700, fontSize: 14 }}>
                          {m.quantity_delta.toLocaleString()}
                        </span>
                      ) : (
                        <span style={{ color: "#64748b" }}>0</span>
                      )}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      {row.sourceLink ? (
                        <Link
                          to={row.sourceLink}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 8px",
                            borderRadius: 6,
                            textDecoration: "none",
                            fontWeight: 600,
                            fontSize: 12,
                            background:
                              row.sourceType === "invoice"
                                ? "#ede9fe"
                                : row.sourceType === "receipt"
                                ? "#e0f2fe"
                                : row.sourceType === "issue"
                                ? "#ffedd5"
                                : "#f1f5f9",
                            color:
                              row.sourceType === "invoice"
                                ? "#6d28d9"
                                : row.sourceType === "receipt"
                                ? "#0369a1"
                                : row.sourceType === "issue"
                                ? "#c2410c"
                                : "#334155",
                          }}
                        >
                          {row.sourceLabel} ➔
                        </Link>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>{row.sourceLabel}</span>
                      )}
                    </td>
                    <td style={{ padding: "8px 10px", color: "#64748b", maxWidth: 260, fontSize: 12 }}>
                      {m.note || "--"}
                    </td>
                  </tr>
                );
              })}
              {!loading && displayed.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "36px 12px", color: "#94a3b8" }}>
                    Không tìm thấy biến động kho nào khớp với bộ lọc hiện tại.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
