import { Route, HashRouter, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import CustomerForm from "./pages/CustomerForm";
import Customers from "./pages/Customers";
import Dashboard from "./pages/Dashboard";
import ItemForm from "./pages/ItemForm";
import Items from "./pages/Items";
import OrderDetail from "./pages/OrderDetail";
import OrderEntry from "./pages/OrderEntry";
import Storage from "./pages/Storage";

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="order-entry" element={<OrderEntry />} />
          <Route path="storage" element={<Storage />} />
          <Route path="storage/:soNumber" element={<OrderDetail />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/new" element={<CustomerForm />} />
          <Route path="customers/:id/edit" element={<CustomerForm />} />
          <Route path="items" element={<Items />} />
          <Route path="items/new" element={<ItemForm />} />
          <Route path="items/:id/edit" element={<ItemForm />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
