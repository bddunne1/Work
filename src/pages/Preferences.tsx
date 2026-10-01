import { useState } from "react";
import { useAuth } from "../lib/authContext";
import { getAccessLevel } from "../lib/permissions";
import { getThemePreference, setThemePreference, type ThemePreference } from "../lib/theme";
import { Link } from "react-router-dom";

// Per-person choices, kept in this browser. Company-wide settings (lead
// time, numbering, QuickBooks) stay under Settings for admins.
const THEMES: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "system", label: "Follow the system", hint: "Light or dark as the device is set." },
  { value: "light", label: "Light", hint: "Always light." },
  { value: "dark", label: "Dark", hint: "Always dark. Printed documents stay light." },
];

export default function Preferences() {
  const { account } = useAuth();
  const [theme, setTheme] = useState<ThemePreference>(() => getThemePreference());
  const canSettings = account ? getAccessLevel("/settings", account) !== "none" : false;

  function choose(next: ThemePreference) {
    setTheme(next);
    setThemePreference(next);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Preferences</h1>
        <p className="muted">Choices for you, on this device. They do not affect anyone else.</p>
      </div>

      <div className="import-panel">
        <h3>Appearance</h3>
        <fieldset className="pref-group">
          <legend className="muted">Theme</legend>
          {THEMES.map((t) => (
            <label key={t.value} className="checkbox-line pref-option">
              <input id={`theme-${t.value}`} type="radio" name="theme" value={t.value} checked={theme === t.value} onChange={() => choose(t.value)} />
              <span>
                <b>{t.label}</b> <span className="muted">{t.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="import-panel">
        <h3>Account</h3>
        <p className="muted">
          Signed in as <b>{account?.username}</b>. <Link to="/change-password">Change password</Link>
          {canSettings && (
            <>
              {" · "}
              <Link to="/settings">Company settings</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
