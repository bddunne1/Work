import bcrypt from "bcryptjs";
import request from "supertest";
import { expect } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { resetLoginThrottle } from "../src/routes/auth.js";

export const app = createApp();
export const PASSWORD = "Test-Password-2026";
// Cost 4 keeps account creation fast; the policy under test is length, not
// hash strength.
const HASH = bcrypt.hashSync(PASSWORD, 4);

export type Perms = Record<string, "view" | "edit">;

export interface Res<T = any> {
  status: number;
  body: T;
}

// Wipes every application table (not Prisma's migration ledger).
export async function resetDb(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} CASCADE`);
  }
  resetLoginThrottle();
}

export async function makeAccount(
  username: string,
  opts: { role?: "ADMIN" | "CUSTOM"; permissions?: Perms; mustChangePassword?: boolean; active?: boolean; password?: string } = {}
) {
  return prisma.account.create({
    data: {
      username,
      passwordHash: opts.password ? bcrypt.hashSync(opts.password, 4) : HASH,
      role: opts.role ?? "CUSTOM",
      permissions: opts.role === "ADMIN" ? undefined : (opts.permissions ?? {}),
      initials: username.slice(0, 2).toUpperCase(),
      color: "#4c6ef5",
      mustChangePassword: opts.mustChangePassword ?? false,
      active: opts.active ?? true,
    },
  });
}

export class Client {
  constructor(public token: string | null, public username = "") {}
  private send(method: "get" | "post" | "put" | "patch" | "delete", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    let req = request(app)[method](path);
    if (this.token) req = req.set("Authorization", `Bearer ${this.token}`);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    if (body !== undefined) req = req.send(body as object);
    return req.then((r) => ({ status: r.status, body: r.body }));
  }
  get(path: string) {
    return this.send("get", path);
  }
  post(path: string, body: unknown = {}, headers: Record<string, string> = {}) {
    return this.send("post", path, body, headers);
  }
  put(path: string, body: unknown) {
    return this.send("put", path, body);
  }
  patch(path: string, body: unknown) {
    return this.send("patch", path, body);
  }
  del(path: string) {
    return this.send("delete", path);
  }
}

export async function login(username: string, password = PASSWORD): Promise<Res> {
  return new Client(null).post("/api/auth/login", { username, password });
}

// Creates the account (if needed) and signs in.
export async function as(username: string, opts: Parameters<typeof makeAccount>[1] = {}): Promise<Client> {
  const existing = await prisma.account.findFirst({ where: { username } });
  if (!existing) await makeAccount(username, opts);
  const res = await login(username, opts.password);
  expect(res.status, `login as ${username}: ${JSON.stringify(res.body)}`).toBe(200);
  return new Client(res.body.token, username);
}

export function admin(): Promise<Client> {
  return as("admin", { role: "ADMIN" });
}

export function ok<T = any>(res: Res<T>, status = 200): T {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
}

// ---- factories through the real API -----------------------------------------

export const ADDRESS = { name: "Acme Fabrication", addressLine1: "1 Main St", addressLine2: "", city: "Manteno", state: "IL", zip: "60950", notes: "" };

export async function makeItem(c: Client, itemNumber: string, qtyOnHand: number, rate = 2.5) {
  return ok(await c.post("/api/items", { itemNumber, description: `Item ${itemNumber}`, um: "EA", rate, qtyOnHand, weight: 1 }), 201);
}

export async function makeCustomer(c: Client, name = "Acme Fabrication", extra: Record<string, unknown> = {}) {
  return ok(
    await c.post("/api/customers", {
      name,
      accountNumber: `C-${Math.floor(Math.random() * 1e6)}`,
      billTo: { ...ADDRESS, name },
      terms: "Net 30",
      shipToLocations: [{ label: "Dock", address: { ...ADDRESS, name } }],
      ...extra,
    }),
    201
  );
}

export interface LineSpec {
  item: string;
  ordered: number;
  rate?: number;
}

export async function makeOrder(c: Client, lines: LineSpec[], extra: Record<string, unknown> = {}) {
  return ok(
    await c.post("/api/sales-orders", {
      poNumber: `PO-${Math.floor(Math.random() * 1e6)}`,
      orderDate: "2026-09-28",
      dueDate: "2026-09-30",
      billTo: ADDRESS,
      shipTo: ADDRESS,
      taxRate: 0,
      lineItems: lines.map((l) => ({ item: l.item, description: `Item ${l.item}`, um: "EA", ordered: l.ordered, rate: l.rate ?? 2.5 })),
      ...extra,
    }),
    201
  );
}

export const so = (o: { soNumber: string | number }) => `/api/sales-orders/${o.soNumber}`;

// The API returns Decimal columns as strings; the frontend stores convert
// them back to numbers before sending a record round again. These mirror
// that, so a test can GET a record, tweak it and PUT it like a page would.
export const orderPayload = (o: any) => ({ ...o, taxRate: Number(o.taxRate), lineItems: o.lineItems.map((l: any) => ({ ...l, rate: Number(l.rate) })) });
export const poPayload = (po: any) => ({ ...po, lines: po.lines.map((l: any) => ({ ...l, cost: Number(l.cost) })) });
export const raPayload = (ra: any) => ({ ...ra, lines: ra.lines.map((l: any) => ({ ...l, rate: Number(l.rate) })) });
export const itemPayload = (i: any) => ({ ...i, rate: Number(i.rate), weight: i.weight == null ? null : Number(i.weight) });

export const editOrder = (c: Client, o: any, patch: Record<string, unknown>) => c.put(so(o), orderPayload({ ...o, ...patch }));
export const editPo = (c: Client, po: any, patch: Record<string, unknown>) => c.put(`/api/vendor-purchase-orders/${po.poNumber}`, poPayload({ ...po, ...patch }));
export const editRa = (c: Client, ra: any, patch: Record<string, unknown>) => c.put(`/api/returns/${ra.raNumber}`, raPayload({ ...ra, ...patch }));
export const editItem = (c: Client, item: any, patch: Record<string, unknown>) => c.put(`/api/items/${item.id}`, itemPayload({ ...item, components: [], links: [], ...patch }));

export function check(c: Client, o: any) {
  return c.post(`${so(o)}/check`, { version: o.version });
}
// qtys by line index; default = everything remaining
export function allocate(c: Client, o: any, qtys?: number[], shipCompleteOnly?: boolean) {
  const lines = o.lineItems.map((li: any, i: number) => ({ lineItemId: li.id, allocatedQty: qtys ? qtys[i] : li.ordered }));
  return c.post(`${so(o)}/allocate`, { version: o.version, lines, shipCompleteOnly });
}
export function unallocate(c: Client, o: any) {
  return c.post(`${so(o)}/unallocate`, { version: o.version });
}
export async function release(c: Client, o: any, qtys?: number[]): Promise<Res> {
  const res = await c.post("/api/sales-orders/release", {
    orders: [{ soNumber: o.soNumber, version: o.version, lines: qtys ? o.lineItems.map((li: any, i: number) => ({ lineItemId: li.id, qty: qtys[i] })) : undefined }],
  });
  if (res.status !== 200) return res;
  const r = res.body.results[0];
  return r.ok ? { status: 200, body: res.body.orders[0] } : { status: 409, body: { error: r.error, conflict: true } };
}
export function markPrinted(c: Client, o: any, lines?: { lineItemId: string; qty: number }[]) {
  return c.post(`${so(o)}/mark-printed`, { version: o.version, pickList: true, packingSlip: true, lines });
}
// The pack check (sprint 3): packed quantities by line index (default: what
// was staged), optionally who packed it.
export function ready(c: Client, o: any, qtys?: number[], packedBy?: string) {
  const lines = qtys ? o.lineItems.map((li: any, i: number) => ({ lineItemId: li.id, qty: qtys[i] })) : undefined;
  return c.post(`${so(o)}/ready`, { version: o.version, lines, packedBy });
}
export function unready(c: Client, o: any) {
  return c.post(`${so(o)}/unready`, { version: o.version });
}
// Ships what was packed. Since sprint 3 the pack check comes first and a
// short is recorded there, so `qtys` (by line index) go through ready: an
// order already marked ready is un-readied and re-checked with them. A
// refusal at any step is returned as the result.
export async function ship(c: Client, o: any, qtys?: number[]): Promise<Res> {
  let cur = o;
  if (qtys || !cur.readyAt) {
    if (cur.readyAt) {
      const back = await unready(c, cur);
      if (back.status !== 200) return back;
      cur = back.body;
    }
    const packed = await ready(c, cur, qtys);
    if (packed.status !== 200) return packed;
    cur = packed.body;
  }
  return c.post(`${so(cur)}/ship`, { version: cur.version, lines: cur.pendingShipment ?? [] });
}
export function undoShipment(c: Client, o: any) {
  return c.post(`${so(o)}/undo-shipment`, { version: o.version });
}
export function cancel(c: Client, o: any, reason = "test") {
  return c.post(`${so(o)}/cancel`, { version: o.version, reason });
}
// Accounting's step since sprint 2: issue the draft invoice a shipment left
// (the most recent draft for the order), or the draft credit memo for an RA.
export async function issueInvoiceFor(c: Client, soNumber: string | number) {
  const list = ok(await c.get(`/api/invoices?soNumber=${soNumber}&status=DRAFT`));
  const draft = list.rows.at(-1);
  if (!draft) throw new Error(`no draft invoice for S.O. ${soNumber}`);
  return ok(await c.post(`/api/invoices/${draft.id}/issue`, { version: draft.version }));
}
export async function issueMemoFor(c: Client, raNumber: string) {
  const list = ok(await c.get(`/api/invoices/credit-memos?q=${raNumber}&status=DRAFT`));
  const draft = list.rows.find((m: any) => m.raNumber === raNumber);
  if (!draft) throw new Error(`no draft credit memo for ${raNumber}`);
  return ok(await c.post(`/api/invoices/credit-memos/${draft.id}/issue`, { version: draft.version }));
}

export async function getOrder(c: Client, soNumber: string | number) {
  return ok(await c.get(`/api/sales-orders/${soNumber}`));
}

// Walks an existing order from Entered to "printed and waiting to ship".
export async function walkToPrinted(c: Client, o: any) {
  o = ok(await check(c, o));
  o = ok(await allocate(c, o));
  o = ok(await release(c, o));
  return ok(await markPrinted(c, o));
}

// ...and through the pack check, so it can ship.
export async function walkToReady(c: Client, o: any) {
  return ok(await ready(c, await walkToPrinted(c, o)));
}

// Walks a fresh order all the way to "printed and waiting to ship". Header
// fields that are locked once stock is committed (customer, tax, prices)
// go in `extra` so they are set before allocation.
export async function orderReadyToShip(c: Client, lines: LineSpec[], extra: Record<string, unknown> = {}) {
  let o = await makeOrder(c, lines, extra);
  o = ok(await check(c, o));
  o = ok(await allocate(c, o));
  o = ok(await release(c, o));
  o = ok(await markPrinted(c, o));
  // Since sprint 3 a shipment needs the pack check first; "ready to ship"
  // means through it.
  o = ok(await ready(c, o));
  return o;
}

export async function makeVendor(c: Client, name = "Rope Supply Co") {
  return ok(await c.post("/api/vendors", { name, contactName: "Rep", phone: "555", email: "rep@example.com", address: ADDRESS }), 201);
}

export async function makePo(c: Client, vendor: any, lines: { itemNumber: string; orderedQty: number; cost?: number }[]) {
  return ok(
    await c.post("/api/vendor-purchase-orders", {
      vendorId: vendor.id,
      vendorName: vendor.name,
      orderDate: "2026-09-28",
      lines: lines.map((l) => ({ itemNumber: l.itemNumber, description: l.itemNumber, orderedQty: l.orderedQty, cost: l.cost ?? 1 })),
    }),
    201
  );
}

export function receive(c: Client, po: any, qtys: number[]) {
  return c.post(`/api/vendor-purchase-orders/${po.poNumber}/receive`, {
    version: po.version,
    lines: po.lines.map((l: any, i: number) => ({ lineId: l.id, qty: qtys[i] })),
  });
}

export async function itemByNumber(itemNumber: string) {
  return prisma.item.findUniqueOrThrow({ where: { itemNumber } });
}

export async function movementsFor(itemNumber: string) {
  return prisma.stockMovement.findMany({ where: { itemNumber }, orderBy: { createdAt: "asc" } });
}

// The ledger must always explain on-hand from nothing: the item's opening
// stock is itself a movement (R4-26), so sum(deltas) === on hand, and the
// first movement is the OPENING one for `startQty` when that was non-zero.
export async function expectLedgerReconciles(itemNumber: string, startQty: number) {
  const item = await itemByNumber(itemNumber);
  const moves = await movementsFor(itemNumber);
  const sum = moves.reduce((s, m) => s + m.delta, 0);
  expect(item.qtyOnHand, `ledger for ${itemNumber}: movements sum to ${sum}`).toBe(sum);
  if (startQty !== 0) {
    expect(moves[0]?.reason, `ledger for ${itemNumber} starts with its opening stock`).toBe("OPENING");
    expect(moves[0]?.delta).toBe(startQty);
  }
  return { item, moves };
}
