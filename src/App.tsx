import { Route, HashRouter, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
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
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
