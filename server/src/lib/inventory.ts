import { Prisma } from "@prisma/client";
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

// Takes row locks on a set of items in one fixed order before a transaction
// touches several of them. Two multi-line operations (a receipt and a
// shipment, say) that updated items in their own line order could each hold
// the row the other wanted next - a Postgres deadlock, which aborted one of
// them with a 500. Locking in id order first means they queue instead.
// A single item is locked too: the availability check needs two
// allocations of the same item to queue, not race.
export async function lockItems(tx: Tx, itemIds: (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(itemIds.filter((id): id is string => Boolean(id)))].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Item" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`);
}

// Moves qtyOnHand by `delta` inside the caller's transaction and writes the
// matching StockMovement row, so every change to stock is attributable.
// Pass `itemId` when the line already carries its catalog link; otherwise
// the item # is resolved (and an unknown item fails the whole transaction).
// Returns the item row after the move (null when delta is 0) so callers can
// refuse a result they don't accept - shipping never takes stock below zero.
export async function adjustOnHand(
  tx: Tx,
  item: { itemId?: string | null; itemNumber: string },
  delta: number,
  ctx: StockContext
): Promise<{ id: string; itemNumber: string; qtyOnHand: number } | null> {
  if (delta === 0) return null;
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
  return { id: updated.id, itemNumber: updated.itemNumber, qtyOnHand: updated.qtyOnHand };
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
// cost two full-table fetches per item). Matched on the line's catalog link,
// not its item # text, so a renamed item or a differently-cased entry can't
// leave the total stale (A-06).
export async function recomputeQtyOnPurchaseOrder(tx: Tx, itemIds: (string | null | undefined)[]): Promise<void> {
  const unique = [...new Set(itemIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;
  const lines = await tx.vendorPoLine.findMany({
    where: { itemId: { in: unique }, vendorPo: { status: { not: "CLOSED" } } },
    select: { itemId: true, orderedQty: true, receivedQty: true },
  });
  const outstanding = new Map<string, number>(unique.map((id) => [id, 0]));
  for (const l of lines) {
    if (!l.itemId) continue;
    outstanding.set(l.itemId, (outstanding.get(l.itemId) ?? 0) + Math.max(0, l.orderedQty - l.receivedQty));
  }
  for (const [itemId, qty] of outstanding) {
    const item = await tx.item.findUnique({ where: { id: itemId }, select: { qtyOnPurchaseOrder: true } });
    if (item && item.qtyOnPurchaseOrder !== qty) {
      await tx.item.update({ where: { id: itemId }, data: { qtyOnPurchaseOrder: qty, version: { increment: 1 } } });
    }
  }
}
