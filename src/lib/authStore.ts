import { api, setToken } from "./apiClient";
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
  createdAt?: string;
}

interface ApiAccount {
  id: string;
  username: string;
  role: "ADMIN" | "CUSTOM";
  permissions: Record<string, AccessLevel> | null;
  initials: string;
  color: string;
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
    createdAt: a.createdAt,
  };
}

export async function login(username: string, password: string): Promise<Account | null> {
  try {
    const res = await api.post<{ token: string; account: ApiAccount }>("/api/auth/login", {
      username,
      password,
    });
    setToken(res.token);
    return mapAccount(res.account);
  } catch {
    return null;
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
  account: Pick<Account, "id" | "role" | "permissions" | "initials" | "color"> & { password?: string }
): Promise<Account> {
  const updated = await api.put<ApiAccount>(`/api/accounts/${account.id}`, {
    role: account.role === "admin" ? "ADMIN" : "CUSTOM",
    permissions: account.permissions,
    initials: account.initials,
    color: account.color,
    password: account.password,
  });
  return mapAccount(updated);
}

export async function deleteAccount(id: string): Promise<void> {
  await api.del(`/api/accounts/${id}`);
}
