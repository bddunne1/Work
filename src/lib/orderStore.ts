import { api } from "./apiClient";
import { peekNextCounterValue, setNextCounterValue } from "./counterStore";
import type { OrderStatus, PurchaseOrder, ShipmentLine } from "../types";

const SO_COUNTER_KEY = "salesOrder";
const SO_START = 10001;

// Earlier builds used a different status vocabulary and stored the
// allocation decision under `validation`. Normalize old records on read -
// kept from the localStorage era in case any such record still exists in
// the database (carried over via import, etc).
const LEGACY_STATUS_MAP: Record<string, PurchaseOrder["status"]> = {
  "Ships Complete": "Allocated",
  "Partial Ship": "Backordered",
  "Held - Awaiting Stock": "Backordered",
  "Pick & Pack": "Pick & Packed",
};

type LegacyAllocation = { fullyInStock?: boolean; shipCompleteOnly?: boolean; decidedAt?: string };

function normalizeOrder(
  raw: PurchaseOrder & { validation?: (PurchaseOrder["allocation"] & LegacyAllocation) | undefined }
): PurchaseOrder {
  let order = raw;
  const mapped = LEGACY_STATUS_MAP[order.status as string];
  if (mapped) {
    order = { ...order, status: mapped };
  }
  if (!order.allocation && order.validation) {
    order = { ...order, allocation: order.validation };
  }
  const legacy = order.allocation as (PurchaseOrder["allocation"] & LegacyAllocation) | undefined;
  if (legacy && !Array.isArray(legacy.lines)) {
    const fullyAllocated = Boolean(legacy.fullyInStock);
    order = {
      ...order,
      allocation: {
        lines: order.lineItems.map((li) => ({
          lineItemId: li.id,
          allocatedQty: fullyAllocated ? li.ordered : 0,
        })),
        fullyAllocated,
        shipCompleteOnly: legacy.shipCompleteOnly,
        decidedAt: legacy.decidedAt ?? new Date().toISOString(),
      },
    };
  }
  return order;
}

// The server's decimal/date fields serialize over JSON as strings even
// though the frontend type treats them as number/plain-date - convert back
// here so every consumer keeps working with the shapes it always has.
function mapOrder(order: PurchaseOrder): PurchaseOrder {
  return normalizeOrder({
    ...order,
    orderDate: order.orderDate.slice(0, 10),
    dueDate: order.dueDate.slice(0, 10),
    estimatedShipDate: order.estimatedShipDate ? order.estimatedShipDate.slice(0, 10) : undefined,
    taxRate: Number(order.taxRate),
    lineItems: order.lineItems.map((li) => ({ ...li, rate: Number(li.rate), customerPartNumber: li.customerPartNumber ?? undefined })),
    checkedAt: order.checkedAt ?? undefined,
    checkedBy: order.checkedBy ?? undefined,
    checkedByColor: order.checkedByColor ?? undefined,
    writtenBy: order.writtenBy ?? undefined,
    writtenById: order.writtenById ?? undefined,
    writtenByColor: order.writtenByColor ?? undefined,
    allocation: order.allocation ?? undefined,
    labelPrintedAt: order.labelPrintedAt ?? undefined,
    pickedAt: order.pickedAt ?? undefined,
    pendingShipment: order.pendingShipment ?? undefined,
    pickListPrintedAt: order.pickListPrintedAt ?? undefined,
    packingSlipPrintedAt: order.packingSlipPrintedAt ?? undefined,
    pickPackStatus: order.pickPackStatus ?? undefined,
    bol: order.bol ?? undefined,
    shipmentHistory: order.shipmentHistory ?? undefined,
  });
}

// Next S.O. # that will be assigned, for display only (e.g. Settings'
// "next S.O. #" field) - doesn't reserve anything.
export async function nextSalesOrderNumber(): Promise<string> {
  const next = await peekNextCounterValue(SO_COUNTER_KEY, SO_START);
  return String(next);
}

// Highest S.O. # already in use, so an admin overriding the next number
// (see Settings) can be warned before creating a collision.
export async function maxExistingSalesOrderNumber(): Promise<number> {
  const { rows } = await searchOrders({ pageSize: 1, sort: "soNumber", dir: "desc" });
  return rows.length ? parseInt(rows[0].soNumber, 10) || 0 : 0;
}

