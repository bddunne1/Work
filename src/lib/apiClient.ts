// Thin fetch wrapper for the Postgres-backed API (see /server). This is the
// beginning of the migration off localStorage - only the customer/item/
// vendor/account stores talk to it so far; everything else in lib/*Store.ts
// still reads and writes localStorage directly until it's ported too.
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "erp_api_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable - session just won't persist across reloads
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, data?: unknown): Promise<T> =>
    request<T>(path, { method: "POST", body: JSON.stringify(data) }),
  put: <T>(path: string, data?: unknown): Promise<T> =>
    request<T>(path, { method: "PUT", body: JSON.stringify(data) }),
  patch: <T>(path: string, data?: unknown): Promise<T> =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(data) }),
  del: (path: string): Promise<void> => request<void>(path, { method: "DELETE" }),
};
