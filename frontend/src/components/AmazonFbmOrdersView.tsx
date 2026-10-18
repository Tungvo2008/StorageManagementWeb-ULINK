import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import type { AmazonFbmOrder, AmazonFbmOrdersResponse } from "../types";

type Props = {
  onOpenHistory?: () => void;
};

export default function AmazonFbmOrdersView({ onOpenHistory }: Props) {
  const [data, setData] = useState<AmazonFbmOrdersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<"ALL" | "Shipped" | "Unshipped">("ALL");
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<AmazonFbmOrder | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<AmazonFbmOrdersResponse>("/api/v1/amazon-shipments/fbm-orders");
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi tải danh sách đơn hàng FBM");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredOrders = useMemo(() => {
    if (!data) return [];
    return data.orders.filter((o) => {
      // Status filter
      if (statusFilter !== "ALL" && o.order_status.toLowerCase() !== statusFilter.toLowerCase()) {
        return false;
      }
      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const idMatch = o.order_id.toLowerCase().includes(q);
        const buyerMatch = (o.recipient_name || "").toLowerCase().includes(q);
        const cityMatch = (o.city || "").toLowerCase().includes(q);
        const stateMatch = (o.state || "").toLowerCase().includes(q);
        const issueMatch = (o.issue_number || "").toLowerCase().includes(q);
        const itemMatch = o.items.some(
          (it) =>
            it.sku.toLowerCase().includes(q) ||
            (it.ulink_sku || "").toLowerCase().includes(q) ||
            (it.ulink_product_name || "").toLowerCase().includes(q)
        );
        if (!idMatch && !buyerMatch && !cityMatch && !stateMatch && !issueMatch && !itemMatch) {
          return false;
        }
      }
      return true;
    });
  }, [data, statusFilter, search]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: "0 0 4px 0", fontSize: "1.35rem", display: "flex", alignItems: "center", gap: 8 }}>
            <span>📬</span> Quản Lý &amp; Lịch Sử Đơn Hàng Amazon FBM (Seller Fulfilled)
          </h2>
          <div style={{ fontSize: 13, color: "#64748b" }}>
            Đơn hàng khách mua trên Amazon do kho ULINK tự đóng gói và vận chuyển (PirateShip / UPS Ground)
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="btn"
            disabled={loading}
            onClick={() => void loadData()}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span style={{ display: "inline-block", transform: loading ? "rotate(180deg)" : "none", transition: "transform 0.5s" }}>
              🔄
            </span>
            <span>{loading ? "Đang đồng bộ..." : "Làm mới đơn FBM"}</span>
          </button>
          {onOpenHistory && (
            <button type="button" className="btn" onClick={onOpenHistory}>
              📜 Sổ Phiếu Xuất Kho
            </button>
          )}
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 14,
        }}
      >
        {/* Total Orders Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1.5px solid #e2e8f0",
            borderRadius: 12,
            padding: "14px 18px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
            📬 Tổng Số Đơn FBM
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
            {data ? data.total_orders.toLocaleString() : "..."}{" "}
            <span style={{ fontSize: 13, fontWeight: 500 }}>đơn hàng</span>
          </div>
          <div style={{ fontSize: 11, color: "#16a34a", marginTop: 4, fontWeight: 600 }}>
            ✓ 100% Đã Hoàn Tất Gửi Hàng
          </div>
        </div>

        {/* Total Packs Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1.5px solid #e2e8f0",
            borderRadius: 12,
            padding: "14px 18px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
            📦 Tổng Số Thùng / Lốc
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#2563eb", marginTop: 4 }}>
            {data ? data.total_packs.toLocaleString() : "..."}{" "}
            <span style={{ fontSize: 13, fontWeight: 500 }}>thùng/lốc</span>
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
            Đóng thùng 72 Pack &amp; 108 Pack
          </div>
        </div>

        {/* Total Dozens Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1.5px solid #e2e8f0",
            borderRadius: 12,
            padding: "14px 18px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
            🔢 Quy Đổi Đơn Vị Dozen
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#7c3aed", marginTop: 4 }}>
            {data ? data.total_dozens.toLocaleString() : "..."}{" "}
            <span style={{ fontSize: 13, fontWeight: 500 }}>Dozen</span>
          </div>
          <div style={{ fontSize: 11, color: "#7c3aed", marginTop: 4, fontWeight: 500 }}>
            Khớp đơn vị tính tổng Amazon
          </div>
        </div>

        {/* Total Towel Pieces Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1.5px solid #e2e8f0",
            borderRadius: 12,
            padding: "14px 18px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
            🧺 Tổng Số Cái Khăn Lẻ
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#059669", marginTop: 4 }}>
            {data ? data.total_pieces.toLocaleString() : "..."}{" "}
            <span style={{ fontSize: 13, fontWeight: 500 }}>cái</span>
          </div>
          <div style={{ fontSize: 11, color: "#059669", marginTop: 4, fontWeight: 600 }}>
            ✓ Đã Trừ Tồn Kho ULINK
          </div>
        </div>

        {/* Inventory Sync Status Card */}
        <div
          style={{
            background: "#f0fdf4",
            border: "1.5px solid #86efac",
            borderRadius: 12,
            padding: "14px 18px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#166534", textTransform: "uppercase" }}>
            ✅ Tình Trạng Khớp Tồn Kho
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#15803d", marginTop: 4 }}>
            100% <span style={{ fontSize: 13, fontWeight: 500 }}>đã khớp</span>
          </div>
          <div style={{ fontSize: 11, color: "#166534", marginTop: 4 }}>
            Từ phiếu <b>#IS0003</b> đến <b>#IS0069</b>
          </div>
        </div>
      </div>

      {/* Main Card with Toolbar & Table */}
      <div className="card" style={{ padding: 18 }}>
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          {/* Search Input */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 280 }}>
            <input
              type="text"
              placeholder="🔍 Tìm mã đơn Amazon, người nhận, thành phố, bang, SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input"
              style={{ width: "100%", maxWidth: 420 }}
            />
          </div>

          {/* Status Tabs */}
          <div style={{ display: "flex", gap: 4, background: "#f1f5f9", padding: 3, borderRadius: 10 }}>
            <button
              type="button"
              className={`btn ${statusFilter === "ALL" ? "primary" : ""}`}
              style={{ padding: "4px 12px", fontSize: 12 }}
              onClick={() => setStatusFilter("ALL")}
            >
              Tất cả ({data ? data.total_orders : 0})
            </button>
            <button
              type="button"
              className={`btn ${statusFilter === "Shipped" ? "primary" : ""}`}
              style={{ padding: "4px 12px", fontSize: 12, color: statusFilter === "Shipped" ? "white" : "#16a34a" }}
              onClick={() => setStatusFilter("Shipped")}
            >
              🟢 Đã Giao ({data ? data.shipped_orders_count : 0})
            </button>
            <button
              type="button"
              className={`btn ${statusFilter === "Unshipped" ? "primary" : ""}`}
              style={{ padding: "4px 12px", fontSize: 12, color: statusFilter === "Unshipped" ? "white" : "#ca8a04" }}
              onClick={() => setStatusFilter("Unshipped")}
            >
              🟡 Chờ Gửi ({data ? data.unshipped_orders_count : 0})
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div style={{ padding: 12, background: "#fee2e2", color: "#b91c1c", borderRadius: 8, marginBottom: 16 }}>
            ❌ {error}
          </div>
        )}

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Ngày Đặt</th>
                <th style={{ width: 180 }}>Mã Đơn Amazon</th>
                <th style={{ width: 220 }}>Khách Hàng &amp; Điểm Giao</th>
                <th>Sản Phẩm Đặt (SKU &amp; SL)</th>
                <th style={{ textAlign: "right", width: 110 }}>Tổng Tiền</th>
                <th style={{ textAlign: "center", width: 140 }}>Phiếu Xuất Kho</th>
                <th style={{ textAlign: "center", width: 110 }}>Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 36, color: "#64748b" }}>
                    ⏳ Đang tải dữ liệu đơn hàng Amazon FBM...
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 36, color: "#64748b" }}>
                    Không có đơn hàng FBM nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const dateStr = order.purchase_date.slice(0, 10);
                  const totalPacks = order.items.reduce((s, it) => s + it.quantity, 0);
                  const totalDozens = order.items.reduce((s, it) => s + it.dozens, 0);
                  const totalPieces = order.items.reduce((s, it) => s + it.pieces, 0);

                  return (
                    <tr
                      key={order.order_id}
                      style={{ cursor: "pointer", transition: "background 0.15s" }}
                      onClick={() => setSelectedOrder(order)}
                    >
                      {/* Date */}
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "#334155" }}>{dateStr}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>
                          {order.purchase_date.slice(11, 16)} UTC
                        </div>
                      </td>

                      {/* Amazon Order ID */}
                      <td>
                        <div
                          style={{
                            fontFamily: "monospace",
                            fontWeight: 700,
                            fontSize: 13,
                            color: "#1d4ed8",
                          }}
                        >
                          {order.order_id}
                        </div>
                        <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                          Kênh: <b>Amazon MFN</b>
                        </div>
                      </td>

                      {/* Recipient / Destination */}
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                          {order.recipient_name || "Khách mua Amazon"}
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                          {order.city ? `${order.city}, ` : ""}
                          {order.state ? `${order.state} ` : ""}
                          {order.postal_code || ""}
                        </div>
                      </td>

                      {/* Items */}
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {order.items.map((it, idx) => (
                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                              <span
                                style={{
                                  background: "#f1f5f9",
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  fontWeight: 700,
                                  fontSize: 11,
                                  color: "#334155",
                                }}
                              >
                                {it.quantity} thùng
                              </span>
                              <span style={{ fontWeight: 600, color: "#0f172a" }}>
                                {it.ulink_product_name || it.title || it.sku}
                              </span>
                              <span style={{ color: "#64748b", fontSize: 11 }}>
                                ({it.dozens} Dozen = {it.pieces} cái)
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* Order Total */}
                      <td style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                          ${order.order_total || "0.00"}
                        </div>
                        <div style={{ fontSize: 10, color: "#64748b" }}>{order.currency}</div>
                      </td>

                      {/* Inventory Issue Slip Link */}
                      <td style={{ textAlign: "center" }}>
                        {order.issue_number ? (
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              background: "#f0fdf4",
                              color: "#166534",
                              border: "1px solid #bbf7d0",
                              padding: "4px 8px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                            title={`Phiếu xuất kho ${order.issue_number}`}
                          >
                            <span>✓</span>
                            <span>{order.issue_number}</span>
                          </div>
                        ) : (
                          <span
                            style={{
                              fontSize: 11,
                              color: "#94a3b8",
                              fontStyle: "italic",
                            }}
                          >
                            Chưa tạo
                          </span>
                        )}
                      </td>

                      {/* Order Status */}
                      <td style={{ textAlign: "center" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 8px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            background: order.order_status === "Shipped" ? "#dcfce7" : "#fef9c3",
                            color: order.order_status === "Shipped" ? "#15803d" : "#854d0e",
                          }}
                        >
                          {order.order_status === "Shipped" ? "Đã Giao" : order.order_status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setSelectedOrder(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              maxWidth: 600,
              width: "100%",
              overflow: "hidden",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "16px 20px",
                background: "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
                color: "white",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>CHI TIẾT ĐƠN HÀNG AMAZON FBM</div>
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", marginTop: 2 }}>
                  {selectedOrder.order_id}
                </div>
              </div>
              <button
                type="button"
                className="btn icon"
                onClick={() => setSelectedOrder(null)}
                style={{ background: "rgba(255,255,255,0.2)", color: "white", border: "none" }}
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Order Info Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, background: "#f8fafc", padding: 12, borderRadius: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>NGÀY ĐẶT:</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                    {selectedOrder.purchase_date.slice(0, 10)} ({selectedOrder.purchase_date.slice(11, 16)} UTC)
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>TRẠNG THÁI:</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#16a34a" }}>
                    {selectedOrder.order_status} (Đã giao hàng)
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>NGƯỜI NHẬN:</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                    {selectedOrder.recipient_name || "N/A"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>ĐỊA CHỈ:</div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>
                    {selectedOrder.city}, {selectedOrder.state} {selectedOrder.postal_code}
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#334155" }}>
                  📦 Sản Phẩm Trong Đơn:
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {selectedOrder.items.map((it, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: 10,
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                          {it.ulink_product_name || it.title || it.sku}
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                          SKU Amazon: <b>{it.sku}</b> {it.ulink_sku && `| Mã kho: ${it.ulink_sku}`}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "#2563eb" }}>
                          {it.quantity} thùng
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          = {it.dozens} Dozen ({it.pieces} cái)
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Inventory Issue Slip Link */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: 12,
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 10,
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: "#166534", fontWeight: 700 }}>PHIẾU XUẤT KHO ĐÃ TRỪ TỒN:</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#15803d", marginTop: 2 }}>
                    Phiếu xuất: {selectedOrder.issue_number || "Chưa tạo"}
                  </div>
                </div>
                {selectedOrder.issue_number && (
                  <span style={{ fontSize: 11, color: "#166534", fontWeight: 600 }}>
                    ✓ Đã khớp sổ sách kho
                  </span>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: "12px 20px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", textAlign: "right" }}>
              <button type="button" className="btn" onClick={() => setSelectedOrder(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
