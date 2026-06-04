import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import CustomersPage from "./pages/CustomersPage";
import CustomerEditPage from "./pages/CustomerEditPage";
import InventoryIssuePage from "./pages/InventoryIssuePage";
import InventoryLogPage from "./pages/InventoryLogPage";
import InventoryReceivePage from "./pages/InventoryReceivePage";
import InventorySummaryPage from "./pages/InventorySummaryPage";
import InvoicesPage from "./pages/InvoicesPage";
import LoginPage from "./pages/LoginPage";
import PricingPage from "./pages/PricingPage";
import ProductsPage from "./pages/ProductsPage";
import SalesPage from "./pages/SalesPage";
import UsersPage from "./pages/UsersPage";
import { getToken } from "./auth";

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = getToken();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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
              <InventorySummaryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/inventory/receive"
          element={<Navigate to="/inventory/receipt-log" replace />}
        />
        <Route
          path="/inventory/receipt-log"
          element={
            <RequireAuth>
              <InventoryReceivePage />
            </RequireAuth>
          }
        />
        <Route
          path="/inventory/issue"
          element={
            <RequireAuth>
              <InventoryIssuePage />
            </RequireAuth>
          }
        />
        <Route
          path="/inventory/log"
          element={
            <RequireAuth>
              <InventoryLogPage />
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
      </Routes>
    </Layout>
  );
}
