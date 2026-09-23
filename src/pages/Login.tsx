import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/authContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (await login(username, password)) {
      navigate("/");
    } else {
      setError("Incorrect username or password.");
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <span className="brand-mark">A</span>
          <div>
            <div className="brand-name">Aamstrand ERP</div>
            <div className="brand-sub">Order &amp; Fulfillment</div>
          </div>
        </div>

        <label className="form-field">
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </label>
        <label className="form-field">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="primary-btn login-submit">
          Log In
        </button>
      </form>
    </div>
  );
}
