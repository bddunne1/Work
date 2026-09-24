import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { ConflictError } from "../lib/conflictError.js";
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
  orderedQty: z.number().int(),
  receivedQty: z.number().int().default(0),
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

const include = {
  lines: true,
  receivingHistory: { orderBy: { receivedAt: "asc" as const } },
};

function mapOut<T extends { status: string }>(po: T) {
  return { ...po, status: STATUS_OUT[po.status] ?? po.status };
}

router.use(requireAuth);

router.get("/", requirePermission("purchase-orders", "view"), async (_req, res) => {
  const pos = await prisma.vendorPurchaseOrder.findMany({ orderBy: { createdAt: "desc" }, include });
  res.json(pos.map(mapOut));
});

router.get("/:poNumber", requirePermission("purchase-orders", "view"), async (req, res) => {
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
router.post("/", requirePermission("purchase-orders", "edit"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const po = await prisma.$transaction(async (tx) => {
    const counter = await tx.counter.upsert({
      where: { key: VENDOR_PO_COUNTER_KEY },
      create: { key: VENDOR_PO_COUNTER_KEY, value: VENDOR_PO_START },
      update: { value: { increment: 1 } },
    });
    return tx.vendorPurchaseOrder.create({
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
  });
  res.status(201).json(mapOut(po));
});

router.put("/:poNumber", requirePermission("purchase-orders", "edit"), async (req, res) => {
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
      await syncChildren(tx.vendorPoLine, poNumber, "poNumber", data.lines, (l) => ({
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
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message, conflict: true });
      return;
    }
    throw err;
  }

  const updated = await prisma.vendorPurchaseOrder.findUnique({ where: { poNumber }, include });
  res.json(mapOut(updated!));
});

export default router;
