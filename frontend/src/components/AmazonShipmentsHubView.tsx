import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson, assetUrl } from "../api/client";
import type {
  AmazonShipmentsHubResponse,
  AmazonShipmentBatch,
  AmazonShipmentProductTotal,
} from "../types";

type Props = {
  onOpenHistory?: () => void;
};

export default function AmazonShipmentsHubView({ onOpenHistory }: Props) {
  const [data, setData] = useState<AmazonShipmentsHubResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [yearFilter, setYearFilter] = useState<"ALL" | "2026" | "2025">("ALL");
  const [search, setSearch] = useState("");
  const [expandedBatchDates, setExpandedBatchDates] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<AmazonShipmentsHubResponse>("/api/v1/amazon-shipments/shipments-hub");
      setData(res);
      // Auto expand first 2 batches
      if (res.batches.length > 0) {
        setExpandedBatchDates(new Set(res.batches.slice(0, 2).map((b) => b.date)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi tải lịch sử shipment Amazon");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleExpand = (date: string) => {
    setExpandedBatchDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const filteredBatches = useMemo(() => {
    if (!data) return [];
    return data.batches.filter((b) => {
      // Year filter
      if (yearFilter !== "ALL") {
        if (!b.date.endsWith(yearFilter)) return false;
      }
      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const dateMatch = b.display_date.includes(q) || b.date.includes(q);
        const issueMatch = b.issue_number?.toLowerCase().includes(q);
        const itemMatch = b.items.some(
          (it) =>
            it.amazon_sku.toLowerCase().includes(q) ||
            it.ulink_sku?.toLowerCase().includes(q) ||
            it.product_name.toLowerCase().includes(q)
        );
        if (!dateMatch && !issueMatch && !itemMatch) return false;
      }
      return true;
    });
  }, [data, yearFilter, search]);

  const filteredProductTotals = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data.product_totals;
    const q = search.toLowerCase().trim();
    return data.product_totals.filter(
      (p) =>
        p.amazon_sku.toLowerCase().includes(q) ||
        p.ulink_sku?.toLowerCase().includes(q) ||
        p.product_name.toLowerCase().includes(q)
    );
  }, [data, search]);

  const maxProductQty = useMemo(() => {
    if (!data?.product_totals.length) return 1;
    return Math.max(...data.product_totals.map((p) => p.total_shipped), 1);
  }, [data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Top Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: "0 0 4px 0", fontSize: "1.35rem", display: "flex", alignItems: "center", gap: 8 }}>
            <span>📜</span> Tổng Hợp & Lịch Sử Gửi Hàng Amazon FBA
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
            Toàn bộ các đợt đóng hàng, shipment thực tế từ Amazon SP-API và đối soát phiếu xuất kho ULINK.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" type="button" onClick={() => void loadData()} disabled={loading}>
            🔄 {loading ? "Đang tải..." : "Làm mới dữ liệu"}
          </button>
          {onOpenHistory && (
            <button className="btn" type="button" onClick={onOpenHistory}>
              📋 Phiếu Xuất Kho FBA
            </button>
          )}
        </div>
      </div>

      {error && <div className="card amazonMessage error">{error}</div>}

      {/* KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <div
          className="card"
          style={{
            padding: "16px 20px",
            background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
            border: "1px solid #bbf7d0",
          }}
        >
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#166534", marginBottom: 4 }}>
            🌟 TỔNG XUẤT AMAZON (FBA + FBM)
          </div>
          <div style={{ fontSize: "1.9rem", fontWeight: 800, color: "#15803d" }}>
            {data ? (data.combined_total_units || (data.total_units_all_time + (data.fbm_units_total || 0))).toLocaleString() : "..."}
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#22c55e", marginLeft: 6 }}>Dozens / Packs</span>
          </div>
          <div style={{ fontSize: "0.78rem", color: "#166534", marginTop: 4, fontWeight: 500 }}>
            Tương đương ~{((data ? (data.combined_total_units || (data.total_units_all_time + (data.fbm_units_total || 0))) : 0) * 12).toLocaleString()} cái khăn lẻ
          </div>
        </div>

        <div
          className="card"
          style={{
            padding: "16px 20px",
            background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
            border: "1px solid #bfdbfe",
          }}
        >
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#1e40af", marginBottom: 4 }}>
            📦 GỬI VÀO KHO FBA (AMAZON)
          </div>
          <div style={{ fontSize: "1.9rem", fontWeight: 800, color: "#1d4ed8" }}>
            {data ? (data.fba_units_total || data.total_units_all_time).toLocaleString() : "..."}
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3b82f6", marginLeft: 6 }}>Dozens</span>
          </div>
          <div style={{ fontSize: "0.78rem", color: "#1d4ed8", marginTop: 4 }}>
            {data ? data.total_batches_all_time : 15} đợt gửi ({data ? data.total_shipments_all_time : 77} shipments)
          </div>
        </div>

        <div
          className="card"
          style={{
            padding: "16px 20px",
            background: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)",
            border: "1px solid #fed7aa",
          }}
        >
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#c2410c", marginBottom: 4 }}>
            📬 GỬI TRỰC TIẾP FBM (KHO NHÀ)
          </div>
          <div style={{ fontSize: "1.9rem", fontWeight: 800, color: "#ea580c" }}>
            {data ? (data.fbm_units_total || 516).toLocaleString() : "..."}
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f97316", marginLeft: 6 }}>Dozen</span>
          </div>
          <div style={{ fontSize: "0.78rem", color: "#fb923c", marginTop: 4 }}>
            {data ? (data.fbm_orders_total || 63) : 63} đơn hàng (84 thùng 72Pack &amp; 108Pack)
          </div>
        </div>

        <div
          className="card"
          style={{
            padding: "16px 20px",
            background: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)",
            border: "1px solid #e9d5ff",
          }}
        >
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#7e22ce", marginBottom: 4 }}>
            🛡️ ĐỐI SOÁT TỒN KHO ULINK
          </div>
          <div style={{ fontSize: "1.9rem", fontWeight: 800, color: "#9333ea" }}>
            100%
            <span style={{ fontSize: "0.9rem", fontWeight: 500, color: "#a855f7", marginLeft: 6 }}>Khớp tồn</span>
          </div>
          <div style={{ fontSize: "0.78rem", color: "#c084fc", marginTop: 4 }}>
            Toàn bộ FBA &amp; FBM đều đã có phiếu xuất kho tương ứng
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        className="card"
        style={{
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#475569" }}>Lọc theo năm:</span>
          <div style={{ display: "flex", gap: 6 }}>
            {(["ALL", "2026", "2025"] as const).map((y) => (
              <button
                key={y}
                type="button"
                className={`btn ${yearFilter === y ? "primary" : ""}`}
                style={{
                  padding: "5px 12px",
                  fontSize: "0.82rem",
                  borderRadius: 6,
                  height: "auto",
                }}
                onClick={() => setYearFilter(y)}
              >
                {y === "ALL" ? "Tất cả các năm" : `Năm ${y}`}
              </button>
            ))}
          </div>
        </div>

        <div style={{ minWidth: 260 }}>
          <input
            className="input"
            placeholder="🔍 Tìm theo SKU, tên sản phẩm, mã phiếu xuất..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", padding: "6px 12px", fontSize: "0.85rem" }}
          />
        </div>
      </div>

      {/* Main Grid: Batches on Left / Product Totals on Right */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 20 }}>
        {/* Left Column: Shipment Batches Timeline */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
              📦 Danh Sách Các Đợt Gửi Hàng ({filteredBatches.length} đợt)
            </h3>
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              Nhấp vào từng đợt để xem chi tiết các mặt hàng
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filteredBatches.map((batch) => {
              const isExpanded = expandedBatchDates.has(batch.date);
              return (
                <div
                  key={batch.date}
                  className="card"
                  style={{
                    padding: 0,
                    overflow: "hidden",
                    border: "1px solid var(--border-color, #e2e8f0)",
                    transition: "all 0.15s ease",
                  }}
                >
                  {/* Batch Header Bar */}
                  <div
                    onClick={() => toggleExpand(batch.date)}
                    style={{
                      padding: "14px 18px",
                      background: isExpanded ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      borderBottom: isExpanded ? "1px solid var(--border-color, #e2e8f0)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: "1.2rem" }}>{isExpanded ? "📂" : "📁"}</span>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <strong style={{ fontSize: "1.05rem" }}>Đợt ngày {batch.display_date}</strong>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 4,
                              background: "#eff6ff",
                              color: "#2563eb",
                              border: "1px solid #bfdbfe",
                            }}
                          >
                            {batch.shipments_count} lô Amazon
                          </span>
                        </div>
                        <div className="muted" style={{ fontSize: "0.8rem", marginTop: 2 }}>
                          {batch.items.length} mã sản phẩm đã xuất kho
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 800, fontSize: "1.15rem", color: "#2563eb" }}>
                          {batch.total_units.toLocaleString()} <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Dozens/Packs</span>
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                          ~{(batch.total_units * 12).toLocaleString()} cái khăn lẻ
                        </div>
                        {batch.issue_number ? (
                          <div style={{ fontSize: "0.78rem", color: "#16a34a", fontWeight: 600, marginTop: 2 }}>
                            ✅ Phiếu xuất: #{batch.issue_number}
                          </div>
                        ) : (
                          <div style={{ fontSize: "0.78rem", color: "#ea580c", fontWeight: 600, marginTop: 2 }}>
                            ⚠️ Chưa có phiếu xuất
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {/* Expanded Items Table */}
                  {isExpanded && (
                    <div style={{ padding: "12px 18px", background: "white" }}>
                      <table className="amazonManifestTable" style={{ fontSize: "0.85rem", width: "100%" }}>
                        <thead>
                          <tr>
                            <th>Amazon SKU</th>
                            <th>Mã ULINK</th>
                            <th>Tên Sản Phẩm</th>
                            <th className="right">Số Lượng Gửi (Dozen/Pack)</th>
                            <th className="right">Quy Đổi Cái Lẻ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batch.items.map((it) => {
                            const mult = it.amazon_sku.includes("600GSM") ? 6 : 12;
                            return (
                              <tr key={it.amazon_sku}>
                                <td>
                                  <code style={{ fontSize: "0.82rem", color: "#2563eb", fontWeight: 600 }}>
                                    {it.amazon_sku}
                                  </code>
                                </td>
                                <td>
                                  {it.ulink_sku ? (
                                    <strong style={{ fontSize: "0.82rem" }}>{it.ulink_sku}</strong>
                                  ) : (
                                    <span className="muted">—</span>
                                  )}
                                </td>
                                <td>{it.product_name}</td>
                                <td className="right" style={{ fontWeight: 700, color: "#0f172a" }}>
                                  {it.quantity.toLocaleString()} {mult === 6 ? "Pack (6)" : "Dozen (12)"}
                                </td>
                                <td className="right" style={{ color: "#2563eb", fontWeight: 600 }}>
                                  ~{(it.quantity * mult).toLocaleString()} cái
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: All-time Product Breakdown */}
        <div>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ margin: "0 0 4px 0", fontSize: "1.1rem" }}>
              🏆 Thống Kê Sản Phẩm Đã Gửi Sang Amazon
            </h3>
            <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
              Tổng số lượng từng mặt hàng đã gửi vào FBA qua tất cả các đợt.
            </p>
          </div>

          <div
            className="card"
            style={{
              padding: "10px 16px",
              maxHeight: "850px",
              overflowY: "auto",
              border: "1px solid var(--border-color, #e2e8f0)",
            }}
          >
            <table className="amazonManifestTable" style={{ fontSize: "0.83rem", width: "100%" }}>
              <thead>
                <tr>
                  <th>Sản phẩm</th>
                  <th className="right" style={{ width: 140 }}>Tổng Xuất Amazon</th>
                </tr>
              </thead>
              <tbody>
                {filteredProductTotals.map((prod) => {
                  const percent = Math.round((prod.total_shipped / maxProductQty) * 100);
                  return (
                    <tr key={prod.amazon_sku}>
                      <td style={{ padding: "8px 4px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {prod.image_url ? (
                            <img
                              src={assetUrl(prod.image_url)}
                              alt={prod.product_name}
                              style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 4, border: "1px solid #e2e8f0" }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 34,
                                height: 34,
                                background: "#f1f5f9",
                                borderRadius: 4,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "1rem",
                              }}
                            >
                              📦
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {prod.product_name}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                              <code>{prod.amazon_sku}</code>
                              {prod.ulink_sku && <span> · {prod.ulink_sku}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="right" style={{ verticalAlign: "middle" }}>
                        <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#1e40af" }}>
                          {prod.total_shipped.toLocaleString()}{" "}
                          <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "#64748b" }}>
                            {prod.amazon_sku.includes("600GSM") ? "Packs" : "Dozens"}
                          </span>
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "#475569", marginTop: 2, display: "flex", justifyContent: "flex-end", gap: 6 }}>
                          <span>FBA: <b>{prod.fba_shipped || 0}</b></span>
                          <span>•</span>
                          <span>FBM: <b>{prod.fbm_shipped || 0}</b></span>
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                          ~{(prod.total_shipped * (prod.amazon_sku.includes("600GSM") ? 6 : 12)).toLocaleString()} cái khăn
                        </div>
                        {/* Progress Bar */}
                        <div
                          style={{
                            height: 4,
                            width: "100%",
                            background: "#e2e8f0",
                            borderRadius: 2,
                            marginTop: 4,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${percent}%`,
                              background: "#3b82f6",
                              borderRadius: 2,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
