import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { getToken } from "./apiClient";
import type { Account } from "./authStore";
import { getCurrentAccount, login as loginStore, logout as logoutStore } from "./authStore";
import { canEdit } from "./permissions";
import { clearSettingsCache, preloadSettings } from "./settingsCache";

interface AuthContextValue {
  account: Account | null;
  // True while checking a stored token against the API on first load - the
  // router shouldn't redirect to /login until this settles, or a valid
  // session gets bounced during the async check.
  loading: boolean;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(() => Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    // Settings are read synchronously all over the app (page header on
    // every navigation, order entry, printed documents...), so the cache
    // needs to be warm before anything renders - awaiting it alongside the
    // account check, both gated behind the same `loading` flag, guarantees
    // that.
    Promise.all([getCurrentAccount(), preloadSettings()]).then(([result]) => {
      if (cancelled) return;
      setAccount(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      account,
      loading,
      login: async (username: string, password: string) => {
        const { account: result, error } = await loginStore(username, password);
        if (result) {
          clearSettingsCache();
          await preloadSettings();
        }
        setAccount(result);
        return result !== null ? null : (error ?? "Incorrect username or password.");
      },
      logout: () => {
        logoutStore();
        clearSettingsCache();
        setAccount(null);
      },
    }),
    [account, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Whether the current account can edit (not just view) the current route -
// pages use this to hide/disable their edit controls for a view-only role.
export function useCanEdit(): boolean {
  const { account } = useAuth();
  const location = useLocation();
  if (!account) return false;
  return canEdit(location.pathname, account);
}
