import { createContext, useContext, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { Account } from "./authStore";
import { getCurrentAccount, login as loginStore, logout as logoutStore } from "./authStore";
import { canEdit } from "./permissions";

interface AuthContextValue {
  account: Account | null;
  login: (username: string, password: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(() => getCurrentAccount());

  const value = useMemo<AuthContextValue>(
    () => ({
      account,
      login: (username: string, password: string) => {
        const result = loginStore(username, password);
        setAccount(result);
        return result !== null;
      },
      logout: () => {
        logoutStore();
        setAccount(null);
      },
    }),
    [account]
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
  return canEdit(location.pathname, account.role);
}
