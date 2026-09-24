import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAnyPermission, requireAuth } from "../middleware/auth.js";
import { ConflictError, HttpError } from "../lib/conflictError.js";
import { adjustOnHand, assertAllocationAvailable } from "../lib/inventory.js";
import { syncChildren } from "../lib/syncChildren.js";
import { prisma } from "../prisma.js";

const router = Router();

// App-facing status strings <-> the Prisma enum, same translation approach
// as vendorPurchaseOrders.ts and returns.ts.
const STATUS_IN = {
  Entered: "ENTERED",
  Checked: "CHECKED",
  Allocated: "ALLOCATED",
  Backordered: "BACKORDERED",
  "Pick & Packed": "PICK_PACKED",
  Shipped: "SHIPPED",
} as const;
const STATUS_OUT: Record<string, string> = {
  ENTERED: "Entered",
  CHECKED: "Checked",
  ALLOCATED: "Allocated",
  BACKORDERED: "Backordered",
  PICK_PACKED: "Pick & Packed",
  SHIPPED: "Shipped",
};
const PICK_PACK_STATUS_IN = { Partial: "PARTIAL", Complete: "COMPLETE" } as const;
const PICK_PACK_STATUS_OUT: Record<string, string> = { PARTIAL: "Partial", COMPLETE: "Complete" };

const SO_COUNTER_KEY = "salesOrder";
const SO_START = 10001;

const addressSchema = z.object({
  name: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  notes: z.string().optional(),
});

const lineItemSchema = z.object({
  id: z.string().optional(),
  item: z.string(),
  description: z.string(),
  um: z.string().default("EA"),
  ordered: z.number().int().nonnegative(),
  rate: z.number(),
  customerPartNumber: z.string().nullish(),
});

const allocationSchema = z
  .object({
    lines: z.array(z.object({ lineItemId: z.string(), allocatedQty: z.number().int().nonnegative() })),
    fullyAllocated: z.boolean(),
    shipCompleteOnly: z.boolean().optional(),
    decidedAt: z.string(),
  })
  .nullish();

const shipmentLineSchema = z.object({ lineItemId: z.string(), qty: z.number().int().nonnegative() });

const shipmentRecordSchema = z.object({
  id: z.string().optional(),
  shippedAt: z.string(),
  lines: z.array(shipmentLineSchema),
});

const bolSchema = z
  .object({
    weight: z.string(),
    packageCount: z.string(),
    palletSlip: z.enum(["Y", "N"]),
    handlingUnitQty: z.string(),
    handlingUnitType: z.string(),
    packageQty: z.string(),
    packageType: z.string(),
    hazmat: z.boolean(),
    commodityDescription: z.string(),
    nmfcNumber: z.string(),
    freightClass: z.string(),
    additionalInfo: z.string(),
    generatedAt: z.string(),
  })
  .nullish();

const createSchema = z.object({
  poNumber: z.string().default(""),
  orderDate: z.string(),
  dueDate: z.string(),
  customerId: z.string().nullish(),
  shipToLocationId: z.string().nullish(),
  billTo: addressSchema,
  shipTo: addressSchema,
  fob: z.string().default(""),
  shipVia: z.string().default(""),
  terms: z.string().default(""),
  rep: z.string().default(""),
  taxRate: z.number().default(0),
  notes: z.string().default(""),
  lineItems: z.array(lineItemSchema).default([]),
  writtenBy: z.string().nullish(),
  writtenById: z.string().nullish(),
  writtenByColor: z.string().nullish(),
});

const updateSchema = createSchema.extend({
  status: z.enum(["Entered", "Checked", "Allocated", "Backordered", "Pick & Packed", "Shipped"]),
  checkedAt: z.string().nullish(),
  checkedBy: z.string().nullish(),
  checkedByColor: z.string().nullish(),
  allocation: allocationSchema,
  labelPrintedAt: z.string().nullish(),
  pickedAt: z.string().nullish(),
  pendingShipment: z.array(shipmentLineSchema).nullish(),
  pickListPrintedAt: z.string().nullish(),
  packingSlipPrintedAt: z.string().nullish(),
  shipmentHistory: z.array(shipmentRecordSchema).default([]),
  estimatedShipDate: z.string().nullish(),
  pickPackStatus: z.enum(["Partial", "Complete"]).nullish(),
  bol: bolSchema,
  version: z.number().int(),
  // Optional guard: the status the caller's page expected the order to be
  // in. A decision page opened from a stale queue (someone else already
  // moved the order on) gets a 409 instead of silently dragging the order
  // backwards through the workflow.
  expectedStatus: z.enum(["Entered", "Checked", "Allocated", "Backordered", "Pick & Packed", "Shipped"]).optional(),
});

