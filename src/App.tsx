import { lazy, Suspense } from "react";
import { Navigate, Route, HashRouter, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { AuthProvider, useAuth } from "./lib/authContext";
import ChangePassword from "./pages/ChangePassword";
import CreditMemoDetail from "./pages/CreditMemoDetail";
import InvoiceDetail from "./pages/InvoiceDetail";
import Invoices from "./pages/Invoices";

// The change-password screen sits outside the Layout (no navigation to
// wander off into while a change is required) but still needs a session.
function ChangePasswordGate() {
  const { account, loading } = useAuth();
  if (loading) return null;
  if (!account) return <Navigate to="/login" replace />;
  return <ChangePassword />;
}
import Accounts from "./pages/Accounts";
import Allocation from "./pages/Allocation";
import AllocationDecision from "./pages/AllocationDecision";
import AuditLog from "./pages/AuditLog";
import BackOrderQueue from "./pages/BackOrderQueue";
import CustomerForm from "./pages/CustomerForm";
import Customers from "./pages/Customers";
import CustomerPricing from "./pages/CustomerPricing";
import CustomersHub from "./pages/CustomersHub";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import InventoryAdjust from "./pages/InventoryAdjust";
import ItemForm from "./pages/ItemForm";
import ItemProfile from "./pages/ItemProfile";
import ItemQuickReport from "./pages/ItemQuickReport";
import Items from "./pages/Items";
import Login from "./pages/Login";
import OpenPicks from "./pages/OpenPicks";
import OpenPicksDetail from "./pages/OpenPicksDetail";
import Dock from "./pages/Dock";
import DockPick from "./pages/DockPick";
import OrderDetail from "./pages/OrderDetail";
import OrderEntry from "./pages/OrderEntry";
import Preferences from "./pages/Preferences";
import OrdersList from "./pages/OrdersList";
import PickPack from "./pages/PickPack";
import PickPackDetail from "./pages/PickPackDetail";
import PurchaseOrderDetail from "./pages/PurchaseOrderDetail";
import PurchaseOrderForm from "./pages/PurchaseOrderForm";
import PurchaseOrders from "./pages/PurchaseOrders";
import Receiving from "./pages/Receiving";
import ReturnDetail from "./pages/ReturnDetail";
import ReturnForm from "./pages/ReturnForm";
import Returns from "./pages/Returns";
import RoutingGuide from "./pages/RoutingGuide";
import RoutingGuideDetail from "./pages/RoutingGuideDetail";
import ScheduleShipments from "./pages/ScheduleShipments";
import Settings from "./pages/Settings";
import ShipmentHistory from "./pages/ShipmentHistory";
import Validation from "./pages/Validation";
import ValidationDecision from "./pages/ValidationDecision";
import Vendors from "./pages/Vendors";
import WarehouseCapacity from "./pages/WarehouseCapacity";

// Pages with heavy, rarely-used code (charts, CSV parsing, the BOL and
// label layouts) load on first visit rather than in the main bundle (D-12).
const Analytics = lazy(() => import("./pages/Analytics"));
const GenerateBOL = lazy(() => import("./pages/GenerateBOL"));
const Import = lazy(() => import("./pages/Import"));
const LabelsHome = lazy(() => import("./pages/LabelsHome"));
const ProductLabels = lazy(() => import("./pages/ProductLabels"));
const ReportRunner = lazy(() => import("./pages/ReportRunner"));
const Reports = lazy(() => import("./pages/Reports"));
const ShippingLabelCreate = lazy(() => import("./pages/ShippingLabelCreate"));

function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Suspense fallback={<div className="page"><p className="muted">Loading…</p></div>}>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route path="change-password" element={<ChangePasswordGate />} />
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="order-entry" element={<OrderEntry />} />
            <Route path="open-orders" element={<OrdersList closed={false} />} />
            <Route path="closed-orders" element={<OrdersList closed={true} />} />
            <Route path="storage/:soNumber" element={<OrderDetail />} />
            <Route path="customers" element={<CustomersHub />} />
            <Route path="customers/new" element={<CustomerForm />} />
            <Route path="customers/all" element={<Customers />} />
            <Route path="customers/all/:id" element={<Customers />} />
            <Route path="customers/pricing" element={<CustomerPricing />} />
            <Route path="customers/routing-guide" element={<RoutingGuide />} />
            <Route path="customers/routing-guide/:id" element={<RoutingGuideDetail />} />
            <Route path="items" element={<Items />} />
            <Route path="items/new" element={<ItemForm />} />
            <Route path="items/:id" element={<ItemProfile />} />
            <Route path="items/:id/quick-report" element={<ItemQuickReport />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="inventory/adjust" element={<InventoryAdjust />} />
            <Route path="validation" element={<Validation />} />
            <Route path="validation/:soNumber" element={<ValidationDecision />} />
            <Route path="allocation" element={<Allocation />} />
            <Route path="allocation/:soNumber" element={<AllocationDecision />} />
            <Route path="back-orders" element={<BackOrderQueue />} />
            <Route path="labels" element={<LabelsHome />} />
            <Route path="labels/shipping" element={<ShippingLabelCreate />} />
            <Route path="labels/product" element={<ProductLabels />} />
            <Route path="pick-pack" element={<PickPack />} />
            <Route path="pick-pack/:soNumber" element={<PickPackDetail />} />
            <Route path="open-picks" element={<OpenPicks />} />
            <Route path="open-picks/:soNumber" element={<OpenPicksDetail />} />
            <Route path="dock" element={<Dock />} />
            <Route path="dock/:soNumber" element={<DockPick />} />
            <Route path="warehouse-capacity" element={<WarehouseCapacity />} />
            <Route path="schedule" element={<ScheduleShipments />} />
            <Route path="shipment-history" element={<ShipmentHistory />} />
            <Route path="import" element={<Import />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="settings" element={<Settings />} />
            <Route path="audit-log" element={<AuditLog />} />
            <Route path="preferences" element={<Preferences />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="bol" element={<GenerateBOL />} />
            <Route path="vendors" element={<Vendors />} />
            <Route path="purchase-orders" element={<PurchaseOrders />} />
            <Route path="purchase-orders/new" element={<PurchaseOrderForm />} />
            <Route path="purchase-orders/:poNumber" element={<PurchaseOrderDetail />} />
            <Route path="receiving" element={<Receiving />} />
            <Route path="returns" element={<Returns />} />
            <Route path="returns/new" element={<ReturnForm />} />
            <Route path="returns/:raNumber" element={<ReturnDetail />} />
            <Route path="reports" element={<Reports />} />
            <Route path="reports/new" element={<ReportRunner />} />
            <Route path="reports/preset/:presetKey" element={<ReportRunner />} />
            <Route path="reports/saved/:savedId" element={<ReportRunner />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="invoices/credit-memos/:number" element={<CreditMemoDetail />} />
            <Route path="invoices/:invoiceNumber" element={<InvoiceDetail />} />
          </Route>
        </Routes>
        </Suspense>
      </HashRouter>
    </AuthProvider>
  );
}

export default App;