export async function setNextSalesOrderNumber(next: number): Promise<void> {
  await setNextCounterValue(SO_COUNTER_KEY, Math.max(SO_START, Math.floor(next)));
}

// Every order ever entered, shipped ones included - for history, reports
// and analytics. Workflow pages should use listOpenOrders instead.
export async function listOrders(): Promise<PurchaseOrder[]> {
  const orders = await api.get<PurchaseOrder[]>("/api/sales-orders");
  return orders.map(mapOrder);
}

// Only orders that haven't fully shipped: everything the workflow queues
// (validation, allocation, pick/pack, open picks, back orders, scheduling)
// and stock-availability math need. A fully shipped order holds no
// reservation and owes nothing, so leaving it out changes no totals - it
// just keeps these pages from downloading the entire order history.
export async function listOpenOrders(): Promise<PurchaseOrder[]> {
  const orders = await api.get<PurchaseOrder[]>("/api/sales-orders?open=1");
  return orders.map(mapOrder);
}

// Open orders plus any order with a shipment in the last `days` days -
// everything warehouse capacity (current load + throughput window) reads.
export async function listCapacityOrders(days: number): Promise<PurchaseOrder[]> {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000).toISOString();
  const orders = await api.get<PurchaseOrder[]>(`/api/sales-orders?open=1&shippedSince=${encodeURIComponent(since)}`);
  return orders.map(mapOrder);
}

// The `limit` most recently entered orders, any status.
export async function listRecentOrders(limit: number): Promise<PurchaseOrder[]> {
  const orders = await api.get<PurchaseOrder[]>(`/api/sales-orders?limit=${limit}`);
  return orders.map(mapOrder);
}

export async function getOrder(soNumber: string): Promise<PurchaseOrder | undefined> {
  try {
    const order = await api.get<PurchaseOrder>(`/api/sales-orders/${encodeURIComponent(soNumber)}`);
    return mapOrder(order);
  } catch {
    return undefined;
  }
}

// Creates a new order - the server assigns the real S.O. # atomically, so
// this takes everything except that field and returns the saved record
// (with its real soNumber) to the caller.
export async function saveOrder(order: Omit<PurchaseOrder, "soNumber">): Promise<PurchaseOrder> {
  return mapOrder(await api.post<PurchaseOrder>("/api/sales-orders", order));
}

// Saves the whole order and returns the server's copy, including its new
// `version` - callers that keep working with the order afterwards must use
// the returned value, or their next save is a guaranteed 409.
//
// `expectedStatus` is the status the calling page is acting on (e.g.
// Validation only ever checks an "Entered" order). If the order has moved
// on since the page loaded it, the server refuses with a 409 instead of
// dragging it backwards through the workflow.
export async function updateOrder(order: PurchaseOrder, expectedStatus?: OrderStatus): Promise<PurchaseOrder> {
  return mapOrder(
    await api.put<PurchaseOrder>(`/api/sales-orders/${encodeURIComponent(order.soNumber)}`, { ...order, expectedStatus })
  );
}

// Confirms a shipment of `lines`: the server records it, rolls the order to
// Shipped/Backordered and takes the units out of qtyOnHand in a single
// transaction. A stale `order.version` (someone else touched the order)
// fails with a 409 and changes nothing - so a retry can't double-ship stock.
export async function shipOrder(order: PurchaseOrder, lines: ShipmentLine[]): Promise<PurchaseOrder> {
  return mapOrder(
    await api.post<PurchaseOrder>(`/api/sales-orders/${encodeURIComponent(order.soNumber)}/ship`, {
      version: order.version,
      lines: lines.filter((l) => l.qty > 0),
    })
  );
}

// Cancels `order` (or what's left of a partly shipped one): the server
// releases its allocation / staged pick, records who and why, and takes it
// out of every queue.
export async function cancelOrder(order: PurchaseOrder, reason: string): Promise<PurchaseOrder> {
  return mapOrder(
    await api.post<PurchaseOrder>(`/api/sales-orders/${encodeURIComponent(order.soNumber)}/cancel`, {
      version: order.version,
      reason,
    })
  );
}