const shipSchema = z.object({ version: z.number().int(), lines: z.array(shipmentLineSchema) });
const undoSchema = z.object({ version: z.number().int() });

const include = {
  lineItems: true,
  shipmentHistory: { orderBy: { shippedAt: "asc" as const } },
};

function mapOut<T extends { soNumber: number; status: string; pickPackStatus: string | null }>(order: T) {
  return {
    ...order,
    soNumber: String(order.soNumber),
    status: STATUS_OUT[order.status] ?? order.status,
    pickPackStatus: order.pickPackStatus ? (PICK_PACK_STATUS_OUT[order.pickPackStatus] ?? order.pickPackStatus) : null,
  };
}

// Orders are touched by many different pages (order entry, validation,
// allocation, pick/pack, shipping, BOL...), each gated by its own page-level
// permission. Reads stay open to any signed-in account (the Dashboard and
// several reports show orders to everyone), but writes need edit access on
// at least one page that legitimately writes orders - so a view-only
// account can no longer check, allocate or ship orders by calling the API.
const ORDER_CREATE_PAGES = ["order-entry", "import"];
const ORDER_WRITE_PAGES = [
  "order-entry",
  "order-detail",
  "validation",
  "allocation",
  "back-orders",
  "pick-pack",
  "open-picks",
  "schedule",
  "bol",
  "labels",
  "import",
];
const ORDER_SHIP_PAGES = ["open-picks", "pick-pack", "shipment-history", "order-detail"];

router.use(requireAuth);

// `?open=1` returns only orders that haven't fully shipped - everything the
// workflow queues and stock-availability math need - instead of every order
// ever entered (which grows by ~150/day and was fetched by ~20 pages).
// `?limit=N` returns just the N most recent (e.g. the Dashboard's list).
// `?open=1&shippedSince=<ISO date>` adds orders with a shipment on or after
// that date - what warehouse capacity needs for its throughput window.
router.get("/", async (req, res) => {
  const openOnly = req.query.open === "1" || req.query.open === "true";
  const limit = Number(req.query.limit);
  const since = typeof req.query.shippedSince === "string" ? new Date(req.query.shippedSince) : null;
  const shippedSince = since && !Number.isNaN(since.getTime()) ? since : null;
  const orders = await prisma.salesOrder.findMany({
    where: openOnly
      ? shippedSince
        ? { OR: [{ status: { not: "SHIPPED" } }, { shipmentHistory: { some: { shippedAt: { gte: shippedSince } } } }] }
        : { status: { not: "SHIPPED" } }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : undefined,
    include,
  });
  res.json(orders.map(mapOut));
});

router.get("/:soNumber", async (req, res) => {
  const soNumber = parseInt(req.params.soNumber, 10);
  if (!Number.isFinite(soNumber)) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const order = await prisma.salesOrder.findUnique({ where: { soNumber }, include });
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(mapOut(order));
});

// Assigns the S.O. # itself (atomically, via the shared Counter table)
// rather than trusting one the client precomputed - same reasoning as
// vendor PO and RA numbers.
router.post("/", requireAnyPermission(ORDER_CREATE_PAGES, "edit"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const order = await prisma.$transaction(async (tx) => {
    const counter = await tx.counter.upsert({
      where: { key: SO_COUNTER_KEY },
      create: { key: SO_COUNTER_KEY, value: SO_START },
      update: { value: { increment: 1 } },
    });
    return tx.salesOrder.create({
      data: {
        soNumber: counter.value,
        poNumber: data.poNumber,
        orderDate: new Date(data.orderDate),
        dueDate: new Date(data.dueDate),
        customerId: data.customerId,
        shipToLocationId: data.shipToLocationId,
        billTo: data.billTo,
        shipTo: data.shipTo,
        fob: data.fob,
        shipVia: data.shipVia,
        terms: data.terms,
        rep: data.rep,
        taxRate: data.taxRate,
        notes: data.notes,
        status: "ENTERED",
        writtenBy: data.writtenBy,
        writtenById: data.writtenById,
        writtenByColor: data.writtenByColor,
        lineItems: {
          create: data.lineItems.map((l) => ({
            item: l.item,
            description: l.description,
            um: l.um,
            ordered: l.ordered,
            rate: l.rate,
            customerPartNumber: l.customerPartNumber,
          })),
        },
      },
      include,
    });
  });
  res.status(201).json(mapOut(order));
});

