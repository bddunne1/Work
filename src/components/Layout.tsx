import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/authContext";
import { getAccessLevel } from "../lib/permissions";

export default function Layout() {
  const { account, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (!account) {
    return <Navigate to="/login" replace />;
  }

  const access = getAccessLevel(location.pathname, account.role);

  function handleLogout() {
    logout();
    navigate("/login");
  }

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
          <NavLink to="/open-orders" className={({ isActive }) => (isActive ? "active" : "")}>
            Open Orders
          </NavLink>
          {account.role === "admin" && (
            <>
              <NavLink to="/validation" className={({ isActive }) => (isActive ? "active" : "")}>
                Validation
              </NavLink>
              <NavLink to="/allocation" className={({ isActive }) => (isActive ? "active" : "")}>
                Allocation
              </NavLink>
            </>
          )}
          <NavLink to="/customers" className={({ isActive }) => (isActive ? "active" : "")}>
            Customers
          </NavLink>
          <NavLink to="/items" className={({ isActive }) => (isActive ? "active" : "")}>
            Items
          </NavLink>
          {account.role === "admin" && (
            <NavLink to="/accounts" className={({ isActive }) => (isActive ? "active" : "")}>
              Accounts
            </NavLink>
          )}
        </nav>
        <div className="topbar-user">
          <span className="topbar-username">
            {account.username} <span className="muted">· {account.role}</span>
          </span>
          <button type="button" className="secondary-btn" onClick={handleLogout}>
            Log Out
          </button>
        </div>
      </header>
      <main className="content">
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
  );
}
