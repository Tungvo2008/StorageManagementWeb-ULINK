import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import { apiJson } from "./api/client";
import CustomersPage from "./pages/CustomersPage";
import CatalogPage from "./pages/CatalogPage";
import CustomerEditPage from "./pages/CustomerEditPage";
import InventoryIssuePage from "./pages/InventoryIssuePage";
import InventoryLogPage from "./pages/InventoryLogPage";
import InventoryReceivePage from "./pages/InventoryReceivePage";
import InventoryStockPage from "./pages/InventoryStockPage";
import InventorySummaryPage from "./pages/InventorySummaryPage";
import InvoicesPage from "./pages/InvoicesPage";
import LoginPage from "./pages/LoginPage";
import PricingPage from "./pages/PricingPage";
import ProductImagesPage from "./pages/ProductImagesPage";
import WebsiteContentPage from "./pages/WebsiteContentPage";
import ProductsPage from "./pages/ProductsPage";
import SalesPage from "./pages/SalesPage";
import UsersPage from "./pages/UsersPage";
import { clearToken, getToken } from "./auth";
import AmazonShipmentPage from "./pages/AmazonShipmentPage";
import GroceryPage from "./pages/GroceryPage";
import TrustCargoPage from "./pages/TrustCargoPage";
import BotLogPage from "./pages/BotLogPage";
import QuotesPage from "./pages/QuotesPage";
import ShowcasePage from "./pages/ShowcasePage";
import InventoryBatchesPage from "./pages/InventoryBatchesPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = getToken();
  const location = useLocation();
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      if (!token) {
        clearToken();
        if (!cancelled) setVerified(false);
        return;
      }

      try {
        await apiJson("/api/v1/auth/me");
        if (!cancelled) setVerified(true);
      } catch {
        clearToken();
        if (!cancelled) setVerified(false);
      }
    }

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (verified === null) {
    return (
      <div className="card" style={{ maxWidth: 420 }}>
        Checking session...
      </div>
    );
  }

  if (!verified) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/quotes" element={<RequireAuth><QuotesPage /></RequireAuth>} />
        <Route path="/showcase" element={<RequireAuth><ShowcasePage /></RequireAuth>} />
        <Route path="/" element={<Navigate to="/products" replace />} />
        <Route
          path="/products"
          element={
            <RequireAuth>
              <ProductsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/products/images"
          element={
            <RequireAuth>
              <ProductImagesPage />
            </RequireAuth>
          }
        />
        <Route path="/towel-web" element={<Navigate to="/website-content" replace />} />
        <Route path="/website-content" element={<RequireAuth><WebsiteContentPage /></RequireAuth>} />
        <Route
          path="/catalog"
          element={
            <RequireAuth>
              <CatalogPage />
            </RequireAuth>
          }
        />
        <Route
          path="/amazon-shipment"
          element={
            <RequireAuth>
              <AmazonShipmentPage />
            </RequireAuth>
          }
        />
        <Route
          path="/customers"
          element={
            <RequireAuth>
              <CustomersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/customers/:id/edit"
          element={
            <RequireAuth>
              <CustomerEditPage />
            </RequireAuth>
          }
        />
        <Route
          path="/pricing"
          element={
            <RequireAuth>
              <PricingPage />
            </RequireAuth>
          }
        />
        <Route
          path="/users"
          element={
            <RequireAuth>
              <UsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/inventory"
          element={
            <RequireAuth>
              <ProductsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/inventory/summary"
          element={
            <RequireAuth>
              <InventorySummaryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/batches"
          element={
            <RequireAuth>
              <InventoryBatchesPage />
            </RequireAuth>
          }
        />
        <Route path="/inventory/batches" element={<Navigate to="/batches" replace />} />
        <Route
          path="/receipts"
          element={
            <RequireAuth>
              <InventoryReceivePage />
            </RequireAuth>
          }
        />
        <Route
          path="/stock-history"
          element={
            <RequireAuth>
              <InventoryLogPage />
            </RequireAuth>
          }
        />
        <Route path="/inventory/receive" element={<Navigate to="/receipts" replace />} />
        <Route path="/inventory/receipt-log" element={<Navigate to="/receipts" replace />} />
        <Route path="/inventory/log" element={<Navigate to="/stock-history" replace />} />
        <Route
          path="/inventory/issue"
          element={
            <RequireAuth>
              <InventoryIssuePage />
            </RequireAuth>
          }
        />
        <Route path="/sales" element={<Navigate to="/issue" replace />} />
        <Route
          path="/issue"
          element={
            <RequireAuth>
              <SalesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/invoices"
          element={
            <RequireAuth>
              <InvoicesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/grocery"
          element={
            <RequireAuth>
              <GroceryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/trust-cargo"
          element={
            <RequireAuth>
              <TrustCargoPage />
            </RequireAuth>
          }
        />
        <Route
          path="/bot-logs"
          element={
            <RequireAuth>
              <BotLogPage />
            </RequireAuth>
          }
        />
      </Routes>
    </Layout>
  );
}
