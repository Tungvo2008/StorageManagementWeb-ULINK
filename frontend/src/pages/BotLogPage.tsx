import { useEffect, useState, useMemo, useRef } from "react";
import { apiJson } from "../api/client";

interface BotLog {
  id: number;
  sender: string;
  channel: string;
  user_query: string;
  bot_response: string;
  tools_called?: string | null;
  status: string; // "SUCCESS" | "RUNNING" | "ERROR"
  created_at: string;
  updated_at: string;
}

export default function BotLogPage() {
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<any>(null);

  const fetchLogs = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await apiJson<BotLog[]>("/api/v1/bot-logs?limit=100");
      setLogs(data);
    } catch (err: any) {
      if (!silent) setError(err?.message || "Không thể tải nhật ký Bot");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => {
        fetchLogs(true);
      }, 3000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh]);

  const activeRunningLogs = useMemo(() => {
    return logs.filter((l) => l.status === "RUNNING");
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      const matchSearch =
        !searchTerm.trim() ||
        l.user_query.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.bot_response.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.sender.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (l.tools_called && l.tools_called.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchStatus =
        statusFilter === "ALL" ||
        l.status.toUpperCase() === statusFilter.toUpperCase();

      return matchSearch && matchStatus;
    });
  }, [logs, searchTerm, statusFilter]);

  const handleDelete = async (id: number) => {
    if (!confirm("Bạn có chắc muốn xóa bản ghi nhật ký này?")) return;
    try {
      await apiJson(`/api/v1/bot-logs/${id}`, { method: "DELETE" });
      setLogs((prev) => prev.filter((item) => item.id !== id));
    } catch (err: any) {
      alert(err?.message || "Không thể xóa");
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>
      {/* Top Header & Status */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 20,
          borderBottom: "1px solid #e2e8f0",
          paddingBottom: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1e293b", margin: 0 }}>
              🤖 Dashboard Theo Dõi Bot (Live Monitor)
            </h1>
            {activeRunningLogs.length > 0 ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 16,
                  backgroundColor: "#dbeafe",
                  color: "#1d4ed8",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: "#2563eb",
                  }}
                />
                ĐANG CHẠY ({activeRunningLogs.length})
              </span>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 16,
                  backgroundColor: "#dcfce7",
                  color: "#15803d",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: "#16a34a",
                  }}
                />
                SẴN SÀNG
              </span>
            )}
          </div>
          <p style={{ color: "#64748b", margin: "6px 0 0 0", fontSize: 13 }}>
            Cập nhật theo thời gian thực tiến độ xử lý, các công cụ bot đang gọi và phản hồi từ Telegram / Zalo.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Auto Refresh Toggle */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "#475569",
              cursor: "pointer",
              background: "#f1f5f9",
              padding: "6px 12px",
              borderRadius: 8,
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <span>Tự động cập nhật (3s)</span>
          </label>

          <button
            onClick={() => fetchLogs()}
            disabled={loading}
            style={{
              padding: "8px 14px",
              backgroundColor: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            🔄 {loading ? "Đang tải..." : "Làm mới"}
          </button>
        </div>
      </div>

      {/* LIVE PROGRESS BANNER (Khi có tác vụ đang chạy) */}
      {activeRunningLogs.map((activeLog) => (
        <div
          key={`running-${activeLog.id}`}
          style={{
            backgroundColor: "#eff6ff",
            border: "2px solid #3b82f6",
            borderRadius: 12,
            padding: "16px 20px",
            marginBottom: 24,
            boxShadow: "0 4px 14px rgba(59, 130, 246, 0.15)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 20 }}>⚡</span>
              <span style={{ fontWeight: 700, color: "#1d4ed8", fontSize: 15, textTransform: "uppercase" }}>
                Tác Vụ Đang Thực Hiện Trực Tiếp (Live Progress)
              </span>
            </div>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              Bắt đầu lúc: {new Date(activeLog.created_at).toLocaleTimeString("vi-VN")}
            </span>
          </div>

          <div style={{ margin: "8px 0", color: "#1e293b", fontSize: 14 }}>
            <strong>Yêu cầu:</strong> <span style={{ color: "#0f172a" }}>{activeLog.user_query}</span>
          </div>

          <div
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #bfdbfe",
              borderRadius: 8,
              padding: "12px 14px",
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 18 }}>🔄</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#2563eb", textTransform: "uppercase" }}>
                Bước hiện tại của Bot:
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1e3a8a", marginTop: 2 }}>
                {activeLog.tools_called || activeLog.bot_response || "Đang phân tích dữ liệu..."}
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Filter & Search Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 10, flex: 1, minWidth: 280 }}>
          <input
            type="text"
            placeholder="🔍 Tìm kiếm câu hỏi, câu trả lời, công cụ..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              flex: 1,
              maxWidth: 400,
              padding: "8px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              fontSize: 14,
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#64748b" }}>Trạng thái:</span>
          {(["ALL", "RUNNING", "SUCCESS", "ERROR"] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                backgroundColor: statusFilter === st ? "#1e293b" : "#f1f5f9",
                color: statusFilter === st ? "#ffffff" : "#475569",
              }}
            >
              {st === "ALL" && "Tất cả"}
              {st === "RUNNING" && "⏳ Đang chạy"}
              {st === "SUCCESS" && "✅ Thành công"}
              {st === "ERROR" && "❌ Lỗi"}
            </button>
          ))}
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div style={{ padding: 14, backgroundColor: "#fee2e2", color: "#b91c1c", borderRadius: 8, marginBottom: 20 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredLogs.length === 0 && (
        <div style={{ padding: 50, textAlign: "center", backgroundColor: "#f8fafc", borderRadius: 12, border: "1px dashed #cbd5e1" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>💬</div>
          <div style={{ fontWeight: 600, color: "#334155", fontSize: 16 }}>Chưa có nhật ký hoạt động nào</div>
          <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
            Khi bạn tương tác với Bot qua Telegram hoặc Zalo, toàn bộ trạng thái thực thi sẽ hiển thị ngay tại đây.
          </div>
        </div>
      )}

      {/* Timeline List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {filteredLogs.map((log) => {
          const timeFormatted = new Date(log.created_at).toLocaleString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });

          const isRunning = log.status === "RUNNING";
          const isSuccess = log.status === "SUCCESS";

          return (
            <div
              key={log.id}
              style={{
                backgroundColor: "#ffffff",
                borderRadius: 12,
                border: isRunning ? "2px solid #3b82f6" : "1px solid #e2e8f0",
                boxShadow: isRunning ? "0 4px 12px rgba(59,130,246,0.12)" : "0 1px 3px rgba(0,0,0,0.05)",
                overflow: "hidden",
              }}
            >
              {/* Card Meta Bar */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 16px",
                  backgroundColor: isRunning ? "#f0f7ff" : "#f8fafc",
                  borderBottom: "1px solid #f1f5f9",
                  fontSize: 13,
                  color: "#64748b",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      borderRadius: 12,
                      backgroundColor: log.channel === "zalo" ? "#dbeafe" : "#e0f2fe",
                      color: log.channel === "zalo" ? "#1e40af" : "#0369a1",
                      fontWeight: 600,
                      fontSize: 11,
                    }}
                  >
                    {log.channel === "zalo" ? "💬 ZALO" : "✈️ TELEGRAM"}
                  </span>
                  <span style={{ fontWeight: 600, color: "#334155" }}>{log.sender}</span>
                  <span>•</span>
                  <span>{timeFormatted}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 6,
                      backgroundColor: isRunning ? "#dbeafe" : isSuccess ? "#dcfce7" : "#fee2e2",
                      color: isRunning ? "#1d4ed8" : isSuccess ? "#16a34a" : "#dc2626",
                    }}
                  >
                    {isRunning && "⏳ Đang chạy..."}
                    {isSuccess && "✅ Hoàn tất"}
                    {!isRunning && !isSuccess && "❌ Lỗi"}
                  </span>
                  <button
                    onClick={() => handleDelete(log.id)}
                    title="Xóa nhật ký này"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#94a3b8",
                      fontSize: 14,
                      padding: "2px 4px",
                    }}
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {/* Chat Dialogue Area */}
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                {/* User Prompt */}
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      backgroundColor: "#e2e8f0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 16,
                      flexShrink: 0,
                    }}
                  >
                    👤
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 3 }}>
                      YÊU CẦU CỦA BẠN
                    </div>
                    <div
                      style={{
                        backgroundColor: "#f1f5f9",
                        padding: "10px 14px",
                        borderRadius: "4px 12px 12px 12px",
                        color: "#0f172a",
                        fontSize: 14,
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {log.user_query}
                    </div>
                  </div>
                </div>

                {/* Tool calls indicator (if any) */}
                {log.tools_called && (
                  <div style={{ margin: "2px 0 2px 44px" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        backgroundColor: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 12,
                        color: "#475569",
                        fontFamily: "monospace",
                      }}
                    >
                      <span>🔧 Công cụ / Bước:</span>
                      <strong style={{ color: "#2563eb" }}>{log.tools_called}</strong>
                    </span>
                  </div>
                )}

                {/* AI Assistant Response */}
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      backgroundColor: isRunning ? "#dbeafe" : "#e0e7ff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 16,
                      flexShrink: 0,
                    }}
                  >
                    {isRunning ? "⏳" : "🤖"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: isRunning ? "#2563eb" : "#4338ca", marginBottom: 3 }}>
                      {isRunning ? "ANTIGRAVITY AGENT ĐANG XỬ LÝ..." : "ANTIGRAVITY AGENT PHẢN HỒI"}
                    </div>
                    <div
                      style={{
                        backgroundColor: isRunning ? "#eff6ff" : "#f8fafd",
                        border: isRunning ? "1px solid #bfdbfe" : "1px solid #e0e7ff",
                        padding: "12px 16px",
                        borderRadius: "4px 12px 12px 12px",
                        color: "#1e1b4b",
                        fontSize: 14,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {log.bot_response}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
