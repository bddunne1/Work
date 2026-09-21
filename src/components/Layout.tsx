import { NavLink, Outlet } from "react-router-dom";

export default function Layout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <div className="brand-name">Aamstrand ERP</div>
            <div className="brand-sub">Order &amp; Fulfillment</div>
          </div>
        </div>
        <nav className="topnav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            Dashboard
          </NavLink>
          <NavLink to="/order-entry" className={({ isActive }) => (isActive ? "active" : "")}>
            Order Entry
          </NavLink>
          <NavLink to="/storage" className={({ isActive }) => (isActive ? "active" : "")}>
            Storage
          </NavLink>
          <NavLink to="/customers" className={({ isActive }) => (isActive ? "active" : "")}>
            Customers
          </NavLink>
          <NavLink to="/items" className={({ isActive }) => (isActive ? "active" : "")}>
            Items
          </NavLink>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
