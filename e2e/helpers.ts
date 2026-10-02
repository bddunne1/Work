import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

export const API = "http://localhost:4100";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "E2E-Director-2026";
export const STAFF_PASSWORD = "E2E-Staff-2026";
// The shared floor login the dock spec signs in with (its forced password
// change is done in global-setup so the spec lands straight on the dock).
export const WAREHOUSE_PASSWORD = "E2E-Dock-2026-floor";

// What global-setup seeded, for the specs to build on.
export interface SeedState {
  itemNumbers: string[];
  customerId: string;
  customerName: string;
  staffUsername: string;
  warehouseUsername: string;
}

export function seed(): SeedState {
  return JSON.parse(readFileSync(new URL("./.state.json", import.meta.url), "utf8"));
}

export async function apiToken(username = "admin", password = ADMIN_PASSWORD): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!res.ok) throw new Error(`login ${username}: ${res.status} ${await res.text()}`);
  return (await res.json()).token as string;
}

// A thin admin API client for setting scenes up faster than clicking.
export async function api(method: string, path: string, body?: unknown, token?: string): Promise<any> {
  const tok = token ?? (await apiToken());
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

export const so = (o: { soNumber: string | number }) => `/api/sales-orders/${o.soNumber}`;

export async function makeOrder(state: SeedState, lines: { item: string; ordered: number; rate?: number }[]) {
  const cust = await api("GET", `/api/customers/${state.customerId}`);
  const loc = cust.shipToLocations[0];
  return api("POST", "/api/sales-orders", {
    customerId: cust.id,
    poNumber: `E2E-${Date.now().toString().slice(-6)}`,
    orderDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    billTo: cust.billTo,
    shipTo: loc.address,
    shipToLocationId: loc.id,
    taxRate: 0,
    terms: cust.terms,
    lineItems: lines.map((l) => ({ item: l.item, description: l.item, um: "EA", ordered: l.ordered, rate: l.rate ?? 2.5 })),
  });
}

// Checked, allocated, released and the pick list printed: on the floor,
// waiting for its pack check. Admin may check its own order (the
// maker-is-not-checker rule exempts Admin), which keeps the scene short.
export async function orderPrinted(state: SeedState, lines: { item: string; ordered: number; rate?: number }[]) {
  let o = await makeOrder(state, lines);
  o = await api("POST", `${so(o)}/check`, { version: o.version });
  o = await api("POST", `${so(o)}/allocate`, { version: o.version, lines: o.lineItems.map((li: any) => ({ lineItemId: li.id, allocatedQty: li.ordered })) });
  const rel = await api("POST", "/api/sales-orders/release", { orders: [{ soNumber: o.soNumber, version: o.version }] });
  o = rel.orders[0];
  return api("POST", `${so(o)}/mark-printed`, { version: o.version, pickList: true });
}

// Through the pack check too: Ready to ship, packing slip printed, waiting
// on the dock for Mark Shipped.
export async function orderReadyToShip(state: SeedState, lines: { item: string; ordered: number; rate?: number }[]) {
  const o = await orderPrinted(state, lines);
  return api("POST", `${so(o)}/ready`, { version: o.version });
}

// Signs in through the login screen and lands on the Dashboard.
export async function signIn(page: Page, username = "admin", password = ADMIN_PASSWORD): Promise<void> {
  await page.goto("/#/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page).not.toHaveURL(/#\/login/);
}

// Browser confirm() prompts (issue an invoice, receive a return) are accepted.
export function acceptDialogs(page: Page): void {
  page.on("dialog", (d) => d.accept());
}
