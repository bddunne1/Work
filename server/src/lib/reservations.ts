import { Prisma } from "@prisma/client";
import { HttpError } from "./conflictError.js";
import { lockItems } from "./inventory.js";

type Tx = Prisma.TransactionClient;

// The statuses in which an order can be holding stock. Anything else -
// entered, checked, shipped, cancelled - holds nothing whatever its JSON
// still says.
export const HOLDING_STATUSES = ["ALLOCATED", "BACKORDERED", "PICK_PACKED"] as const;

export interface HoldingOrder {
  status: string;
  lineItems: { id: string; itemId: string | null }[];
  allocation: unknown;
  pendingShipment: unknown;
}

type AllocationJson = { lines?: { lineItemId: string; allocatedQty: number }[] } | null;
type StagedLine = { lineItemId: string; qty: number };

// Units an order holds against stock, per line id: allocated but not yet
// released, plus released (staged for a pick) but not yet shipped. Release
// moves a line's quantity from the first bucket to the second, and shipping
// takes it out of qtyOnHand, so the two never overlap.
export function heldByLine(order: HoldingOrder): Map<string, number> {
  const out = new Map<string, number>();
  if (!(HOLDING_STATUSES as readonly string[]).includes(order.status)) return out;
  const lineIds = new Set(order.lineItems.map((l) => l.id));
  const add = (lineItemId: string, qty: number) => {
    if (!lineIds.has(lineItemId) || !(qty > 0)) return;
    out.set(lineItemId, (out.get(lineItemId) ?? 0) + qty);
  };
  for (const l of (order.allocation as AllocationJson)?.lines ?? []) add(l.lineItemId, l.allocatedQty);
  for (const l of (order.pendingShipment as StagedLine[] | null) ?? []) add(l.lineItemId, l.qty);
  return out;
}

// Per catalog item id, what `order` holds.
export function heldByItem(order: HoldingOrder): Map<string, number> {
  const itemOf = new Map(order.lineItems.map((l) => [l.id, l.itemId]));
  const out = new Map<string, number>();
  for (const [lineItemId, qty] of heldByLine(order)) {
    const itemId = itemOf.get(lineItemId);
    if (itemId) out.set(itemId, (out.get(itemId) ?? 0) + qty);
  }
  return out;
}

// Brings an order's Allocation rows, and every affected item's qtyReserved,
// in line with what the order now holds. Call after the order row has been
// updated, inside the same transaction, at the end of every step that can
// change what it holds (allocate, unallocate, release, trim, ship, undo,
// cancel). Items are row-locked in id order first, like every other
// multi-item update.
export async function syncReservations(tx: Tx, soNumber: number): Promise<void> {
  const order = await tx.salesOrder.findUniqueOrThrow({
    where: { soNumber },
    select: { status: true, allocation: true, pendingShipment: true, lineItems: { select: { id: true, itemId: true } }, allocations: true },
  });
  const wanted = heldByLine(order);
  const itemOf = new Map(order.lineItems.map((l) => [l.id, l.itemId]));
  const current = new Map(order.allocations.map((a) => [a.lineItemId, a]));
  const deltas = new Map<string, number>();
  const bump = (itemId: string, by: number) => deltas.set(itemId, (deltas.get(itemId) ?? 0) + by);
  const creates: { lineItemId: string; itemId: string; qty: number }[] = [];
  const updates: { id: string; itemId: string; qty: number }[] = [];
  const deletes: string[] = [];
  for (const [lineItemId, qty] of wanted) {
    const itemId = itemOf.get(lineItemId);
    if (!itemId) continue;
    const row = current.get(lineItemId);
    if (!row) {
      creates.push({ lineItemId, itemId, qty });
      bump(itemId, qty);
    } else if (row.qty !== qty || row.itemId !== itemId) {
      updates.push({ id: row.id, itemId, qty });
      bump(row.itemId, -row.qty);
      bump(itemId, qty);
    }
  }
  for (const [lineItemId, row] of current) {
    if (!wanted.has(lineItemId) || !itemOf.get(lineItemId)) {
      deletes.push(row.id);
      bump(row.itemId, -row.qty);
    }
  }
  if (creates.length + updates.length + deletes.length === 0) return;
  // Every item on the order, not just the ones changing: each command locks
  // the same full set in the same order, so two commands never hold one
  // item each while waiting for the other's (a deadlock).
  await lockItems(tx, [...order.lineItems.map((l) => l.itemId), ...order.allocations.map((a) => a.itemId)]);
  if (deletes.length > 0) await tx.allocation.deleteMany({ where: { id: { in: deletes } } });
  for (const u of updates) await tx.allocation.update({ where: { id: u.id }, data: { itemId: u.itemId, qty: u.qty } });
  if (creates.length > 0) await tx.allocation.createMany({ data: creates.map((c) => ({ soNumber, ...c })) });
  for (const [itemId, delta] of deltas) {
    if (delta !== 0) await tx.item.update({ where: { id: itemId }, data: { qtyReserved: { increment: delta } } });
  }
}

// Rejects an allocation that would hold more of an item than is free: on
// hand, less what every other open order holds (Item.qtyReserved, minus this
// order's own current rows). Only items whose hold this save increases are
// checked, so re-saving an order that is already over-committed because of
// a stock count correction isn't blocked by unrelated edits. The order's
// item rows are locked first, so two people allocating the same scarce item
// at the same moment queue instead of both being told it's available.
export async function assertAllocationAvailable(tx: Tx, soNumber: number, after: HoldingOrder): Promise<void> {
  const wanted = heldByItem(after);
  if (wanted.size === 0) return;
  const mine = new Map<string, number>();
  for (const a of await tx.allocation.findMany({ where: { soNumber }, select: { itemId: true, qty: true } })) {
    mine.set(a.itemId, (mine.get(a.itemId) ?? 0) + a.qty);
  }
  const increased = [...wanted.entries()].filter(([itemId, qty]) => qty > (mine.get(itemId) ?? 0));
  if (increased.length === 0) return;
  const ids = increased.map(([itemId]) => itemId);
  // Lock the whole order's items (see syncReservations), then read the increased ones.
  await lockItems(tx, after.lineItems.map((l) => l.itemId));
  const items = new Map((await tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, itemNumber: true, qtyOnHand: true, qtyReserved: true } })).map((i) => [i.id, i]));
  const shortages: string[] = [];
  for (const [itemId, qty] of increased) {
    const item = items.get(itemId);
    if (!item) continue;
    const available = item.qtyOnHand - (item.qtyReserved - (mine.get(itemId) ?? 0));
    if (qty > available) shortages.push(`${item.itemNumber}: ${Math.max(0, available)} available, ${qty} requested`);
  }
  if (shortages.length > 0) {
    throw new HttpError(409, `Not enough stock to allocate - someone else may have just allocated it. ${shortages.join("; ")}. Reload and try again.`, { conflict: true, shortages });
  }
}
