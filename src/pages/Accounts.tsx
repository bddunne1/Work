import { Fragment, useEffect, useState } from "react";
import { ApiError } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import type { Account, Role } from "../lib/authStore";
import { createAccount, deleteAccount, listAccounts, updateAccount } from "../lib/authStore";
import type { AccessLevel } from "../lib/permissions";
import { PAGE_DEFS, PERMISSION_PRESETS } from "../lib/permissions";

const ACCESS_OPTIONS: { value: AccessLevel; label: string }[] = [
  { value: "none", label: "No access" },
  { value: "view", label: "View only" },
  { value: "edit", label: "Edit" },
];

function pageGroups(): string[] {
  const groups: string[] = [];
  for (const def of PAGE_DEFS) {
    if (!groups.includes(def.group)) groups.push(def.group);
  }
  return groups;
}

function presetLabelFor(permissions: Record<string, AccessLevel> | undefined): string | null {
  if (!permissions) return null;
  const match = PERMISSION_PRESETS.find(
    (p) =>
      Object.keys(p.permissions).length === Object.keys(permissions).length &&
      Object.entries(p.permissions).every(([k, v]) => permissions[k] === v)
  );
  return match?.label ?? null;
}

function PermissionGrid({
  permissions,
  onChange,
}: {
  permissions: Record<string, AccessLevel>;
  onChange: (pageKey: string, access: AccessLevel) => void;
}) {
  return (
    <table className="data-table permission-grid">
      <thead>
        <tr>
          <th>Page</th>
          <th>Access</th>
        </tr>
      </thead>
      <tbody>
        {pageGroups().map((group) => (
          <Fragment key={group}>
            <tr className="permission-group-row">
              <td colSpan={2}>{group}</td>
            </tr>
            {PAGE_DEFS.filter((def) => def.group === group).map((def) => (
              <tr key={def.key}>
                <td>{def.label}</td>
                <td>
                  <select
                    value={permissions[def.key] ?? "none"}
                    onChange={(e) => onChange(def.key, e.target.value as AccessLevel)}
                  >
                    {ACCESS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export default function Accounts() {
  const { account: currentAccount } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [initials, setInitials] = useState("");
  const [role, setRole] = useState<Role>("custom");
  const [permissions, setPermissions] = useState<Record<string, AccessLevel>>({});
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<Role>("custom");
  const [editInitials, setEditInitials] = useState("");
  const [editPermissions, setEditPermissions] = useState<Record<string, AccessLevel>>({});

  const admins = accounts.filter((a) => a.role === "admin");

  async function refresh() {
    setAccounts(await listAccounts());
  }

  useEffect(() => {
    listAccounts().then((accts) => {
      setAccounts(accts);
      setLoading(false);
    });
  }, []);

  function applyPreset(key: string, apply: (p: Record<string, AccessLevel>) => void) {
    const preset = PERMISSION_PRESETS.find((p) => p.key === key);
    apply(preset ? { ...preset.permissions } : {});
  }

  function resetCreateForm() {
    setUsername("");
    setPassword("");
    setInitials("");
    setRole("custom");
    setPermissions({});
  }

  async function handleCreate(e: React.FormEvent) {
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
    try {
      await createAccount(username, password, role, role === "custom" ? permissions : undefined, initials || undefined);
      await refresh();
      resetCreateForm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create account.");
    }
  }

  async function handleDelete(a: Account) {
    if (a.role === "admin" && admins.length <= 1) {
      alert("Can't delete the last admin account.");
      return;
    }
    if (!confirm(`Delete account "${a.username}"?`)) return;
    await deleteAccount(a.id);
    await refresh();
    if (editingId === a.id) setEditingId(null);
  }

  function startEdit(a: Account) {
    setEditingId(a.id);
    setEditRole(a.role);
    setEditInitials(a.initials);
    setEditPermissions(a.permissions ?? {});
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setError("");
  }

  async function saveEdit(a: Account) {
    if (a.role === "admin" && editRole === "custom" && admins.length <= 1) {
      alert("Can't demote the last admin account - create another admin first.");
      return;
    }
    try {
      await updateAccount({
        id: a.id,
        role: editRole,
        initials: (editInitials.trim() || a.initials).toUpperCase(),
        permissions: editRole === "custom" ? editPermissions : undefined,
      });
      await refresh();
      setEditingId(null);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to save account.");
    }
  }

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Accounts</h1>
        <p className="muted">
          Manage who can log in and exactly which pages they can view or edit. Admin always has full
          access. Start a new account from a preset below, then fine-tune any page.
        </p>
      </div>

      <div className="import-panel">
        <h3>Add Account</h3>
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <label className="form-field">
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label className="form-field">
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="form-field">
              Initials (optional)
              <input
                placeholder="Auto from username"
                maxLength={4}
                value={initials}
                onChange={(e) => setInitials(e.target.value.toUpperCase())}
              />
            </label>
            <label className="form-field">
              Role
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="custom">Custom</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>

          {role === "custom" && (
            <>
              <label className="form-field permission-preset-field">
                Start from a preset
                <select defaultValue="" onChange={(e) => applyPreset(e.target.value, setPermissions)}>
                  <option value="" disabled>
                    Choose a preset (or leave blank to build from scratch)...
                  </option>
                  {PERMISSION_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted permission-preset-hint">
                Applying a preset fills in the grid below - every row is still editable after that.
              </p>
              <PermissionGrid
                permissions={permissions}
                onChange={(key, access) =>
                  setPermissions((p) => ({ ...p, [key]: access === "none" ? undefined : access }) as Record<
                    string,
                    AccessLevel
                  >)
                }
              />
            </>
          )}

          <div className="form-field form-field-btn">
            <button type="submit" className="primary-btn">
              Add Account
            </button>
          </div>
        </form>
        {error && !editingId && <p className="login-error">{error}</p>}
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Initials</th>
            <th>Role</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const presetLabel = a.role === "custom" ? presetLabelFor(a.permissions) : null;
            return (
              <Fragment key={a.id}>
                <tr
                  className="clickable-row"
                  onClick={() => (editingId === a.id ? cancelEdit() : startEdit(a))}
                >
                  <td>
                    {a.username} {a.id === currentAccount?.id && <span className="muted">(you)</span>}
                  </td>
                  <td>{a.initials}</td>
                  <td>
                    {a.role === "admin" ? "Admin" : presetLabel ? `Custom · ${presetLabel}` : "Custom"}
                  </td>
                  <td>{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}</td>
                  <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="row-action-outline"
                      onClick={() => (editingId === a.id ? cancelEdit() : startEdit(a))}
                    >
                      {editingId === a.id ? "Cancel" : "Edit"}
                    </button>
                    <button
                      type="button"
                      className="row-action-outline danger-link"
                      onClick={() => handleDelete(a)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                {editingId === a.id && (
                  <tr>
                    <td colSpan={5}>
                      <div className="account-edit-panel">
                        <div className="form-row">
                          <label className="form-field">
                            Initials
                            <input
                              maxLength={4}
                              value={editInitials}
                              onChange={(e) => setEditInitials(e.target.value.toUpperCase())}
                            />
                          </label>
                          <label className="form-field">
                            Role
                            <select value={editRole} onChange={(e) => setEditRole(e.target.value as Role)}>
                              <option value="custom">Custom</option>
                              <option value="admin">Admin</option>
                            </select>
                          </label>
                        </div>

                        {editRole === "custom" && (
                          <>
                            <label className="form-field permission-preset-field">
                              Apply a preset
                              <select defaultValue="" onChange={(e) => applyPreset(e.target.value, setEditPermissions)}>
                                <option value="" disabled>
                                  Choose a preset to overwrite the grid below...
                                </option>
                                {PERMISSION_PRESETS.map((p) => (
                                  <option key={p.key} value={p.key}>
                                    {p.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <PermissionGrid
                              permissions={editPermissions}
                              onChange={(key, access) =>
                                setEditPermissions(
                                  (p) =>
                                    ({ ...p, [key]: access === "none" ? undefined : access }) as Record<
                                      string,
                                      AccessLevel
                                    >
                                )
                              }
                            />
                          </>
                        )}

                        <div className="button-row">
                          <button type="button" className="primary-btn" onClick={() => saveEdit(a)}>
                            Save Permissions
                          </button>
                          <button type="button" className="secondary-btn" onClick={cancelEdit}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <div className="preset-reference">
        <h3>Preset Reference</h3>
        <div className="module-grid">
          {PERMISSION_PRESETS.map((p) => (
            <div key={p.key} className="module-card disabled preset-card">
              <div className="module-name">{p.label}</div>
              <div className="module-desc">{p.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
