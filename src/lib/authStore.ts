export type Role = "admin" | "order-entry";

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
  createdAt: string;
}

const ACCOUNTS_KEY = "erp_accounts";
const SESSION_KEY = "erp_session_account_id";

function seedDefaultAdmin(accounts: Account[]): Account[] {
  if (accounts.some((a) => a.username.toLowerCase() === "admin")) return accounts;
  return [
    ...accounts,
    {
      id: crypto.randomUUID(),
      username: "admin",
      password: "123",
      role: "admin",
      createdAt: new Date().toISOString(),
    },
  ];
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
  return seeded;
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

export function createAccount(username: string, password: string, role: Role): Account {
  const account: Account = {
    id: crypto.randomUUID(),
    username: username.trim(),
    password,
    role,
    createdAt: new Date().toISOString(),
  };
  writeAccounts([...readAccounts(), account]);
  return account;
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
