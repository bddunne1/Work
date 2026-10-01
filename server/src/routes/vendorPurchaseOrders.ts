import { Router } from "express";
import { z } from "zod";
import { isoDate } from "../lib/dates.js";
import type { Prisma } from "@prisma/client";
import { requireAnyPermission, requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { idempotent } from "../middleware/idempotency.js";
import { auditIn, logAudit } from "../lib/audit.js";
import { ConflictError, HttpError } from "../lib/conflictError.js";
import { adjustOnHand, itemIdFor, lockItems, recomputeQtyOnPurchaseOrder, resolveItemIds } from "../lib/inventory.js";
import { syncChildren } from "../lib/syncChildren.js";
import { prisma } from "../prisma.js";

const router = Router();

// App-facing status strings <- the Prisma enum. Kept as a translation at
// this boundary so the rest of the app never has to know the DB spells
// "Partially Received" as PARTIALLY_RECEIVED. Inbound status is derived
// from the lines (see derivedStatus), never mapped from the client.
const STATUS_OUT: Record<string, string> = {
  OPEN: "Open",
  PARTIALLY_RECEIVED: "Partially Received",
  RECEIVED: "Received",
  CLOSED: "Closed",
};

const VENDOR_PO_COUNTER_KEY = "vendorPo";
const VENDOR_PO_START = 5001;

// What a PO's author may set on a line. `receivedQty` is server-owned: it
// only moves through POST /:po/receive, in the same transaction as the
// stock it represents (R5-03). If a client sends it, zod strips it.
const lineSchema = z.object({
  id: z.string().optional(),
  itemNumber: z.string().min(1).max(100),
  description: z.string().max(500),
  orderedQty: z.number().int().positive(),
  cost: z.number().finite().nonnegative(),
});

const createSchema = z.object({
  vendorId: z.string(),
  vendorName: z.string().max(200),
  orderDate: isoDate,
  expectedDate: isoDate.nullish(),
  notes: z.string().max(5000).default(""),
  lines: z.array(lineSchema).max(500).default([]),
});

// The only status a plain save may set is Closed (or Open, to reopen a
// closed PO); Partially Received / Received are derived from the lines.
// Receiving history is server-owned and ignored if sent.
const updateSchema = createSchema.extend({
  status: z.enum(["Open", "Partially Received", "Received", "Closed"]).optional(),
  version: z.number().int(),
});

type DbStatus = "OPEN" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED";
function derivedStatus(lines: { orderedQty: number; receivedQty: number }[]): DbStatus {
  if (lines.length > 0 && lines.every((l) => l.receivedQty >= l.orderedQty)) return "RECEIVED";
  if (lines.some((l) => l.receivedQty > 0)) return "PARTIALLY_RECEIVED";
  return "OPEN";
}

const receiveSchema = z.object({
  version: z.number().int(),
  lines: z.array(z.object({ lineId: z.string(), qty: z.number().int().nonnegative() })),
});

// Who can see vendor POs: purchasing, plus the pages that show PO data as
// context - receiving (the dock works from the PO list), the back order
// queue (ETAs) and catalog/inventory (on-order quantities, Item Quick Report).
const PO_VIEW_PAGES = ["purchase-orders", "receiving", "back-orders", "catalog", "inventory"];
const PO_RECEIVE_PAGES = ["receiving", "purchase-orders"];

const include = {
  lines: true,
  receivingHistory: { orderBy: { receivedAt: "asc" as const } },
};

function mapOut<T extends { status: string }>(po: T) {
  return { ...po, status: STATUS_OUT[po.status] ?? po.status };
}

router.use(requireAuth);

// `?open=1` returns only POs still waiting on stock (Open / Partially
// Received) - what the Dashboard's receiving numbers need - instead of every
// PO ever written.
// Plain: every PO (or `?open=1` the open ones). With `?page=N` the list is
// paged and searched on the server - `{ rows, total, page, pageSize }` -
// so the Purchase Orders page stops downloading every PO ever written
// (PF-03). `q` matches the PO # or the vendor name.
router.get("/", requireAnyPermission(PO_VIEW_PAGES, "view"), async (req, res) => {
  const openOnly = req.query.open === "1" || req.query.open === "true";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const where: Prisma.VendorPurchaseOrderWhereInput = {
    ...(openOnly ? { status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } } : {}),
    ...(q ? { OR: [{ poNumber: { contains: q, mode: "insensitive" } }, { vendorName: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const page = Number(req.query.page);
  if (Number.isInteger(page) && page > 0) {
    const pageSize = Math.min(Math.max(1, Number(req.query.pageSize) || 50), 500);
    const [rows, total] = await Promise.all([
      prisma.vendorPurchaseOrder.findMany({ where, orderBy: { createdAt: "desc" }, include, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.vendorPurchaseOrder.count({ where }),
    ]);
    res.json({ rows: rows.map(mapOut), total, page, pageSize });
    return;
  }
  const pos = await prisma.vendorPurchaseOrder.findMany({ where, orderBy: { createdAt: "desc" }, include });
  res.json(pos.map(mapOut));
});

router.get("/:poNumber", requireAnyPermission(PO_VIEW_PAGES, "view"), async (req, res) => {
  const po = await prisma.vendorPurchaseOrder.findUnique({ where: { poNumber: req.params.poNumber }, include });
  if (!po) {
    res.status(404).json({ error: "Purchase order not found" });
    return;
  }
  res.json(mapOut(po));
});

// Assigns the PO number itself (atomically, via the shared Counter table)
// rather than trusting one the client precomputed - two people saving a new
// PO at the same moment can never land on the same number.
router.post("/", requirePermission("purchase-orders", "edit"), idempotent("vendor-po"), async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const po = await prisma.$transaction(async (tx) => {
    const itemIds = await resolveItemIds(tx, data.lines.map((l) => l.itemNumber));
    const counter = await tx.counter.upsert({
      where: { key: VENDOR_PO_COUNTER_KEY },
      create: { key: VENDOR_PO_COUNTER_KEY, value: VENDOR_PO_START },
      update: { value: { increment: 1 } },
    });
    const created = await tx.vendorPurchaseOrder.create({
      data: {
        poNumber: `PO-${counter.value}`,
        vendorId: data.vendorId,
        vendorName: data.vendorName,
        orderDate: new Date(data.orderDate),
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
        status: "OPEN",
        notes: data.notes,
        lines: {
          create: data.lines.map((l) => ({
            itemId: itemIdFor(itemIds, l.itemNumber),
            itemNumber: l.itemNumber,
            description: l.description,
            orderedQty: l.orderedQty,
            receivedQty: 0,
            cost: l.cost,
          })),
        },
      },
      include,
    });
    await recomputeQtyOnPurchaseOrder(tx, created.lines.map((l) => l.itemId));
    return created;
  });
  logAudit(req.account!, "VENDOR_PO_CREATED", "vendor-po", po.poNumber, po.poNumber, { vendor: po.vendorName, lines: po.lines.length });
  res.status(201).json(mapOut(po));
});

router.put("/:poNumber", requirePermission("purchase-orders", "edit"), async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const poNumber = req.params.poNumber;

  const existing = await prisma.vendorPurchaseOrder.findUnique({ where: { poNumber }, include: { lines: true } });
  if (!existing) {
    res.status(404).json({ error: "Purchase order not found" });
    return;
  }

  let finalStatus: DbStatus = existing.status;
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ version: number }[]>`SELECT "version" FROM "VendorPurchaseOrder" WHERE "poNumber" = ${poNumber} FOR UPDATE`;
      if (rows.length === 0) throw new HttpError(404, "Purchase order not found");
      if (rows[0].version !== data.version) throw new ConflictError();

      // Lines that have received stock are part of the record: they stay,
      // keep their item, and can't be cut below what has arrived.
      const before = new Map(existing.lines.map((l) => [l.id, l]));
      const after = new Map(data.lines.filter((l) => l.id).map((l) => [l.id as string, l]));
      for (const l of existing.lines) {
        if (l.receivedQty <= 0) continue;
        const a = after.get(l.id);
        if (!a) throw new HttpError(409, `${l.itemNumber} on ${poNumber} has already received ${l.receivedQty} and can't be removed.`, { conflict: true });
        if (a.itemNumber.trim().toLowerCase() !== l.itemNumber.trim().toLowerCase()) {
          throw new HttpError(409, `${l.itemNumber} on ${poNumber} has already received stock and can't be changed to another item.`, { conflict: true });
        }
        // Lowering the quantity under what has arrived is refused; an unchanged
        // quantity that an allowed over-receipt already exceeds is fine.
        if (a.orderedQty < l.receivedQty && a.orderedQty !== l.orderedQty) throw new HttpError(409, `${l.itemNumber} on ${poNumber} has already received ${l.receivedQty} - ordered can't go below that.`, { conflict: true });
      }
      const ids = [...after.keys()];
      if (ids.length > 0) {
        const foreign = await tx.vendorPoLine.count({ where: { id: { in: ids }, poNumber: { not: poNumber } } });
        if (foreign > 0) throw new HttpError(400, "Some lines on this PO belong to a different PO - reload and try again.");
      }

      const merged = data.lines.map((l) => ({ orderedQty: l.orderedQty, receivedQty: (l.id && before.get(l.id)?.receivedQty) || 0 }));
      const derived = derivedStatus(merged);
      if (data.status === "Closed") finalStatus = "CLOSED";
      else if (data.status === "Open" || data.status === undefined) finalStatus = existing.status === "CLOSED" && data.status === undefined ? "CLOSED" : derived;
      else finalStatus = derived; // "Received" / "Partially Received" are never taken from the client

      await tx.vendorPurchaseOrder.update({
        where: { poNumber },
        data: {
          vendorId: data.vendorId,
          vendorName: data.vendorName,
          orderDate: new Date(data.orderDate),
          expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
          status: finalStatus,
          notes: data.notes,
          version: { increment: 1 },
        },
      });
      const itemIds = await resolveItemIds(tx, data.lines.map((l) => l.itemNumber));
      const beforeItems = existing.lines.map((l) => l.itemId);
      await syncChildren(tx.vendorPoLine, poNumber, "poNumber", data.lines, (l) => ({
        itemId: itemIdFor(itemIds, l.itemNumber),
        itemNumber: l.itemNumber,
        description: l.description,
        orderedQty: l.orderedQty,
        receivedQty: (l.id && before.get(l.id)?.receivedQty) || 0,
        cost: l.cost,
      }));
      // Items removed from the PO need their on-order total dropped too.
      await recomputeQtyOnPurchaseOrder(tx, [...beforeItems, ...data.lines.map((l) => itemIdFor(itemIds, l.itemNumber))]);
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message, conflict: true });
      return;
    }
    throw err;
  }

  logAudit(req.account!, "VENDOR_PO_UPDATED", "vendor-po", poNumber, poNumber, {
    status: STATUS_OUT[finalStatus],
    ...(existing.status !== finalStatus ? { from: STATUS_OUT[existing.status] } : {}),
  });
  const updated = await prisma.vendorPurchaseOrder.findUnique({ where: { poNumber }, include });
  res.json(mapOut(updated!));
});

