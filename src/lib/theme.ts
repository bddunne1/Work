// Light, dark or follow the system. Stored per browser; applied as
// data-theme on <html>, which index.css reads. Printable documents stay
// light whatever the choice (see the print rules in index.css).
export type ThemePreference = "system" | "light" | "dark";

const KEY = "erp.theme";

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Storage unavailable: the choice lasts for this page load only.
  }
  applyTheme(pref);
}
