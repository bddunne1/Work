// Shared plumbing for the load/usage simulation: a tiny API client that
// records per-endpoint latency + status, a seeded PRNG so runs are
// reproducible, and helpers that mirror the frontend's own data shaping
// (src/lib/*Store.ts map* functions and src/types.ts helpers).
import { randomUUID } from "node:crypto";

export const API = process.env.SIM_API ?? "http://localhost:4000";

// ---- deterministic randomness -------------------------------------------
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    sample: (arr, n) => {
      const copy = arr.slice();
      const out = [];
      while (out.length < n && copy.length) out.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
      return out;
    },
  };
}

// ---- metrics --------------------------------------------------------------
export const metrics = {
  calls: [], // { user, role, method, route, status, ms, bytes, t }
  events: [], // { user, role, kind, detail, t }
  startedAt: Date.now(),
};

export function event(user, kind, detail = {}) {
  metrics.events.push({ user: user?.username ?? "system", role: user?.roleLabel ?? "system", kind, detail, t: Date.now() - metrics.startedAt });
}

// Collapses ids in a path so latency can be grouped by endpoint.
function routeKey(method, path) {
  const p = path
    .split("?")[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "/:id")
    .replace(/\/sales-orders\/\d+/, "/sales-orders/:so")
    .replace(/\/vendor-purchase-orders\/PO-\d+/, "/vendor-purchase-orders/:po")
    .replace(/\/returns\/RA-\d+/, "/returns/:ra")
    .replace(/\/by-number\/[^/]+\/qty/, "/by-number/:item/qty");
  return `${method} ${p}`;
}

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function call(user, method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (user?.token) headers.Authorization = `Bearer ${user.token}`;
  const t0 = performance.now();
  let res;
  let text = "";
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    text = res.status === 204 ? "" : await res.text();
  } catch (err) {
    metrics.calls.push({ user: user?.username, role: user?.roleLabel, method, route: routeKey(method, path), status: 0, ms: performance.now() - t0, bytes: 0, t: Date.now() - metrics.startedAt });
    throw new ApiError(0, `network error: ${err.message}`);
  }
  const ms = performance.now() - t0;
  metrics.calls.push({ user: user?.username, role: user?.roleLabel, method, route: routeKey(method, path), status: res.status, ms, bytes: text.length, t: Date.now() - metrics.startedAt });
  const parsed = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const msg = parsed && typeof parsed.error === "string" ? parsed.error : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, parsed);
  }
  return parsed;
}

export const get = (u, p) => call(u, "GET", p);
export const post = (u, p, b) => call(u, "POST", p, b ?? {});
export const put = (u, p, b) => call(u, "PUT", p, b);
export const patch = (u, p, b) => call(u, "PATCH", p, b);

// ---- mirrors of the frontend's store mappers --------------------------------
export function mapOrder(o) {
  return {
    ...o,
    orderDate: o.orderDate.slice(0, 10),
    dueDate: o.dueDate.slice(0, 10),
    estimatedShipDate: o.estimatedShipDate ? o.estimatedShipDate.slice(0, 10) : undefined,
    taxRate: Number(o.taxRate),
    lineItems: o.lineItems.map((li) => ({ ...li, rate: Number(li.rate), customerPartNumber: li.customerPartNumber ?? undefined })),
    checkedAt: o.checkedAt ?? undefined,
    checkedBy: o.checkedBy ?? undefined,
    checkedByColor: o.checkedByColor ?? undefined,
    writtenBy: o.writtenBy ?? undefined,
    writtenById: o.writtenById ?? undefined,
    writtenByColor: o.writtenByColor ?? undefined,
    allocation: o.allocation ?? undefined,
    labelPrintedAt: o.labelPrintedAt ?? undefined,
    pickedAt: o.pickedAt ?? undefined,
    pendingShipment: o.pendingShipment ?? undefined,
    pickListPrintedAt: o.pickListPrintedAt ?? undefined,
    packingSlipPrintedAt: o.packingSlipPrintedAt ?? undefined,
    pickPackStatus: o.pickPackStatus ?? undefined,
    bol: o.bol ?? undefined,
    shipmentHistory: o.shipmentHistory ?? undefined,
  };
}
export const mapItem = (i) => ({ ...i, rate: Number(i.rate), weight: i.weight == null ? undefined : Number(i.weight) });
export const mapPo = (po) => ({ ...po, orderDate: po.orderDate.slice(0, 10), expectedDate: po.expectedDate ? po.expectedDate.slice(0, 10) : undefined, lines: po.lines.map((l) => ({ ...l, cost: Number(l.cost) })) });
export const mapCustomer = (c) => ({
  ...c,
  priceOverrides: c.priceOverrides?.map((p) => ({ ...p, price: Number(p.price), pricePerFt: p.pricePerFt == null ? undefined : Number(p.pricePerFt), length: p.length == null ? undefined : Number(p.length), weight: p.weight == null ? undefined : Number(p.weight) })),
});

// ---- mirrors of src/types.ts helpers ----------------------------------------
export const allocatedQtyFor = (o, id) => o.allocation?.lines.find((l) => l.lineItemId === id)?.allocatedQty ?? 0;
export const pendingShipmentQtyFor = (o, id) => o.pendingShipment?.find((l) => l.lineItemId === id)?.qty ?? 0;
export const reservedQtyFor = (o, id) => allocatedQtyFor(o, id) + pendingShipmentQtyFor(o, id);
export const shippedQtyFor = (o, id) => (o.shipmentHistory ?? []).reduce((s, r) => s + (r.lines.find((l) => l.lineItemId === id)?.qty ?? 0), 0);
export const remainingToShip = (o, li) => Math.max(0, li.ordered - shippedQtyFor(o, li.id));
export function qtyAllocatedOnOrders(itemNumber, orders) {
  const q = itemNumber.trim().toLowerCase();
  return orders.reduce((sum, o) => sum + o.lineItems.filter((li) => li.item.trim().toLowerCase() === q).reduce((s, li) => s + reservedQtyFor(o, li.id), 0), 0);
}
export function confirmShipment(order, lines) {
  const shippedLines = lines.filter((l) => l.qty > 0);
  const shipmentHistory = [...(order.shipmentHistory ?? []), ...(shippedLines.length ? [{ id: randomUUID(), shippedAt: new Date().toISOString(), lines: shippedLines }] : [])];
  const shippedFor = (id) => shipmentHistory.reduce((s, r) => s + (r.lines.find((l) => l.lineItemId === id)?.qty ?? 0), 0);
  const fullyShipped = order.lineItems.every((li) => shippedFor(li.id) >= li.ordered);
  return { ...order, status: fullyShipped ? "Shipped" : "Backordered", shipmentHistory, pendingShipment: [] };
}
export function receiveVendorPo(po, lines) {
  const received = lines.filter((l) => l.qty > 0);
  if (!received.length) return po;
  const updatedLines = po.lines.map((line) => {
    const r = received.find((l) => l.lineId === line.id);
    return r ? { ...line, receivedQty: line.receivedQty + r.qty } : line;
  });
  const full = updatedLines.every((l) => l.receivedQty >= l.orderedQty);
  const any = updatedLines.some((l) => l.receivedQty > 0);
  return { ...po, lines: updatedLines, status: full ? "Received" : any ? "Partially Received" : po.status, receivingHistory: [...(po.receivingHistory ?? []), { id: randomUUID(), receivedAt: new Date().toISOString(), lines: received }] };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const today = () => new Date().toISOString().slice(0, 10);

export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
