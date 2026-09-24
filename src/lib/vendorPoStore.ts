import { api } from "./apiClient";
import { peekNextCounterValue, setNextCounterValue } from "./counterStore";
import type { VendorPurchaseOrder, VendorReceivingLine } from "../types";

const VENDOR_PO_COUNTER_KEY = "vendorPo";
const VENDOR_PO_START = 5001;

// The server's decimal/date fields serialize over JSON as strings even
// though the frontend type treats them as number/plain-date - convert back
// here so every consumer keeps working with the shapes it always has.
function mapPo(po: VendorPurchaseOrder): VendorPurchaseOrder {
  return {
    ...po,
    orderDate: po.orderDate.slice(0, 10),
    expectedDate: po.expectedDate ? po.expectedDate.slice(0, 10) : undefined,
    lines: po.lines.map((l) => ({ ...l, cost: Number(l.cost) })),
  };
}

// Next vendor PO # that will be assigned, for display only (e.g. Settings'
// "next PO #" field) - doesn't reserve anything. Formatted like the actual
// PO numbers ("PO-5001").
export async function nextVendorPoNumber(): Promise<string> {
  const next = await peekNextCounterValue(VENDOR_PO_COUNTER_KEY, VENDOR_PO_START);
  return `PO-${next}`;
}

// Highest vendor PO # already in use, so an admin overriding the next
// number (see Settings) can be warned before creating a collision.
export async function maxExistingVendorPoNumber(): Promise<number> {
  const pos = await listVendorPos();
  return pos.reduce((max, p) => Math.max(max, parseInt(p.poNumber.replace(/^PO-/, ""), 10) || 0), 0);
}

export async function setNextVendorPoNumber(next: number): Promise<void> {
  await setNextCounterValue(VENDOR_PO_COUNTER_KEY, Math.max(VENDOR_PO_START, Math.floor(next)));
}

export async function listVendorPos(): Promise<VendorPurchaseOrder[]> {
  const pos = await api.get<VendorPurchaseOrder[]>("/api/vendor-purchase-orders");
  return pos.map(mapPo);
}

export async function getVendorPo(poNumber: string): Promise<VendorPurchaseOrder | undefined> {
  try {
    const po = await api.get<VendorPurchaseOrder>(`/api/vendor-purchase-orders/${encodeURIComponent(poNumber)}`);
    return mapPo(po);
  } catch {
    return undefined;
  }
}

// Creates a new vendor PO - the server assigns the real PO # atomically (and
// recomputes each affected item's qtyOnPurchaseOrder in the same
// transaction), so this takes everything except that field and returns the
// saved record (with its real poNumber) to the caller.
export async function saveVendorPo(po: Omit<VendorPurchaseOrder, "poNumber">): Promise<VendorPurchaseOrder> {
  return mapPo(await api.post<VendorPurchaseOrder>("/api/vendor-purchase-orders", po));
}

// Returns the server's copy (with its new `version`) - callers must keep
// that one, not the object they sent, or their next save is a guaranteed 409.
export async function updateVendorPo(po: VendorPurchaseOrder): Promise<VendorPurchaseOrder> {
  return mapPo(await api.put<VendorPurchaseOrder>(`/api/vendor-purchase-orders/${encodeURIComponent(po.poNumber)}`, po));
}

// Receives `lines` against `po` in one server-side transaction: rolls up
// received quantities/status, adds the units to qtyOnHand and recomputes
// qtyOnPurchaseOrder. A stale `po.version` fails the whole thing with a 409
// and changes nothing, so retrying can never double-count stock.
export async function receivePo(po: VendorPurchaseOrder, lines: VendorReceivingLine[]): Promise<VendorPurchaseOrder> {
  return mapPo(
    await api.post<VendorPurchaseOrder>(`/api/vendor-purchase-orders/${encodeURIComponent(po.poNumber)}/receive`, {
      version: po.version,
      lines: lines.filter((l) => l.qty > 0),
    })
  );
}
