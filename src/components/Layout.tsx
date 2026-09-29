import { useEffect } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import BrandMark from "./BrandMark";
import ErrorBoundary from "./ErrorBoundary";
import ToastHost from "./Toast";
import MoreMenu from "./MoreMenu";
import { AnalyticsIcon, CatalogIcon, CustomersIcon, DashboardIcon, InventoryIcon } from "./SidebarIcons";
import { useAuth } from "../lib/authContext";
import { getCompanyInfo } from "../lib/companyStore";
import { getPageAccent } from "../lib/pageAccent";
import { getAccessLevel } from "../lib/permissions";

export default function Layout() {
  const { account, loading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // React Router doesn't reset scroll on navigation the way a full page
  // load does - without this, a list page can open still scrolled to
  // wherever the previous page left off instead of at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

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
  // A seeded or admin-reset password has to be replaced before any page
  // will load - the API refuses everything else with 403 until it is.
  if (account.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  const access = getAccessLevel(location.pathname, account);
  const pageAccent = getPageAccent(location.pathname);
  // Only links the account can follow (C-14): a warehouse login never sees
  // a sidebar entry that opens on Access denied.
  const canGo = (path: string) => getAccessLevel(path, account!) !== "none";

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <nav className="sidebar-nav no-print">
        <BrandMark className="sidebar-brand-mark" />
        <div className="sidebar-links">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            <DashboardIcon />
            Dashboard
          </NavLink>
          {(canGo("/customers/all") || canGo("/customers/pricing") || canGo("/customers/routing-guide")) && (
            <NavLink to="/customers" className={({ isActive }) => (isActive ? "active" : "")}>
              <CustomersIcon />
              Customers
            </NavLink>
          )}
          {canGo("/inventory") && (
            <NavLink to="/inventory" className={({ isActive }) => (isActive ? "active" : "")}>
              <InventoryIcon />
              Inventory
            </NavLink>
          )}
          {canGo("/items") && (
            <NavLink to="/items" className={({ isActive }) => (isActive ? "active" : "")}>
              <CatalogIcon />
              Catalog
            </NavLink>
          )}
          {canGo("/analytics") && (
            <NavLink to="/analytics" className={({ isActive }) => (isActive ? "active" : "")}>
              <AnalyticsIcon />
              Analytics
            </NavLink>
          )}
        </div>
      </nav>
      <div className="app-main">
        <header className="topbar">
          <Link to="/" className="brand">
            <span className="brand-name">{getCompanyInfo().name}</span>
          </Link>
          <div className="topbar-user">
            <span className="topbar-username">
              {account.username}{" "}
              <span className="muted">· {account.role === "admin" ? "Admin" : account.initials}</span>
            </span>
            <MoreMenu account={account} />
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
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          )}
        </main>
      </div>
      <ToastHost />
    </div>
  );
}
