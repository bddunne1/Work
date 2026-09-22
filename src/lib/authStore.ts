import type { AccessLevel } from "./permissions";
import { PERMISSION_PRESETS } from "./permissions";

export type Role = "admin" | "custom";

export interface Account {
  id: string;
  username: string;
  // Plaintext, on purpose: this whole app is client-side localStorage with
  // no server, so hashing here would only look secure without being secure
  // (the "secret" ships in the same bundle as the code that checks it).
  // This login gate is a UI convenience for separating roles, not a real
  // security boundary - anyone with devtools access to this browser can
  // already read or change any data in the app regardless of login state.
  password: string;
  role: Role;
  // Only meaningful when role === "custom" - per-page access level, keyed
  // by PageDef.key (see permissions.ts). A missing key defaults to "none".
  // Admin ignores this entirely and always gets "edit" everywhere.
  permissions?: Record<string, AccessLevel>;
  // Short initials stamped on things this account does (e.g. validating an
  // order) - defaults to derived from the username if not set explicitly.
  initials: string;
  createdAt: string;
}

const ACCOUNTS_KEY = "erp_accounts";
const SESSION_KEY = "erp_session_account_id";

export function deriveInitials(username: string): string {
  const parts = username.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (username.trim().slice(0, 2) || "??").toUpperCase();
}

function seedDefaultAdmin(accounts: Account[]): Account[] {
  if (accounts.some((a) => a.username.toLowerCase() === "admin")) return accounts;
  return [
    ...accounts,
    {
      id: crypto.randomUUID(),
      username: "admin",
      password: "123",
      role: "admin",
      initials: "AD",
      createdAt: new Date().toISOString(),
    },
  ];
}

// Earlier builds only had two hardcoded roles, "admin" and "order-entry".
// Normalize old records to the granular-permissions shape on read: a legacy
// "order-entry" role becomes "custom" seeded with the Order Entry preset,
// and any account saved before initials existed gets them derived from its
// username. Not persisted here - applied fresh on every read, same as the
// other stores' normalize-on-read helpers.
function normalizeAccount(raw: Account & { role: string }): Account {
  let account = raw as Account;
  if ((raw.role as string) === "order-entry") {
    const preset = PERMISSION_PRESETS.find((p) => p.key === "order-entry");
    account = { ...account, role: "custom", permissions: preset?.permissions ?? {} };
  }
  if (!account.initials) {
    account = { ...account, initials: deriveInitials(account.username) };
  }
  return account;
}

function readAccounts(): Account[] {
  let parsed: Account[] = [];
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    parsed = raw ? (JSON.parse(raw) as Account[]) : [];
  } catch {
    parsed = [];
  }
  const seeded = seedDefaultAdmin(parsed);
  if (seeded.length !== parsed.length) writeAccounts(seeded);
  return seeded.map(normalizeAccount);
}

function writeAccounts(accounts: Account[]): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // storage unavailable (private mode, blocked site data, etc.) - no-op
  }
}

export function listAccounts(): Account[] {
  return readAccounts();
}

export function createAccount(
  username: string,
  password: string,
  role: Role,
  permissions?: Record<string, AccessLevel>,
  initials?: string
): Account {
  const account: Account = {
    id: crypto.randomUUID(),
    username: username.trim(),
    password,
    role,
    permissions: role === "custom" ? (permissions ?? {}) : undefined,
    initials: (initials?.trim() || deriveInitials(username)).toUpperCase(),
    createdAt: new Date().toISOString(),
  };
  writeAccounts([...readAccounts(), account]);
  return account;
}

export function updateAccount(account: Account): void {
  const accounts = readAccounts().map((a) => (a.id === account.id ? account : a));
  writeAccounts(accounts);
}

export function deleteAccount(id: string): void {
  writeAccounts(readAccounts().filter((a) => a.id !== id));
}

export function login(username: string, password: string): Account | null {
  const account = readAccounts().find(
    (a) => a.username.toLowerCase() === username.trim().toLowerCase() && a.password === password
  );
  if (!account) return null;
  try {
    localStorage.setItem(SESSION_KEY, account.id);
  } catch {
    // storage unavailable - session just won't persist across reloads
  }
  return account;
}

export function logout(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable - no-op
  }
}

export function getCurrentAccount(): Account | null {
  try {
    const id = localStorage.getItem(SESSION_KEY);
    if (!id) return null;
    return readAccounts().find((a) => a.id === id) ?? null;
  } catch {
    return null;
  }
}
