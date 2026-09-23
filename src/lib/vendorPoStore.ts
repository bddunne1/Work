import { api } from "./apiClient";
import { peekNextCounterValue, setNextCounterValue } from "./counterStore";
import type { VendorPurchaseOrder, VendorReceivingLine } from "../types";
import { receiveVendorPo, vendorPoLineOutstanding } from "../types";
import { adjustQtyOnHand, getItemByNumber, setQtyOnPurchaseOrder } from "./itemStore";

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

// Recomputes qtyOnPurchaseOrder for `itemNumber` as the sum of outstanding
// (ordered - received) quantity across every non-closed vendor PO line for
// it - this is now the source of truth instead of a manually maintained
// field, driven by whatever outbound POs actually exist.
export async function recomputeQtyOnPurchaseOrder(itemNumber: string): Promise<void> {
  const item = await getItemByNumber(itemNumber);
  if (!item) return;
  const q = itemNumber.trim().toLowerCase();
  const pos = await listVendorPos();
  const outstanding = pos
    .filter((po) => po.status !== "Closed")
    .reduce(
      (sum, po) =>
        sum +
        po.lines
          .filter((l) => l.itemNumber.trim().toLowerCase() === q)
          .reduce((lineSum, l) => lineSum + vendorPoLineOutstanding(l), 0),
      0
    );
  if (item.qtyOnPurchaseOrder !== outstanding) {
    await setQtyOnPurchaseOrder(itemNumber, outstanding);
  }
}

function affectedItemNumbers(po: VendorPurchaseOrder): string[] {
  return Array.from(new Set(po.lines.map((l) => l.itemNumber).filter(Boolean)));
}

// Creates a new vendor PO - the server assigns the real PO # atomically, so
// this takes everything except that field and returns the saved record
// (with its real poNumber) to the caller.
export async function saveVendorPo(po: Omit<VendorPurchaseOrder, "poNumber">): Promise<VendorPurchaseOrder> {
  const saved = mapPo(await api.post<VendorPurchaseOrder>("/api/vendor-purchase-orders", po));
  await Promise.all(affectedItemNumbers(saved).map(recomputeQtyOnPurchaseOrder));
  return saved;
}

export async function updateVendorPo(po: VendorPurchaseOrder): Promise<void> {
  await api.put(`/api/vendor-purchase-orders/${encodeURIComponent(po.poNumber)}`, po);
  await Promise.all(affectedItemNumbers(po).map(recomputeQtyOnPurchaseOrder));
}

// Receives `lines` against `po`: rolls up received quantities/status (see
// receiveVendorPo) and, for each unit actually received, adds it straight
// to qtyOnHand and recomputes qtyOnPurchaseOrder for the affected items.
export async function receivePo(po: VendorPurchaseOrder, lines: VendorReceivingLine[]): Promise<VendorPurchaseOrder> {
  const updated = receiveVendorPo(po, lines);
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const line = po.lines.find((x) => x.id === l.lineId);
    if (line) await adjustQtyOnHand(line.itemNumber, l.qty);
  }
  await updateVendorPo(updated);
  return updated;
}
