import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireAnyPermission, requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { logAudit } from "../lib/audit.js";
import { ConflictError, HttpError } from "../lib/conflictError.js";
import { adjustOnHand, itemIdFor, recomputeQtyOnPurchaseOrder, resolveItemIds } from "../lib/inventory.js";
import { syncChildren } from "../lib/syncChildren.js";
import { prisma } from "../prisma.js";

const router = Router();

// App-facing status strings <-> the Prisma enum. Kept as a translation at
// this boundary so the rest of the app never has to know the DB spells
// "Partially Received" as PARTIALLY_RECEIVED.
const STATUS_IN = {
  Open: "OPEN",
  "Partially Received": "PARTIALLY_RECEIVED",
  Received: "RECEIVED",
  Closed: "CLOSED",
} as const;
const STATUS_OUT: Record<string, string> = {
  OPEN: "Open",
  PARTIALLY_RECEIVED: "Partially Received",
  RECEIVED: "Received",
  CLOSED: "Closed",
};

const VENDOR_PO_COUNTER_KEY = "vendorPo";
const VENDOR_PO_START = 5001;

const lineSchema = z.object({
  id: z.string().optional(),
  itemNumber: z.string(),
  description: z.string(),
  orderedQty: z.number().int().nonnegative(),
  receivedQty: z.number().int().nonnegative().default(0),
  cost: z.number(),
});

const receivingRecordSchema = z.object({
  id: z.string().optional(),
  receivedAt: z.string(),
  lines: z.array(z.object({ lineId: z.string(), qty: z.number() })),
});

const createSchema = z.object({
  vendorId: z.string(),
  vendorName: z.string(),
  orderDate: z.string(),
  expectedDate: z.string().nullish(),
  notes: z.string().default(""),
  lines: z.array(lineSchema).default([]),
});

const updateSchema = createSchema.extend({
  status: z.enum(["Open", "Partially Received", "Received", "Closed"]),
  receivingHistory: z.array(receivingRecordSchema).default([]),
  version: z.number().int(),
});

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
router.get("/", requireAnyPermission(PO_VIEW_PAGES, "view"), async (req, res) => {
  const openOnly = req.query.open === "1" || req.query.open === "true";
  const pos = await prisma.vendorPurchaseOrder.findMany({
    where: openOnly ? { status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } } : undefined,
    orderBy: { createdAt: "desc" },
    include,
  });
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
router.post("/", requirePermission("purchase-orders", "edit"), async (req: AuthedRequest, res) => {
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
            receivedQty: l.receivedQty,
            cost: l.cost,
          })),
        },
      },
      include,
    });
    await recomputeQtyOnPurchaseOrder(tx, created.lines.map((l) => l.itemNumber));
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

  const existing = await prisma.vendorPurchaseOrder.findUnique({ where: { poNumber } });
  if (!existing) {
    res.status(404).json({ error: "Purchase order not found" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.vendorPurchaseOrder.updateMany({
        where: { poNumber, version: data.version },
        data: {
          vendorId: data.vendorId,
          vendorName: data.vendorName,
          orderDate: new Date(data.orderDate),
          expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
          status: STATUS_IN[data.status],
          notes: data.notes,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConflictError();
      const itemIds = await resolveItemIds(tx, data.lines.map((l) => l.itemNumber));
      const beforeItems = (await tx.vendorPoLine.findMany({ where: { poNumber }, select: { itemNumber: true } })).map((l) => l.itemNumber);
      await syncChildren(tx.vendorPoLine, poNumber, "poNumber", data.lines, (l) => ({
        itemId: itemIdFor(itemIds, l.itemNumber),
        itemNumber: l.itemNumber,
        description: l.description,
        orderedQty: l.orderedQty,
        receivedQty: l.receivedQty,
        cost: l.cost,
      }));
      await syncChildren(tx.vendorReceivingRecord, poNumber, "poNumber", data.receivingHistory, (r) => ({
        receivedAt: new Date(r.receivedAt),
        lines: r.lines,
      }));
      // Items removed from the PO need their on-order total dropped too.
      await recomputeQtyOnPurchaseOrder(tx, [...beforeItems, ...data.lines.map((l) => l.itemNumber)]);
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message, conflict: true });
      return;
    }
    throw err;
  }

  logAudit(req.account!, "VENDOR_PO_UPDATED", "vendor-po", poNumber, poNumber, { status: data.status });
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
    if (received.length === 0) return;
    const poLines = await tx.vendorPoLine.findMany({ where: { poNumber } });
    const byId = new Map(poLines.map((l) => [l.id, l]));
    for (const r of received) {
      const line = byId.get(r.lineId);
      if (!line) throw new HttpError(400, "Receipt references a line that is no longer on this PO - reload and try again.");
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
    const full = poLines.every((l) => l.receivedQty >= l.orderedQty);
    const any = poLines.some((l) => l.receivedQty > 0);
    await tx.vendorPurchaseOrder.update({
      where: { poNumber },
      data: { status: full ? "RECEIVED" : any ? "PARTIALLY_RECEIVED" : undefined, version: { increment: 1 } },
    });
    await recomputeQtyOnPurchaseOrder(tx, poLines.map((l) => l.itemNumber));
    logAudit(req.account!, "VENDOR_PO_RECEIVED", "vendor-po", poNumber, poNumber, {
      units: received.reduce((sum, l) => sum + l.qty, 0),
      lines: received.length,
    });
  });
  const updated = await prisma.vendorPurchaseOrder.findUnique({ where: { poNumber }, include });
  res.json(mapOut(updated!));
});

export default router;