export interface ReleaseRequest {
  order: PurchaseOrder;
  // Per-line release quantities; omit to release everything allocated.
  lines?: ShipmentLine[];
}

export interface ReleaseResult {
  results: { soNumber: string; ok: boolean; error?: string }[];
  // Server copies of the orders that released.
  orders: PurchaseOrder[];
}

// Releases allocated orders to the warehouse in one call. Each order is
// released (or refused) on its own, so a stale order in the batch doesn't
// stop the rest - check `results` for any that didn't go.
export async function releaseOrders(requests: ReleaseRequest[]): Promise<ReleaseResult> {
  const res = await api.post<ReleaseResult>("/api/sales-orders/release", {
    orders: requests.map((r) => ({ soNumber: r.order.soNumber, version: r.order.version, lines: r.lines })),
  });
  return { results: res.results, orders: res.orders.map(mapOrder) };
}

// Undoes the most recent shipment on `order` - the server puts those units
// back into qtyOnHand and re-stages them for Open Picks atomically.
export async function undoShipment(order: PurchaseOrder): Promise<PurchaseOrder> {
  if ((order.shipmentHistory ?? []).length === 0) return order;
  return mapOrder(
    await api.post<PurchaseOrder>(`/api/sales-orders/${encodeURIComponent(order.soNumber)}/undo-shipment`, {
      version: order.version,
    })
  );
}

// ---- Paged order search -----------------------------------------------------
// GET /api/sales-orders/search: filtering, sorting and paging happen on the
// server, so history pages fetch one page of orders instead of every order
// ever entered. Statuses are the app-facing names ("Shipped", "Cancelled"...);
// ones the server doesn't know are ignored.

export const OPEN_ORDER_STATUSES = ["Entered", "Checked", "Allocated", "Backordered", "Pick & Packed"];
export const CLOSED_ORDER_STATUSES = ["Shipped", "Cancelled"];

export interface OrderSearchParams {
  status?: string[];
  // S.O. # (exact when numeric), P.O. #, bill-to / ship-to name.
  q?: string;
  customerId?: string;
  // Orders with a line for exactly this item # (case-insensitive).
  item?: string;
  poNumber?: string;
  // YYYY-MM-DD, inclusive.
  orderFrom?: string;
  orderTo?: string;
  // YYYY-MM-DD (whole UTC day) or a full ISO timestamp, inclusive.
  shippedFrom?: string;
  shippedTo?: string;
  page?: number;
  pageSize?: number;
  sort?: "soNumber" | "orderDate" | "shippedAt";
  dir?: "asc" | "desc";
}

export interface OrderSearchResult {
  rows: PurchaseOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export const MAX_SEARCH_PAGE_SIZE = 500;

function searchQueryString(params: OrderSearchParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) qs.set(key, value.join(","));
    } else {
      qs.set(key, String(value));
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export async function searchOrders(params: OrderSearchParams = {}): Promise<OrderSearchResult> {
  const result = await api.get<OrderSearchResult>(`/api/sales-orders/search${searchQueryString(params)}`);
  return { ...result, rows: result.rows.map(mapOrder) };
}

// Every order matching `params`, fetched a page at a time, up to `cap` rows -
// for reports and totals that genuinely need the whole matching set.
// `capped` is true when more orders matched than were returned.
export async function searchAllOrders(
  params: Omit<OrderSearchParams, "page" | "pageSize"> = {},
  cap = 5000
): Promise<{ orders: PurchaseOrder[]; total: number; capped: boolean }> {
  const pageSize = Math.min(MAX_SEARCH_PAGE_SIZE, Math.max(1, cap));
  const orders: PurchaseOrder[] = [];
  // An order entered mid-fetch shifts later pages by one - skip the repeat.
  const seen = new Set<string>();
  let total = 0;
  for (let page = 1; orders.length < cap; page++) {
    const result = await searchOrders({ ...params, page, pageSize });
    total = result.total;
    for (const o of result.rows) {
      if (seen.has(o.soNumber)) continue;
      seen.add(o.soNumber);
      orders.push(o);
    }
    if (result.rows.length < pageSize || orders.length >= total) break;
  }
  if (orders.length > cap) orders.length = cap;
  return { orders, total, capped: total > orders.length };
}
