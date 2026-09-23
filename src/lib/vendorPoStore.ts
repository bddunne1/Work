import type { VendorPurchaseOrder, VendorReceivingLine } from "../types";
import { receiveVendorPo, vendorPoLineOutstanding } from "../types";
import { adjustQtyOnHand, getItemByNumber, updateItem } from "./itemStore";

const VENDOR_POS_KEY = "erp_vendor_pos";
const VENDOR_PO_COUNTER_KEY = "erp_vendor_po_counter";
const VENDOR_PO_START = 5001;

function readVendorPos(): VendorPurchaseOrder[] {
  try {
    const raw = localStorage.getItem(VENDOR_POS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as VendorPurchaseOrder[];
  } catch {
    return [];
  }
}

function writeVendorPos(pos: VendorPurchaseOrder[]): void {
  try {
    localStorage.setItem(VENDOR_POS_KEY, JSON.stringify(pos));
  } catch {
    // storage unavailable (private mode, blocked site data, etc.) - no-op
  }
}

export function nextVendorPoNumber(): string {
  try {
    const raw = localStorage.getItem(VENDOR_PO_COUNTER_KEY);
    const current = raw ? parseInt(raw, 10) : VENDOR_PO_START;
    return `PO-${current}`;
  } catch {
    return `PO-${VENDOR_PO_START}`;
  }
}

// Highest vendor PO # already in use, so an admin overriding the next
// number (see Settings) can be warned before creating a collision.
export function maxExistingVendorPoNumber(): number {
  return readVendorPos().reduce((max, p) => Math.max(max, parseInt(p.poNumber.replace(/^PO-/, ""), 10) || 0), 0);
}

export function setNextVendorPoNumber(next: number): void {
  try {
    localStorage.setItem(VENDOR_PO_COUNTER_KEY, String(Math.max(VENDOR_PO_START, Math.floor(next))));
  } catch {
    // storage unavailable - no-op
  }
}

function commitVendorPoNumber(): void {
  try {
    const raw = localStorage.getItem(VENDOR_PO_COUNTER_KEY);
    const current = raw ? parseInt(raw, 10) : VENDOR_PO_START;
    localStorage.setItem(VENDOR_PO_COUNTER_KEY, String(current + 1));
  } catch {
    // storage unavailable - no-op
  }
}

export function listVendorPos(): VendorPurchaseOrder[] {
  return readVendorPos().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getVendorPo(poNumber: string): VendorPurchaseOrder | undefined {
  return readVendorPos().find((p) => p.poNumber === poNumber);
}

// Recomputes qtyOnPurchaseOrder for `itemNumber` as the sum of outstanding
// (ordered - received) quantity across every non-closed vendor PO line for
// it - this is now the source of truth instead of a manually maintained
// field, driven by whatever outbound POs actually exist.
export function recomputeQtyOnPurchaseOrder(itemNumber: string): void {
  const item = getItemByNumber(itemNumber);
  if (!item) return;
  const q = itemNumber.trim().toLowerCase();
  const outstanding = readVendorPos()
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
    updateItem({ ...item, qtyOnPurchaseOrder: outstanding });
  }
}

function affectedItemNumbers(po: VendorPurchaseOrder): string[] {
  return Array.from(new Set(po.lines.map((l) => l.itemNumber).filter(Boolean)));
}

export function saveVendorPo(po: VendorPurchaseOrder): void {
  const pos = readVendorPos();
  pos.push(po);
  writeVendorPos(pos);
  commitVendorPoNumber();
  affectedItemNumbers(po).forEach(recomputeQtyOnPurchaseOrder);
}

export function updateVendorPo(po: VendorPurchaseOrder): void {
  const pos = readVendorPos().map((p) => (p.poNumber === po.poNumber ? po : p));
  writeVendorPos(pos);
  affectedItemNumbers(po).forEach(recomputeQtyOnPurchaseOrder);
}

// Receives `lines` against `po`: rolls up received quantities/status (see
// receiveVendorPo) and, for each unit actually received, adds it straight
// to qtyOnHand and recomputes qtyOnPurchaseOrder for the affected items.
export function receivePo(po: VendorPurchaseOrder, lines: VendorReceivingLine[]): VendorPurchaseOrder {
  const updated = receiveVendorPo(po, lines);
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const line = po.lines.find((x) => x.id === l.lineId);
    if (line) adjustQtyOnHand(line.itemNumber, l.qty);
  }
  updateVendorPo(updated);
  return updated;
}
