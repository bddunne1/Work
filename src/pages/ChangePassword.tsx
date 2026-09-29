import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { changePassword } from "../lib/authStore";

const MIN_LENGTH = 10;

// Shown on its own after sign-in when the account was seeded or had its
// password reset by an admin; also reachable any time from the user menu.
export default function ChangePassword() {
  const { account, setAccount, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const required = Boolean(account?.mustChangePassword);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (next.length < MIN_LENGTH) {
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const updated = await changePassword(current, next);
      setAccount(updated);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The password wasn't changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <span className="brand-mark">A</span>
          <div>
            <div className="brand-name">{required ? "Choose your password" : "Change password"}</div>
            <div className="brand-sub">{account?.username}</div>
          </div>
        </div>
        {required && (
          <p className="muted" style={{ fontSize: 13 }}>
            The password you signed in with was set for you. Pick your own before continuing - at least {MIN_LENGTH}{" "}
            characters.
          </p>
        )}
        <label className="form-field">
          Current password
          <input
            id="current-password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
        </label>
        <label className="form-field">
          New password
          <input id="new-password" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="form-field">
          New password again
          <input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button type="submit" className="primary-btn login-submit" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </button>
        <button
          type="button"
          className="secondary-btn login-submit"
          onClick={() => {
            if (required) {
              logout();
              navigate("/login");
            } else {
              navigate(-1);
            }
          }}
        >
          {required ? "Sign out" : "Cancel"}
        </button>
      </form>
    </div>
  );
}
