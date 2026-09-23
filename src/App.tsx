import { Route, HashRouter, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { AuthProvider } from "./lib/authContext";
import Accounts from "./pages/Accounts";
import Allocation from "./pages/Allocation";
import AllocationDecision from "./pages/AllocationDecision";
import Analytics from "./pages/Analytics";
import BackOrderQueue from "./pages/BackOrderQueue";
import CustomerForm from "./pages/CustomerForm";
import Customers from "./pages/Customers";
import CustomerPricing from "./pages/CustomerPricing";
import CustomersHub from "./pages/CustomersHub";
import Dashboard from "./pages/Dashboard";
import GenerateBOL from "./pages/GenerateBOL";
import Import from "./pages/Import";
import Inventory from "./pages/Inventory";
import InventoryAdjust from "./pages/InventoryAdjust";
import ItemForm from "./pages/ItemForm";
import ItemProfile from "./pages/ItemProfile";
import ItemQuickReport from "./pages/ItemQuickReport";
import Items from "./pages/Items";
import LabelsHome from "./pages/LabelsHome";
import Login from "./pages/Login";
import OpenPicks from "./pages/OpenPicks";
import OpenPicksDetail from "./pages/OpenPicksDetail";
import OrderDetail from "./pages/OrderDetail";
import OrderEntry from "./pages/OrderEntry";
import OrdersList from "./pages/OrdersList";
import PickPack from "./pages/PickPack";
import PickPackDetail from "./pages/PickPackDetail";
import ProductLabels from "./pages/ProductLabels";
import PurchaseOrderDetail from "./pages/PurchaseOrderDetail";
import PurchaseOrderForm from "./pages/PurchaseOrderForm";
import PurchaseOrders from "./pages/PurchaseOrders";
import Receiving from "./pages/Receiving";
import ReportRunner from "./pages/ReportRunner";
import Reports from "./pages/Reports";
import ReturnDetail from "./pages/ReturnDetail";
import ReturnForm from "./pages/ReturnForm";
import Returns from "./pages/Returns";
import RoutingGuide from "./pages/RoutingGuide";
import RoutingGuideDetail from "./pages/RoutingGuideDetail";
import ScheduleShipments from "./pages/ScheduleShipments";
import ShipmentHistory from "./pages/ShipmentHistory";
import ShippingLabelCreate from "./pages/ShippingLabelCreate";
import Validation from "./pages/Validation";
import ValidationDecision from "./pages/ValidationDecision";
import Vendors from "./pages/Vendors";

function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="login" element={<Login />} />
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
            <Route path="schedule" element={<ScheduleShipments />} />
            <Route path="shipment-history" element={<ShipmentHistory />} />
            <Route path="import" element={<Import />} />
            <Route path="accounts" element={<Accounts />} />
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
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}

export default App;
