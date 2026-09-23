import { api, ApiError, setToken } from "./apiClient";
import type { AccessLevel } from "./permissions";

export type Role = "admin" | "custom";

export interface Account {
  id: string;
  username: string;
  role: Role;
  // Only meaningful when role === "custom" - per-page access level, keyed
  // by PageDef.key (see permissions.ts). Missing keys default to "none".
  permissions?: Record<string, AccessLevel>;
  initials: string;
  // Hex color for this account's stamps/initials on orders (checked stamp,
  // "Entered by" signature) - chosen per-account in Accounts.
  color: string;
  // A deactivated account can't log in or use an existing session -
  // reversible, unlike deleting the account outright.
  active: boolean;
  createdAt?: string;
}

interface ApiAccount {
  id: string;
  username: string;
  role: "ADMIN" | "CUSTOM";
  permissions: Record<string, AccessLevel> | null;
  initials: string;
  color: string;
  active: boolean;
  createdAt?: string;
}

function mapAccount(a: ApiAccount): Account {
  return {
    id: a.id,
    username: a.username,
    role: a.role === "ADMIN" ? "admin" : "custom",
    permissions: a.permissions ?? undefined,
    initials: a.initials,
    color: a.color,
    active: a.active,
    createdAt: a.createdAt,
  };
}

// On failure, `error` carries the server's message (e.g. wrong credentials
// vs. a deactivated account) so the login page can show the real reason
// instead of a generic one.
export async function login(username: string, password: string): Promise<{ account: Account | null; error?: string }> {
  try {
    const res = await api.post<{ token: string; account: ApiAccount }>("/api/auth/login", {
      username,
      password,
    });
    setToken(res.token);
    return { account: mapAccount(res.account) };
  } catch (err) {
    return { account: null, error: err instanceof ApiError ? err.message : "Incorrect username or password." };
  }
}

export function logout(): void {
  setToken(null);
}

export async function getCurrentAccount(): Promise<Account | null> {
  try {
    const res = await api.get<{ account: ApiAccount }>("/api/auth/me");
    return mapAccount(res.account);
  } catch {
    return null;
  }
}

// --- Account management (admin only, enforced server-side) ---

export async function listAccounts(): Promise<Account[]> {
  const accounts = await api.get<ApiAccount[]>("/api/accounts");
  return accounts.map(mapAccount);
}

export async function createAccount(
  username: string,
  password: string,
  role: Role,
  permissions?: Record<string, AccessLevel>,
  initials?: string,
  color?: string
): Promise<Account> {
  const account = await api.post<ApiAccount>("/api/accounts", {
    username,
    password,
    role: role === "admin" ? "ADMIN" : "CUSTOM",
    permissions,
    initials,
    color,
  });
  return mapAccount(account);
}

export async function updateAccount(
  account: Pick<Account, "id" | "role" | "permissions" | "initials" | "color"> & {
    password?: string;
    active?: boolean;
  }
): Promise<Account> {
  const updated = await api.put<ApiAccount>(`/api/accounts/${account.id}`, {
    role: account.role === "admin" ? "ADMIN" : "CUSTOM",
    permissions: account.permissions,
    initials: account.initials,
    color: account.color,
    password: account.password,
    active: account.active,
  });
  return mapAccount(updated);
}

export async function deleteAccount(id: string): Promise<void> {
  await api.del(`/api/accounts/${id}`);
}

// Invalidates every outstanding session for this account (see
// server's tokenVersion) - the account itself is untouched and can log in
// again immediately with its normal credentials.
export async function forceLogoutAccount(id: string): Promise<Account> {
  const updated = await api.post<ApiAccount>(`/api/accounts/${id}/force-logout`);
  return mapAccount(updated);
}
