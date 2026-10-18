import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { clearToken, getCurrentUsername, getToken } from "../auth";
import BrandLogo from "./BrandLogo";

const APP_NAME = "ULINK Storage";
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "1.0.0";

function pageTitle(pathname: string): string {
  if (pathname === "/batches" || pathname === "/inventory/batches") return "Quản Lý Lô & Date";
  if (pathname === "/products" || pathname === "/inventory") return "Sản Phẩm & Tồn Kho";
  if (pathname === "/inventory/summary") return "Báo Cáo Nhập Tồn";
  if (pathname === "/receipts") return "Nhập Kho";
  if (pathname === "/issue") return "Xuất Kho";
  if (pathname === "/stock-history") return "Lịch Sử Kho";
  if (pathname === "/invoices") return "Hóa Đơn";
  if (pathname === "/quotes") return "Báo Giá";
  if (pathname === "/showcase") return "Sản Phẩm Showcase";
  if (pathname === "/trust-cargo") return "Trust Cargo";
  if (pathname === "/bot-logs") return "Bot Monitor";
  if (pathname === "/grocery") return "Bách Hóa";
  if (pathname === "/amazon-shipment") return "Amazon FBA";
  if (pathname === "/products/images") return "Hình Ảnh";
  if (pathname === "/website-content" || pathname === "/towel-web") return "Nội Dung Website";
  if (pathname === "/catalog") return "Catalog";
  if (pathname === "/customers") return "Khách Hàng";
  if (pathname === "/pricing") return "Bảng Giá";
  if (pathname === "/users") return "Người Dùng";
  return "Hệ Thống";
}

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const authed = Boolean(getToken());
  const currentUsername = getCurrentUsername();

  const [opsMenuOpen, setOpsMenuOpen] = useState(false);
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);

  const opsRef = useRef<HTMLDivElement>(null);
  const systemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = `${pageTitle(location.pathname)} | ${APP_NAME}`;
    setOpsMenuOpen(false);
    setSystemMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (opsRef.current && !opsRef.current.contains(event.target as Node)) {
        setOpsMenuOpen(false);
      }
      if (systemRef.current && !systemRef.current.contains(event.target as Node)) {
        setSystemMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isProductsActive = ["/products", "/inventory"].some(
    (p) => location.pathname === p || location.pathname.startsWith(p + "/")
  );

  const isOpsActive = ["/receipts", "/batches", "/inventory/batches", "/issue", "/stock-history", "/inventory/summary"].some(
    (p) => location.pathname === p || location.pathname.startsWith(p + "/")
  );

  const isAmazonActive = location.pathname.startsWith("/amazon-shipment");

  const isSystemActive = [
    "/customers",
    "/pricing",
    "/users",
    "/products/images",
    "/towel-web",
    "/website-content",
    "/catalog",
    "/showcase",
  ].some((p) => location.pathname === p || location.pathname.startsWith(p + "/"));

  return (
    <>
      <div className="nav">
        <div className="nav-inner">
          <div className="brand" style={{ cursor: "pointer" }} onClick={() => navigate("/")}>
            <BrandLogo size={34} />
            <div className="brand-text">
              <div className="brand-name">ULINK LLC</div>
              <div className="brand-sub">Storage</div>
            </div>
          </div>

          {authed ? (
            <div className="nav-links" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {/* 1. Trust Cargo */}
              <NavLink
                to="/trust-cargo"
                style={{
                  padding: "7px 12px",
                  fontWeight: 600,
                  fontSize: 13,
                  borderRadius: 8,
                  background: location.pathname === "/trust-cargo" ? "#1e3a8a" : "#eff6ff",
                  color: location.pathname === "/trust-cargo" ? "white" : "#1d4ed8",
                  border: "1px solid #bfdbfe",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  textDecoration: "none",
                }}
              >
                <span>📦</span> Trust Cargo
              </NavLink>

              {/* 2. Sản Phẩm & Tồn Kho (Trang gộp thống nhất theo chuẩn Shopify) */}
              <NavLink
                to="/products"
                style={{
                  padding: "7px 12px",
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  textDecoration: "none",
                  border: isProductsActive ? "1px solid #0f172a" : "1px solid transparent",
                  background: isProductsActive ? "#0f172a" : "transparent",
                  color: isProductsActive ? "white" : "#334155",
                  transition: "all 0.15s ease",
                }}
              >
                <span>⚡</span> Sản Phẩm & Tồn Kho
              </NavLink>

              {/* 3. Nhập / Xuất Kho (Dropdown gọn gàng) */}
              <div ref={opsRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => {
                    setOpsMenuOpen(!opsMenuOpen);
                    setSystemMenuOpen(false);
                  }}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                    border: isOpsActive ? "1px solid #bfdbfe" : "1px solid transparent",
                    background: isOpsActive ? "#eff6ff" : "transparent",
                    color: isOpsActive ? "#1e40af" : "#334155",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span>📋</span> Nhập / Xuất Kho
                  <span style={{ fontSize: 9, opacity: 0.7 }}>{opsMenuOpen ? "▲" : "▼"}</span>
                </button>

                {opsMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      left: 0,
                      background: "white",
                      minWidth: 210,
                      borderRadius: 10,
                      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                      border: "1px solid #e2e8f0",
                      padding: "6px 0",
                      zIndex: 100,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <NavLink to="/receipts" style={{ padding: "8px 14px", fontSize: 13, color: "#1e293b", fontWeight: 500 }}>
                      📥 Nhập Kho (Cont/Lô/Xá)
                    </NavLink>
                    <NavLink to="/batches" style={{ padding: "8px 14px", fontSize: 13, color: "#0f766e", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                      🏷️ Quản Lý Lô & Date
                    </NavLink>
                    <NavLink to="/issue" style={{ padding: "8px 14px", fontSize: 13, color: "#1e293b", fontWeight: 500 }}>
                      📤 Xuất Kho Vật Lý
                    </NavLink>
                    <NavLink to="/stock-history" style={{ padding: "8px 14px", fontSize: 13, color: "#1e293b", fontWeight: 500 }}>
                      📜 Sổ Cái Biến Động
                    </NavLink>
                    <div style={{ margin: "4px 0", borderTop: "1px solid #f1f5f9" }} />
                    <NavLink to="/inventory/summary" style={{ padding: "8px 14px", fontSize: 13, color: "#64748b" }}>
                      📊 Báo Cáo Nhập Tồn
                    </NavLink>
                  </div>
                )}
              </div>

              {/* 4. Hóa Đơn */}
              <NavLink
                to="/invoices"
                style={{
                  padding: "7px 12px",
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  textDecoration: "none",
                  border: location.pathname.startsWith("/invoices") ? "1px solid #cbd5e1" : "1px solid transparent",
                  background: location.pathname.startsWith("/invoices") ? "#f1f5f9" : "transparent",
                  color: location.pathname.startsWith("/invoices") ? "#0f172a" : "#334155",
                }}
              >
                <span>🧾</span> Hóa Đơn
              </NavLink>

              <NavLink to="/quotes" style={{ padding: "7px 12px", fontWeight: 600, fontSize: 13, borderRadius: 8, textDecoration: "none", color: location.pathname === "/quotes" ? "white" : "#17365b", background: location.pathname === "/quotes" ? "#17365b" : "#e8f1f8" }}>📄 Báo Giá</NavLink>

              {/* 5. Bách Hóa */}
              <NavLink
                to="/grocery"
                style={{
                  padding: "7px 12px",
                  borderRadius: 8,
                  fontWeight: 500,
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  textDecoration: "none",
                  border: location.pathname === "/grocery" ? "1px solid #e2e8f0" : "1px solid transparent",
                  background: location.pathname === "/grocery" ? "#f8fafc" : "transparent",
                  color: location.pathname === "/grocery" ? "#0f172a" : "#334155",
                }}
              >
                <span>🍿</span> Bách Hóa
              </NavLink>

              {/* 6. Amazon FBA */}
              <NavLink
                to="/amazon-shipment"
                style={{
                  padding: "7px 12px",
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  textDecoration: "none",
                  border: isAmazonActive ? "1px solid #ea580c" : "1px solid #fed7aa",
                  background: isAmazonActive ? "#ea580c" : "#fff7ed",
                  color: isAmazonActive ? "white" : "#c2410c",
                  transition: "all 0.15s ease",
                }}
              >
                <span>📦</span> Amazon FBA
              </NavLink>

              {/* 7. Hệ Thống (Gom toàn bộ các công cụ phụ) */}
              <div ref={systemRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => {
                    setSystemMenuOpen(!systemMenuOpen);
                    setOpsMenuOpen(false);
                  }}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 8,
                    fontWeight: 500,
                    fontSize: 13,
                    cursor: "pointer",
                    border: isSystemActive ? "1px solid #e2e8f0" : "1px solid transparent",
                    background: isSystemActive ? "#f8fafc" : "transparent",
                    color: isSystemActive ? "#0f172a" : "#334155",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span>⚙️</span> Hệ Thống
                  <span style={{ fontSize: 9, opacity: 0.7 }}>{systemMenuOpen ? "▲" : "▼"}</span>
                </button>

                {systemMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      background: "white",
                      minWidth: 200,
                      borderRadius: 10,
                      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                      border: "1px solid #e2e8f0",
                      padding: "6px 0",
                      zIndex: 100,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <NavLink to="/customers" style={{ padding: "8px 14px", fontSize: 13, color: "#1e293b" }}>
                      👥 Khách Hàng
                    </NavLink>
                    <NavLink to="/pricing" style={{ padding: "8px 14px", fontSize: 13, color: "#1e293b" }}>
                      💲 Bảng Giá Chợ
                    </NavLink>
                    <NavLink to="/users" style={{ padding: "8px 14px", fontSize: 13, color: "#1e293b" }}>
                      👤 Phân Quyền
                    </NavLink>
                    <div style={{ margin: "4px 0", borderTop: "1px solid #f1f5f9" }} />
                    <NavLink to="/products/images" style={{ padding: "8px 14px", fontSize: 13, color: "#64748b" }}>
                      🖼️ Thư Viện Ảnh SP
                    </NavLink>
                    <NavLink to="/website-content" style={{ padding: "8px 14px", fontSize: 13, color: "#1e293b" }}>
                      🌐 Nội dung website
                    </NavLink>
                    <NavLink to="/showcase" style={{ padding: "8px 14px", fontSize: 13, color: "#1e293b" }}>
                      🛍️ Sản phẩm Showcase
                    </NavLink>
                    <NavLink to="/catalog" style={{ padding: "8px 14px", fontSize: 13, color: "#64748b" }}>
                      📖 Product Catalog PDF
                    </NavLink>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="nav-links">
              <NavLink to="/login" className={({ isActive }) => (isActive ? "active" : "")}>
                Login
              </NavLink>
            </div>
          )}

          <div className="nav-actions muted">
            {authed ? (
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <span className="versionPill" title="App version">
                  v{APP_VERSION}
                </span>
                {currentUsername ? <span className="muted">Hi, {currentUsername}</span> : null}
                <button
                  className="btn"
                  onClick={() => {
                    clearToken();
                    navigate("/login", { replace: true });
                  }}
                >
                  Logout
                </button>
              </div>
            ) : (
              <span className="versionPill" title="App version">
                v{APP_VERSION}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="container">{children}</div>
    </>
  );
}
