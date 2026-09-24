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

export interface StockContext {
  // SHIP | UNDO_SHIP | RECEIVE_PO | RETURN | ADJUST | ITEM_EDIT
  reason: string;
  refType?: string;
  refId?: string;
  actor: { id: string; username: string };
}

// Resolves an item # to its catalog row, or fails the caller's transaction
// with a message naming the item.
export async function requireItem(tx: Tx, itemNumber: string) {
  const item = await findItemByNumber(tx, itemNumber);
  if (!item) throw new HttpError(400, `Item "${itemNumber}" is not in the catalog - fix the line before continuing.`);
  return item;
}

// Moves qtyOnHand by `delta` inside the caller's transaction and writes the
// matching StockMovement row, so every change to stock is attributable.
// Pass `itemId` when the line already carries its catalog link; otherwise
// the item # is resolved (and an unknown item fails the whole transaction).
export async function adjustOnHand(
  tx: Tx,
  item: { itemId?: string | null; itemNumber: string },
  delta: number,
  ctx: StockContext
): Promise<void> {
  if (delta === 0) return;
  const target = item.itemId
    ? ((await tx.item.findUnique({ where: { id: item.itemId } })) ?? (await requireItem(tx, item.itemNumber)))
    : await requireItem(tx, item.itemNumber);
  const updated = await tx.item.update({
    where: { id: target.id },
    data: { qtyOnHand: { increment: delta }, version: { increment: 1 } },
  });
  await tx.stockMovement.create({
    data: {
      itemId: updated.id,
      itemNumber: updated.itemNumber,
      delta,
      qtyAfter: updated.qtyOnHand,
      reason: ctx.reason,
      refType: ctx.refType ?? null,
      refId: ctx.refId ?? null,
      actorId: ctx.actor.id,
      actorUsername: ctx.actor.username,
    },
  });
}

// Maps each distinct item # on a set of lines to its catalog id, failing
// with one message listing every unknown item. Used on every order / PO /
// return save so lines always carry their catalog link.
export async function resolveItemIds(tx: Tx, itemNumbers: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(itemNumbers.map((n) => n.trim()).filter(Boolean))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const rows = await tx.item.findMany({
    where: { OR: wanted.map((n) => ({ itemNumber: { equals: n, mode: "insensitive" as const } })) },
    select: { id: true, itemNumber: true },
  });
  const byLower = new Map(rows.map((r) => [r.itemNumber.toLowerCase(), r.id]));
  const missing: string[] = [];
  for (const n of wanted) {
    const id = byLower.get(n.toLowerCase());
    if (id) out.set(n.toLowerCase(), id);
    else missing.push(n);
  }
  if (missing.length > 0) {
    throw new HttpError(400, `Not in the catalog: ${missing.join(", ")}. Add ${missing.length === 1 ? "it" : "them"} under Items or correct the line${missing.length === 1 ? "" : "s"}.`, { missingItems: missing });
  }
  return out;
}

export const itemIdFor = (ids: Map<string, string>, itemNumber: string) => ids.get(itemNumber.trim().toLowerCase()) ?? null;

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
    where: { soNumber: { not: soNumber }, status: { notIn: ["SHIPPED", "CANCELLED"] } },
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
