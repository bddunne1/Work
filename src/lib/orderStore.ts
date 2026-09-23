import { api } from "./apiClient";
import { peekNextCounterValue, setNextCounterValue } from "./counterStore";
import type { PurchaseOrder, ShipmentLine } from "../types";
import { confirmShipment, undoLastShipment } from "../types";
import { adjustQtyOnHand } from "./itemStore";

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
  const orders = await listOrders();
  return orders.reduce((max, o) => Math.max(max, parseInt(o.soNumber, 10) || 0), 0);
}

export async function setNextSalesOrderNumber(next: number): Promise<void> {
  await setNextCounterValue(SO_COUNTER_KEY, Math.max(SO_START, Math.floor(next)));
}

export async function listOrders(): Promise<PurchaseOrder[]> {
  const orders = await api.get<PurchaseOrder[]>("/api/sales-orders");
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

export async function updateOrder(order: PurchaseOrder): Promise<void> {
  await api.put(`/api/sales-orders/${encodeURIComponent(order.soNumber)}`, order);
}

// Confirms a shipment and, unlike calling confirmShipment directly, also
// subtracts what actually shipped from each item's qtyOnHand - physical
// stock only really leaves the building once a shipment is confirmed.
export async function shipOrder(order: PurchaseOrder, lines: ShipmentLine[]): Promise<PurchaseOrder> {
  const updated = confirmShipment(order, lines);
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const li = order.lineItems.find((x) => x.id === l.lineItemId);
    if (li) await adjustQtyOnHand(li.item, -l.qty);
  }
  await updateOrder(updated);
  return updated;
}

// Undoes the most recent shipment on `order` (see undoLastShipment) and adds
// those quantities back to qtyOnHand, reversing what shipOrder subtracted.
export async function undoShipment(order: PurchaseOrder): Promise<PurchaseOrder> {
  const history = order.shipmentHistory ?? [];
  if (history.length === 0) return order;
  const last = history[history.length - 1];
  const updated = undoLastShipment(order);
  for (const l of last.lines) {
    if (l.qty <= 0) continue;
    const li = order.lineItems.find((x) => x.id === l.lineItemId);
    if (li) await adjustQtyOnHand(li.item, l.qty);
  }
  await updateOrder(updated);
  return updated;
}
