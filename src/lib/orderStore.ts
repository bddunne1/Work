import type { PurchaseOrder, ShipmentLine } from "../types";
import { confirmShipment, undoLastShipment } from "../types";
import { adjustQtyOnHand } from "./itemStore";

const ORDERS_KEY = "erp_orders";
const SO_COUNTER_KEY = "erp_so_counter";
const SO_START = 10001;

// Earlier builds used a different status vocabulary and stored the
// allocation decision under `validation`. Normalize old records on read.
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

function readOrders(): PurchaseOrder[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PurchaseOrder[];
    return parsed.map(normalizeOrder);
  } catch {
    return [];
  }
}

function writeOrders(orders: PurchaseOrder[]): void {
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  } catch {
    // storage unavailable (private mode, blocked site data, etc.) - no-op
  }
}

export function nextSalesOrderNumber(): string {
  try {
    const raw = localStorage.getItem(SO_COUNTER_KEY);
    const current = raw ? parseInt(raw, 10) : SO_START;
    return String(current);
  } catch {
    return String(SO_START);
  }
}

// Highest S.O. # already in use, so an admin overriding the next number
// (see Settings) can be warned before creating a collision.
export function maxExistingSalesOrderNumber(): number {
  return readOrders().reduce((max, o) => Math.max(max, parseInt(o.soNumber, 10) || 0), 0);
}

export function setNextSalesOrderNumber(next: number): void {
  try {
    localStorage.setItem(SO_COUNTER_KEY, String(Math.max(SO_START, Math.floor(next))));
  } catch {
    // storage unavailable - no-op
  }
}

function commitSalesOrderNumber(): void {
  try {
    const raw = localStorage.getItem(SO_COUNTER_KEY);
    const current = raw ? parseInt(raw, 10) : SO_START;
    localStorage.setItem(SO_COUNTER_KEY, String(current + 1));
  } catch {
    // storage unavailable - no-op
  }
}

export function listOrders(): PurchaseOrder[] {
  return readOrders().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOrder(soNumber: string): PurchaseOrder | undefined {
  return readOrders().find((o) => o.soNumber === soNumber);
}

export function saveOrder(order: PurchaseOrder): void {
  const orders = readOrders();
  orders.push(order);
  writeOrders(orders);
  commitSalesOrderNumber();
}

export function updateOrder(order: PurchaseOrder): void {
  const orders = readOrders().map((o) => (o.soNumber === order.soNumber ? order : o));
  writeOrders(orders);
}

// Confirms a shipment and, unlike calling confirmShipment directly, also
// subtracts what actually shipped from each item's qtyOnHand - physical
// stock only really leaves the building once a shipment is confirmed.
export function shipOrder(order: PurchaseOrder, lines: ShipmentLine[]): PurchaseOrder {
  const updated = confirmShipment(order, lines);
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const li = order.lineItems.find((x) => x.id === l.lineItemId);
    if (li) adjustQtyOnHand(li.item, -l.qty);
  }
  updateOrder(updated);
  return updated;
}

// Undoes the most recent shipment on `order` (see undoLastShipment) and adds
// those quantities back to qtyOnHand, reversing what shipOrder subtracted.
export function undoShipment(order: PurchaseOrder): PurchaseOrder {
  const history = order.shipmentHistory ?? [];
  if (history.length === 0) return order;
  const last = history[history.length - 1];
  const updated = undoLastShipment(order);
  for (const l of last.lines) {
    if (l.qty <= 0) continue;
    const li = order.lineItems.find((x) => x.id === l.lineItemId);
    if (li) adjustQtyOnHand(li.item, l.qty);
  }
  updateOrder(updated);
  return updated;
}