router.put("/:soNumber", requireAnyPermission(ORDER_WRITE_PAGES, "edit"), async (req, res) => {
  const soNumber = parseInt(req.params.soNumber, 10);
  if (!Number.isFinite(soNumber)) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;

  const existing = await prisma.salesOrder.findUnique({ where: { soNumber }, include: { lineItems: true } });
  if (!existing) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (data.expectedStatus && STATUS_OUT[existing.status] !== data.expectedStatus) {
    res.status(409).json({
      error: `S.O. #${soNumber} is already ${STATUS_OUT[existing.status]} - someone else moved it on since you opened it. Reload and try again.`,
      conflict: true,
    });
    return;
  }
  // A shipped order only goes backwards through Undo Last Shipment (which
  // also puts the stock back) - a plain save can't un-ship it.
  if (existing.status === "SHIPPED" && data.status !== "Shipped") {
    res.status(409).json({ error: `S.O. #${soNumber} has already shipped. Use Undo Last Shipment instead.`, conflict: true });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.salesOrder.updateMany({
        where: { soNumber, version: data.version },
        data: {
          poNumber: data.poNumber,
          orderDate: new Date(data.orderDate),
          dueDate: new Date(data.dueDate),
          customerId: data.customerId,
          shipToLocationId: data.shipToLocationId,
          billTo: data.billTo,
          shipTo: data.shipTo,
          fob: data.fob,
          shipVia: data.shipVia,
          terms: data.terms,
          rep: data.rep,
          taxRate: data.taxRate,
          notes: data.notes,
          status: STATUS_IN[data.status],
          writtenBy: data.writtenBy,
          writtenById: data.writtenById,
          writtenByColor: data.writtenByColor,
          checkedAt: data.checkedAt ? new Date(data.checkedAt) : null,
          checkedBy: data.checkedBy ?? null,
          checkedByColor: data.checkedByColor ?? null,
          allocation: data.allocation ?? Prisma.JsonNull,
          labelPrintedAt: data.labelPrintedAt ? new Date(data.labelPrintedAt) : null,
          pickedAt: data.pickedAt ? new Date(data.pickedAt) : null,
          pendingShipment: data.pendingShipment ?? Prisma.JsonNull,
          pickListPrintedAt: data.pickListPrintedAt ? new Date(data.pickListPrintedAt) : null,
          packingSlipPrintedAt: data.packingSlipPrintedAt ? new Date(data.packingSlipPrintedAt) : null,
          estimatedShipDate: data.estimatedShipDate ? new Date(data.estimatedShipDate) : null,
          pickPackStatus: data.pickPackStatus ? PICK_PACK_STATUS_IN[data.pickPackStatus] : null,
          bol: data.bol ?? Prisma.JsonNull,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConflictError();
      // Line ids the caller sent that belong to a different order would be
      // "upserted" onto that other order's row - refuse instead.
      await assertChildIdsBelong(tx, soNumber, data.lineItems.map((l) => l.id), data.shipmentHistory.map((r) => r.id));
      await assertAllocationAvailable(
        tx,
        soNumber,
        { lineItems: existing.lineItems, allocation: existing.allocation, pendingShipment: existing.pendingShipment },
        {
          lineItems: data.lineItems.filter((l) => l.id).map((l) => ({ id: l.id as string, item: l.item })),
          allocation: data.allocation ?? null,
          pendingShipment: data.pendingShipment ?? null,
        }
      );
      await syncChildren(tx.salesOrderLine, soNumber, "soNumber", data.lineItems, (l) => ({
        item: l.item,
        description: l.description,
        um: l.um,
        ordered: l.ordered,
        rate: l.rate,
        customerPartNumber: l.customerPartNumber,
      }));
      await syncChildren(tx.shipmentRecord, soNumber, "soNumber", data.shipmentHistory, (r) => ({
        shippedAt: new Date(r.shippedAt),
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

  const updated = await prisma.salesOrder.findUnique({ where: { soNumber }, include });
  res.json(mapOut(updated!));
});

async function assertChildIdsBelong(
  tx: Prisma.TransactionClient,
  soNumber: number,
  lineIds: (string | undefined)[],
  shipmentIds: (string | undefined)[]
): Promise<void> {
  const ids = lineIds.filter((id): id is string => Boolean(id));
  const foreignLines = ids.length
    ? await tx.salesOrderLine.count({ where: { id: { in: ids }, soNumber: { not: soNumber } } })
    : 0;
  const sIds = shipmentIds.filter((id): id is string => Boolean(id));
  const foreignShipments = sIds.length
    ? await tx.shipmentRecord.count({ where: { id: { in: sIds }, soNumber: { not: soNumber } } })
    : 0;
  if (foreignLines + foreignShipments > 0) {
    throw new HttpError(400, "Some lines on this order belong to a different order - reload the order and try again.");
  }
}

// Locks the order row for the rest of the transaction and checks the
// caller's version, so ship/undo can't interleave with any other save.
async function lockOrder(tx: Prisma.TransactionClient, soNumber: number, version: number) {
  const rows = await tx.$queryRaw<{ version: number }[]>`SELECT "version" FROM "SalesOrder" WHERE "soNumber" = ${soNumber} FOR UPDATE`;
  if (rows.length === 0) throw new HttpError(404, "Order not found");
  if (rows[0].version !== version) throw new ConflictError();
  return tx.salesOrder.findUniqueOrThrow({ where: { soNumber }, include });
}

// Confirms a shipment: records it, rolls the order to Shipped/Backordered,
// clears the staged pendingShipment AND takes the shipped units out of
// qtyOnHand - all in one transaction. Previously the browser PATCHed stock
// line by line and then saved the order; a 409 on that save (someone else
// touched the order) left stock already decremented, and the natural retry
// decremented it a second time.
router.post("/:soNumber/ship", requireAnyPermission(ORDER_SHIP_PAGES, "edit"), async (req, res) => {
  const soNumber = parseInt(req.params.soNumber, 10);
  const parsed = shipSchema.safeParse(req.body);
  if (!Number.isFinite(soNumber) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Order not found" : parsed.error.flatten() });
    return;
  }
  const { version, lines } = parsed.data;
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, version);
    if (order.status !== "PICK_PACKED") {
      throw new HttpError(409, `S.O. #${soNumber} is ${STATUS_OUT[order.status]}, not waiting to ship - someone may have already confirmed it. Reload and check.`, { conflict: true });
    }
    const shipped = lines.filter((l) => l.qty > 0);
    const lineById = new Map(order.lineItems.map((li) => [li.id, li]));
    for (const l of shipped) {
      const li = lineById.get(l.lineItemId);
      if (!li) throw new HttpError(400, "Shipment references a line that is no longer on this order - reload and try again.");
      await adjustOnHand(tx, li.item, -l.qty);
    }
    if (shipped.length > 0) {
      await tx.shipmentRecord.create({ data: { soNumber, shippedAt: new Date(), lines: shipped } });
    }
    const history = await tx.shipmentRecord.findMany({ where: { soNumber } });
    const shippedFor = (id: string) =>
      history.reduce((sum, r) => sum + ((r.lines as { lineItemId: string; qty: number }[]).find((x) => x.lineItemId === id)?.qty ?? 0), 0);
    const fullyShipped = order.lineItems.every((li) => shippedFor(li.id) >= li.ordered);
    await tx.salesOrder.update({
      where: { soNumber },
      data: { status: fullyShipped ? "SHIPPED" : "BACKORDERED", pendingShipment: [], version: { increment: 1 } },
    });
  });
  const updated = await prisma.salesOrder.findUnique({ where: { soNumber }, include });
  res.json(mapOut(updated!));
});

// Reverses the most recent shipment: puts its units back into qtyOnHand,
// re-stages them as pendingShipment and returns the order to Pick & Packed -
// atomically, for the same reason as /ship above.
router.post("/:soNumber/undo-shipment", requireAnyPermission(ORDER_SHIP_PAGES, "edit"), async (req, res) => {
  const soNumber = parseInt(req.params.soNumber, 10);
  const parsed = undoSchema.safeParse(req.body);
  if (!Number.isFinite(soNumber) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Order not found" : parsed.error.flatten() });
    return;
  }
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, parsed.data.version);
    const last = order.shipmentHistory[order.shipmentHistory.length - 1];
    if (!last) throw new HttpError(409, "This order has no shipment to undo.", { conflict: true });
    const staged = (order.pendingShipment as { qty: number }[] | null) ?? [];
    if (staged.some((l) => l.qty > 0)) {
      // Undoing would overwrite the batch that's already packed and staged
      // (and silently drop its reservation) - make them deal with it first.
      throw new HttpError(409, "Another batch is already packed and waiting to ship on this order. Confirm or unallocate it before undoing the last shipment.", { conflict: true });
    }
    const lineById = new Map(order.lineItems.map((li) => [li.id, li]));
    const lines = last.lines as { lineItemId: string; qty: number }[];
    for (const l of lines) {
      const li = lineById.get(l.lineItemId);
      if (li && l.qty > 0) await adjustOnHand(tx, li.item, l.qty);
    }
    await tx.shipmentRecord.delete({ where: { id: last.id } });
    await tx.salesOrder.update({
      where: { soNumber },
      data: { status: "PICK_PACKED", pendingShipment: lines, version: { increment: 1 } },
    });
  });
  const updated = await prisma.salesOrder.findUnique({ where: { soNumber }, include });
  res.json(mapOut(updated!));
});

export default router;
