import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import PorterMascot from "./PorterMascot";
import { AnalyticsIcon, CatalogIcon, CustomersIcon, DashboardIcon, InventoryIcon } from "./SidebarIcons";
import { useAuth } from "../lib/authContext";
import { getPageAccent } from "../lib/pageAccent";
import { getAccessLevel } from "../lib/permissions";

export default function Layout() {
  const { account, loading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!account) {
    return <Navigate to="/login" replace />;
  }

  const access = getAccessLevel(location.pathname, account);
  const pageAccent = getPageAccent(location.pathname);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <nav className="sidebar-nav no-print">
        <PorterMascot className="sidebar-mascot" />
        <div className="sidebar-links">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            <DashboardIcon />
            Dashboard
          </NavLink>
          <NavLink to="/customers" className={({ isActive }) => (isActive ? "active" : "")}>
            <CustomersIcon />
            Customers
          </NavLink>
          <NavLink to="/inventory" className={({ isActive }) => (isActive ? "active" : "")}>
            <InventoryIcon />
            Inventory
          </NavLink>
          <NavLink to="/items" className={({ isActive }) => (isActive ? "active" : "")}>
            <CatalogIcon />
            Catalog
          </NavLink>
          <NavLink to="/analytics" className={({ isActive }) => (isActive ? "active" : "")}>
            <AnalyticsIcon />
            Analytics
          </NavLink>
        </div>
      </nav>
      <div className="app-main">
        <header className="topbar">
          <Link to="/" className="brand">
            <span className="brand-mark">A</span>
            <span className="brand-name">Aamstrand ERP</span>
          </Link>
          <div className="topbar-user">
            <span className="topbar-username">
              {account.username}{" "}
              <span className="muted">· {account.role === "admin" ? "Admin" : account.initials}</span>
            </span>
            <button type="button" className="secondary-btn" onClick={handleLogout}>
              Log Out
            </button>
          </div>
        </header>
        <main className="content" style={pageAccent ? ({ "--page-accent": pageAccent } as React.CSSProperties) : undefined}>
          {access === "none" ? (
            <div className="page">
              <div className="access-denied">
                <h1>Access denied</h1>
                <p className="muted">Your account doesn't have access to this page.</p>
              </div>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
