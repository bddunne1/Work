import type { Prisma } from "@prisma/client";
import { HttpError } from "./conflictError.js";

type Tx = Prisma.TransactionClient;

// Order lines and PO lines reference items by item # string (not a foreign
// key), and the frontend has always matched them case/whitespace-
// insensitively - do the same here so a line typed "br-1001 " still finds
// BR-1001.
export async function findItemByNumber(tx: Tx, itemNumber: string) {
  const exact = await tx.item.findUnique({ where: { itemNumber } });
  if (exact) return exact;
  return tx.item.findFirst({ where: { itemNumber: { equals: itemNumber.trim(), mode: "insensitive" } } });
}

// Moves qtyOnHand by `delta` inside the caller's transaction. Fails the
// whole transaction (so nothing else in it sticks either) when the item
// isn't in the catalog.
export async function adjustOnHand(tx: Tx, itemNumber: string, delta: number): Promise<void> {
  if (delta === 0) return;
  const item = await findItemByNumber(tx, itemNumber);
  if (!item) throw new HttpError(400, `Item "${itemNumber}" is not in the catalog - fix the line before continuing.`);
  await tx.item.update({
    where: { id: item.id },
    data: { qtyOnHand: { increment: delta }, version: { increment: 1 } },
  });
}

// qtyOnPurchaseOrder is a cached total of what's still outstanding on every
// non-closed vendor PO. Recomputed here, in the same transaction as whatever
// changed a PO, instead of by the browser after the fact (which raced and
// cost two full-table fetches per item).
export async function recomputeQtyOnPurchaseOrder(tx: Tx, itemNumbers: string[]): Promise<void> {
  const unique = [...new Set(itemNumbers.filter(Boolean))];
  if (unique.length === 0) return;
  const lines = await tx.vendorPoLine.findMany({
    where: { itemNumber: { in: unique }, vendorPo: { status: { not: "CLOSED" } } },
    select: { itemNumber: true, orderedQty: true, receivedQty: true },
  });
  const outstanding = new Map<string, number>(unique.map((n) => [n, 0]));
  for (const l of lines) {
    outstanding.set(l.itemNumber, (outstanding.get(l.itemNumber) ?? 0) + Math.max(0, l.orderedQty - l.receivedQty));
  }
  for (const [itemNumber, qty] of outstanding) {
    const item = await findItemByNumber(tx, itemNumber);
    if (item && item.qtyOnPurchaseOrder !== qty) {
      await tx.item.update({ where: { id: item.id }, data: { qtyOnPurchaseOrder: qty, version: { increment: 1 } } });
    }
  }
}

interface ReservingOrder {
  lineItems: { id: string; item: string }[];
  allocation: unknown;
  pendingShipment: unknown;
}

// Units an order is holding against stock, per item # (lowercased):
// allocated-not-yet-packed plus packed-not-yet-shipped - the same rule as
// the frontend's reservedQtyFor/qtyAllocatedOnOrders in src/types.ts.
export function reservedByItem(order: ReservingOrder): Map<string, number> {
  const itemOf = new Map(order.lineItems.map((l) => [l.id, l.item.trim().toLowerCase()]));
  const out = new Map<string, number>();
  const add = (lineItemId: string, qty: number) => {
    const item = itemOf.get(lineItemId);
    if (!item || !(qty > 0)) return;
    out.set(item, (out.get(item) ?? 0) + qty);
  };
  const allocation = order.allocation as { lines?: { lineItemId: string; allocatedQty: number }[] } | null;
  for (const l of allocation?.lines ?? []) add(l.lineItemId, l.allocatedQty);
  for (const l of (order.pendingShipment as { lineItemId: string; qty: number }[] | null) ?? []) add(l.lineItemId, l.qty);
  return out;
}

// Advisory lock key serializing every save that *increases* an order's
// reservation, so two people allocating the same scarce item at the same
// moment can't both be told it's available.
const ALLOCATION_LOCK = 7_310_001;

// Rejects a save that would reserve more of an item than is actually free
// (on hand, less what every other open order already holds). Only checks
// items whose reservation this save increases, so re-saving an order that
// was already over-committed for some other reason (e.g. a stock count
// correction) isn't blocked by unrelated edits.
export async function assertAllocationAvailable(
  tx: Tx,
  soNumber: number,
  before: ReservingOrder,
  after: ReservingOrder
): Promise<void> {
  const prev = reservedByItem(before);
  const next = reservedByItem(after);
  const increased = [...next.entries()].filter(([item, qty]) => qty > (prev.get(item) ?? 0));
  if (increased.length === 0) return;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ALLOCATION_LOCK})`;

  const others = await tx.salesOrder.findMany({
    where: { soNumber: { not: soNumber }, status: { not: "SHIPPED" } },
    select: { allocation: true, pendingShipment: true, lineItems: { select: { id: true, item: true } } },
  });
  const heldElsewhere = new Map<string, number>();
  for (const o of others) {
    for (const [item, qty] of reservedByItem(o)) heldElsewhere.set(item, (heldElsewhere.get(item) ?? 0) + qty);
  }

  const shortages: string[] = [];
  for (const [item, qty] of increased) {
    const catalogItem = await findItemByNumber(tx, item);
    const onHand = catalogItem?.qtyOnHand ?? 0;
    const available = onHand - (heldElsewhere.get(item) ?? 0);
    if (qty > available) {
      shortages.push(`${catalogItem?.itemNumber ?? item}: ${Math.max(0, available)} available, ${qty} requested`);
    }
  }
  if (shortages.length > 0) {
    throw new HttpError(
      409,
      `Not enough stock to allocate - someone else may have just allocated it. ${shortages.join("; ")}. Reload and try again.`,
      { conflict: true, shortages }
    );
  }
}
