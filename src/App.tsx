import { Route, HashRouter, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Allocation from "./pages/Allocation";
import AllocationDecision from "./pages/AllocationDecision";
import BackOrderQueue from "./pages/BackOrderQueue";
import CreateLabels from "./pages/CreateLabels";
import CustomerForm from "./pages/CustomerForm";
import Customers from "./pages/Customers";
import Dashboard from "./pages/Dashboard";
import Import from "./pages/Import";
import ItemForm from "./pages/ItemForm";
import Items from "./pages/Items";
import OpenPicks from "./pages/OpenPicks";
import OpenPicksDetail from "./pages/OpenPicksDetail";
import OrderDetail from "./pages/OrderDetail";
import OrderEntry from "./pages/OrderEntry";
import OrdersList from "./pages/OrdersList";
import PickPack from "./pages/PickPack";
import PickPackDetail from "./pages/PickPackDetail";
import ScheduleShipments from "./pages/ScheduleShipments";
import ShipmentHistory from "./pages/ShipmentHistory";
import ShippingLabel from "./pages/ShippingLabel";
import Validation from "./pages/Validation";
import ValidationDecision from "./pages/ValidationDecision";

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="order-entry" element={<OrderEntry />} />
          <Route path="open-orders" element={<OrdersList closed={false} />} />
          <Route path="closed-orders" element={<OrdersList closed={true} />} />
          <Route path="storage/:soNumber" element={<OrderDetail />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/new" element={<CustomerForm />} />
          <Route path="customers/:id/edit" element={<CustomerForm />} />
          <Route path="items" element={<Items />} />
          <Route path="items/new" element={<ItemForm />} />
          <Route path="items/:id/edit" element={<ItemForm />} />
          <Route path="validation" element={<Validation />} />
          <Route path="validation/:soNumber" element={<ValidationDecision />} />
          <Route path="allocation" element={<Allocation />} />
          <Route path="allocation/:soNumber" element={<AllocationDecision />} />
          <Route path="back-orders" element={<BackOrderQueue />} />
          <Route path="labels" element={<CreateLabels />} />
          <Route path="labels/:soNumber" element={<ShippingLabel />} />
          <Route path="pick-pack" element={<PickPack />} />
          <Route path="pick-pack/:soNumber" element={<PickPackDetail />} />
          <Route path="open-picks" element={<OpenPicks />} />
          <Route path="open-picks/:soNumber" element={<OpenPicksDetail />} />
          <Route path="schedule" element={<ScheduleShipments />} />
          <Route path="shipment-history" element={<ShipmentHistory />} />
          <Route path="import" element={<Import />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
