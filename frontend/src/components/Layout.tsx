import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { clearToken, getCurrentUsername, getToken } from "../auth";
import BrandLogo from "./BrandLogo";

const APP_NAME = "ULINK LLC";
const APP_VERSION = import.meta.env.VITE_APP_VERSION?.trim() || "dev";

function pageTitle(pathname: string): string {
  if (pathname === "/login") return "Login";
  if (pathname === "/products") return "Products";
  if (pathname === "/customers") return "Customers";
  if (pathname.startsWith("/customers/") && pathname.endsWith("/edit")) return "Edit Customer";
  if (pathname === "/pricing") return "Pricing";
  if (pathname === "/users") return "Users";
  if (pathname === "/inventory") return "Inventory";
  if (pathname === "/inventory/receipt-log") return "Receipt Log";
  if (pathname === "/inventory/issue") return "Issue Log";
  if (pathname === "/inventory/log") return "Stock Movements";
  if (pathname === "/issue") return "Create Issue";
  if (pathname === "/invoices") return "Invoices";
  return "Storage Management";
}

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const inventoryActive = location.pathname.startsWith("/inventory");
  const authed = Boolean(getToken());
  const currentUsername = getCurrentUsername();
  useEffect(() => {
    document.title = `${pageTitle(location.pathname)} | ${APP_NAME}`;
  }, [location.pathname]);
  return (
    <>
      <div className="nav">
        <div className="nav-inner">
          <div className="brand">
            <BrandLogo size={34} />
            <div className="brand-text">
              <div className="brand-name">ULINK LLC</div>
              <div className="brand-sub">Storage</div>
            </div>
          </div>
          {authed ? (
            <div className="nav-links">
              <NavLink to="/products" className={({ isActive }) => (isActive ? "active" : "")}>
                Products
              </NavLink>
              <NavLink to="/customers" className={({ isActive }) => (isActive ? "active" : "")}>
                Customers
              </NavLink>
              <NavLink to="/pricing" className={({ isActive }) => (isActive ? "active" : "")}>
                Pricing
              </NavLink>
              <NavLink to="/users" className={({ isActive }) => (isActive ? "active" : "")}>
                Users
              </NavLink>
              <NavLink to="/inventory" className={() => (inventoryActive ? "active" : "")}>
                Inventory
              </NavLink>
              <NavLink to="/issue" className={({ isActive }) => (isActive ? "active" : "")}>
                Issue
              </NavLink>
              <NavLink to="/invoices" className={({ isActive }) => (isActive ? "active" : "")}>
                Invoices
              </NavLink>
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
