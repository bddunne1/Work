import { Route, HashRouter, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import BackOrderQueue from "./pages/BackOrderQueue";
import CustomerForm from "./pages/CustomerForm";
import Customers from "./pages/Customers";
import Dashboard from "./pages/Dashboard";
import ItemForm from "./pages/ItemForm";
import Items from "./pages/Items";
import OrderDetail from "./pages/OrderDetail";
import OrderEntry from "./pages/OrderEntry";
import Storage from "./pages/Storage";
import Validation from "./pages/Validation";
import ValidationDecision from "./pages/ValidationDecision";

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
          <Route path="validation" element={<Validation />} />
          <Route path="validation/:soNumber" element={<ValidationDecision />} />
          <Route path="back-orders" element={<BackOrderQueue />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
