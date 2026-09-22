import { useState } from "react";
import { useAuth } from "../lib/authContext";
import type { Account, Role } from "../lib/authStore";
import { createAccount, deleteAccount, listAccounts } from "../lib/authStore";

export default function Accounts() {
  const { account: currentAccount } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>(() => listAccounts());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("order-entry");
  const [error, setError] = useState("");

  const admins = accounts.filter((a) => a.role === "admin");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }
    if (accounts.some((a) => a.username.toLowerCase() === username.trim().toLowerCase())) {
      setError("That username is already taken.");
      return;
    }
    createAccount(username, password, role);
    setAccounts(listAccounts());
    setUsername("");
    setPassword("");
    setRole("order-entry");
  }

  function handleDelete(a: Account) {
    if (a.role === "admin" && admins.length <= 1) {
      alert("Can't delete the last admin account.");
      return;
    }
    if (!confirm(`Delete account "${a.username}"?`)) return;
    deleteAccount(a.id);
    setAccounts(listAccounts());
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Accounts</h1>
        <p className="muted">
          Manage who can log in and what they can see. Admin has full access; Order Entry can only enter
          orders and pick &amp; pack, with view-only access to customers, items, and schedule shipments.
        </p>
      </div>

      <div className="import-panel">
        <h3>Add Account</h3>
        <form className="form-row" onSubmit={handleCreate}>
          <label className="form-field">
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="form-field">
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="form-field">
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="order-entry">Order Entry</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <div className="form-field form-field-btn">
            <button type="submit" className="primary-btn">
              Add Account
            </button>
          </div>
        </form>
        {error && <p className="login-error">{error}</p>}
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td>
                {a.username} {a.id === currentAccount?.id && <span className="muted">(you)</span>}
              </td>
              <td>{a.role === "admin" ? "Admin" : "Order Entry"}</td>
              <td>{new Date(a.createdAt).toLocaleDateString()}</td>
              <td className="row-actions">
                <button type="button" className="link-btn danger-link" onClick={() => handleDelete(a)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