// Receives stock against a PO in one transaction: bumps each line's
// receivedQty, records the receipt, rolls up the PO status, adds the units
// to qtyOnHand and recomputes qtyOnPurchaseOrder. Replaces the browser doing
// per-line stock PATCHes followed by a separate version-checked PO save -
// where a 409 on the save left stock already added and a retry added it
// again.
router.post("/:poNumber/receive", requireAnyPermission(PO_RECEIVE_PAGES, "edit"), async (req: AuthedRequest, res) => {
  const parsed = receiveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const poNumber = req.params.poNumber;
  const { version, lines } = parsed.data;
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const rows = await tx.$queryRaw<{ version: number; status: string }[]>`SELECT "version", "status"::text AS "status" FROM "VendorPurchaseOrder" WHERE "poNumber" = ${poNumber} FOR UPDATE`;
    if (rows.length === 0) throw new HttpError(404, "Purchase order not found");
    if (rows[0].version !== version) throw new ConflictError();
    if (rows[0].status === "CLOSED") throw new HttpError(409, `${poNumber} is closed - reopen it before receiving against it.`, { conflict: true });

    const received = lines.filter((l) => l.qty > 0);
    if (received.length === 0) throw new HttpError(400, "Nothing to receive - every line is 0.");
    const poLines = await tx.vendorPoLine.findMany({ where: { poNumber } });
    const byId = new Map(poLines.map((l) => [l.id, l]));
    const seen = new Set<string>();
    await lockItems(tx, received.map((r) => byId.get(r.lineId)?.itemId));
    for (const r of received) {
      const line = byId.get(r.lineId);
      if (!line) throw new HttpError(400, "Receipt references a line that is no longer on this PO - reload and try again.");
      if (seen.has(r.lineId)) throw new HttpError(400, `${line.itemNumber} appears twice in this receipt.`);
      seen.add(r.lineId);
      // Over-receipt happens (a vendor ships a full case), but not by an
      // order of magnitude: a typo shouldn't add a thousand units to stock.
      const outstanding = Math.max(0, line.orderedQty - line.receivedQty);
      if (r.qty > outstanding + Math.max(10, Math.ceil(line.orderedQty * 0.1))) {
        throw new HttpError(400, `${line.itemNumber}: ${outstanding} outstanding on ${poNumber}, ${r.qty} entered. Change the PO quantity first if the vendor really sent that many.`);
      }
      await tx.vendorPoLine.update({ where: { id: line.id }, data: { receivedQty: { increment: r.qty } } });
      line.receivedQty += r.qty;
      await adjustOnHand(tx, { itemId: line.itemId, itemNumber: line.itemNumber }, r.qty, {
        reason: "RECEIVE_PO",
        refType: "vendor-po",
        refId: poNumber,
        actor: req.account!,
      });
    }
    await tx.vendorReceivingRecord.create({ data: { poNumber, receivedAt: new Date(), lines: received } });
    await tx.vendorPurchaseOrder.update({
      where: { poNumber },
      data: { status: derivedStatus(poLines), version: { increment: 1 } },
    });
    await recomputeQtyOnPurchaseOrder(tx, poLines.map((l) => l.itemId));
    // Back orders waiting on what just arrived are flagged for an analyst,
    // never filled by the system (decided 1 Oct, G-06).
    const arrivedItems = [...new Set(received.map((r) => byId.get(r.lineId)?.itemId).filter((id): id is string => Boolean(id)))];
    const flagged = arrivedItems.length
      ? await tx.salesOrder.updateMany({
          where: { status: "BACKORDERED", lineItems: { some: { itemId: { in: arrivedItems } } } },
          data: { stockArrivedAt: new Date() },
        })
      : { count: 0 };
    await auditIn(tx, req.account!, "VENDOR_PO_RECEIVED", "vendor-po", poNumber, poNumber, {
      units: received.reduce((sum, l) => sum + l.qty, 0),
      lines: received.length,
      backOrdersFlagged: flagged.count,
    });
  });
  const updated = await prisma.vendorPurchaseOrder.findUnique({ where: { poNumber }, include });
  res.json(mapOut(updated!));
});

export default router;
