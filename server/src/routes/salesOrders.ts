import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { hasPermission, requireAnyPermission, requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { logAudit } from "../lib/audit.js";
import { ConflictError, HttpError } from "../lib/conflictError.js";
import { adjustOnHand, assertAllocationAvailable, itemIdFor, resolveItemIds } from "../lib/inventory.js";
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
  Cancelled: "CANCELLED",
} as const;
const STATUS_OUT: Record<string, string> = {
  ENTERED: "Entered",
  CHECKED: "Checked",
  ALLOCATED: "Allocated",
  BACKORDERED: "Backordered",
  PICK_PACKED: "Pick & Packed",
  SHIPPED: "Shipped",
  CANCELLED: "Cancelled",
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
  status: z.enum(["Entered", "Checked", "Allocated", "Backordered", "Pick & Packed", "Shipped", "Cancelled"]),
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
  expectedStatus: z.enum(["Entered", "Checked", "Allocated", "Backordered", "Pick & Packed", "Shipped", "Cancelled"]).optional(),
});

const shipSchema = z.object({ version: z.number().int(), lines: z.array(shipmentLineSchema) });
const undoSchema = z.object({ version: z.number().int() });
const cancelSchema = z.object({ version: z.number().int(), reason: z.string().trim().min(1, "Give a reason for cancelling") });
const releaseSchema = z.object({
  orders: z
    .array(
      z.object({
        soNumber: z.union([z.string(), z.number()]),
        version: z.number().int(),
        // Per-line release quantities. Omitted = release everything that's
        // allocated; a line left out (or at 0) isn't released this time.
        lines: z.array(shipmentLineSchema).optional(),
      })
    )
    .min(1)
    .max(200),
});

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
  "pick-release",
  "open-picks",
  "schedule",
  "bol",
  "labels",
  "import",
];
// Confirming or undoing a shipment is logistics' job (Open Picks /
// Shipment History) - not something order entry or pick release can do.
const ORDER_SHIP_PAGES = ["open-picks", "shipment-history"];
// Cancelling: customer service (order detail) or the analysts who own
// allocation.
const ORDER_CANCEL_PAGES = ["order-detail", "allocation"];

type DbStatus = keyof typeof STATUS_OUT;
// Which workflow step a status change is, and whose job it is. A plain save
// that keeps the status needs edit access on any order page (ORDER_WRITE_PAGES);
// a change of status needs the page that owns that step - e.g. order entry
// can't validate, and nobody can move an order sideways past a step.
// Shipping, un-shipping and cancelling go through their own endpoints.
const TRANSITIONS: Partial<Record<DbStatus, Partial<Record<DbStatus, string[]>>>> = {
  ENTERED: { CHECKED: ["validation"] },
  CHECKED: { ALLOCATED: ["allocation", "back-orders"], BACKORDERED: ["allocation", "back-orders"], ENTERED: ["validation"] },
  BACKORDERED: { ALLOCATED: ["allocation", "back-orders"] },
  ALLOCATED: { PICK_PACKED: ["pick-release"], CHECKED: ["pick-release", "allocation"], BACKORDERED: ["allocation", "back-orders"] },
  PICK_PACKED: { CHECKED: ["pick-release", "allocation"] },
};

function assertTransitionAllowed(account: NonNullable<AuthedRequest["account"]>, from: DbStatus, to: DbStatus): void {
  if (from === to) return;
  const pages = TRANSITIONS[from]?.[to];
  if (!pages) {
    throw new HttpError(409, `An order can't go from ${STATUS_OUT[from]} to ${STATUS_OUT[to]} directly.`, { conflict: true });
  }
  if (!pages.some((key) => hasPermission(account, key, "edit"))) {
    throw new HttpError(403, `Moving an order from ${STATUS_OUT[from]} to ${STATUS_OUT[to]} needs edit access to ${pages.join(" or ")}.`);
  }
}

router.use(requireAuth);

// `?open=1` returns only orders that haven't fully shipped (or been cancelled) - everything the
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
        ? { OR: [{ status: { notIn: ["SHIPPED", "CANCELLED"] } }, { shipmentHistory: { some: { shippedAt: { gte: shippedSince } } } }] }
        : { status: { notIn: ["SHIPPED", "CANCELLED"] } }
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
router.post("/", requireAnyPermission(ORDER_CREATE_PAGES, "edit"), async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const order = await prisma.$transaction(async (tx) => {
    const itemIds = await resolveItemIds(tx, data.lineItems.map((l) => l.item));
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
            itemId: itemIdFor(itemIds, l.item),
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
  logAudit(req.account!, "ORDER_CREATED", "sales-order", String(order.soNumber), `S.O. #${order.soNumber}`, {
    poNumber: order.poNumber,
    customer: (order.billTo as { name?: string }).name,
    lines: order.lineItems.length,
  });
  res.status(201).json(mapOut(order));
});

router.put("/:soNumber", requireAnyPermission(ORDER_WRITE_PAGES, "edit"), async (req: AuthedRequest, res) => {
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
  if (existing.status === "CANCELLED") {
    res.status(409).json({ error: `S.O. #${soNumber} was cancelled and can't be changed.`, conflict: true });
    return;
  }
  const toStatus = STATUS_IN[data.status] as DbStatus;
  if (toStatus === "SHIPPED" && existing.status !== "SHIPPED") {
    res.status(409).json({ error: "Confirm shipments from Open Picks - a plain save can't mark an order shipped.", conflict: true });
    return;
  }
  if (toStatus === "CANCELLED") {
    res.status(409).json({ error: "Use Cancel Order to cancel - it records a reason and releases the stock.", conflict: true });
    return;
  }
  assertTransitionAllowed(req.account!, existing.status as DbStatus, toStatus);
  // Once stock is committed to an order, its lines are frozen: changing a
  // quantity or item under an allocation or a packed pick leaves them out of
  // step. Unallocate first (back to Checked), then edit.
  if (!["ENTERED", "CHECKED"].includes(existing.status)) {
    const before = new Map(existing.lineItems.map((l) => [l.id, `${l.item.trim().toLowerCase()}|${l.ordered}`]));
    const after = new Map(data.lineItems.filter((l) => l.id).map((l) => [l.id as string, `${l.item.trim().toLowerCase()}|${l.ordered}`]));
    const linesChanged =
      before.size !== data.lineItems.length ||
      [...before].some(([id, sig]) => after.get(id) !== sig);
    if (linesChanged) {
      res.status(409).json({
        error: `S.O. #${soNumber} is ${STATUS_OUT[existing.status]} - unallocate it (back to Checked) before changing items or quantities.`,
        conflict: true,
      });
      return;
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const itemIds = await resolveItemIds(tx, data.lineItems.map((l) => l.item));
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
        itemId: itemIdFor(itemIds, l.item),
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

  if (existing.status !== toStatus) {
    logAudit(req.account!, "ORDER_STATUS_CHANGED", "sales-order", String(soNumber), `S.O. #${soNumber}`, {
      from: STATUS_OUT[existing.status],
      to: data.status,
    });
  } else {
    logAudit(req.account!, "ORDER_UPDATED", "sales-order", String(soNumber), `S.O. #${soNumber}`, { status: data.status });
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
router.post("/:soNumber/ship", requireAnyPermission(ORDER_SHIP_PAGES, "edit"), async (req: AuthedRequest, res) => {
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
      await adjustOnHand(tx, { itemId: li.itemId, itemNumber: li.item }, -l.qty, {
        reason: "SHIP",
        refType: "sales-order",
        refId: String(soNumber),
        actor: req.account!,
      });
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
    logAudit(req.account!, "ORDER_SHIPPED", "sales-order", String(soNumber), `S.O. #${soNumber}`, {
      units: shipped.reduce((sum, l) => sum + l.qty, 0),
      result: fullyShipped ? "Shipped" : "Backordered",
    });
  });
  const updated = await prisma.salesOrder.findUnique({ where: { soNumber }, include });
  res.json(mapOut(updated!));
});

// Reverses the most recent shipment: puts its units back into qtyOnHand,
// re-stages them as pendingShipment and returns the order to Pick & Packed -
// atomically, for the same reason as /ship above.
router.post("/:soNumber/undo-shipment", requireAnyPermission(ORDER_SHIP_PAGES, "edit"), async (req: AuthedRequest, res) => {
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
      if (li && l.qty > 0) {
        await adjustOnHand(tx, { itemId: li.itemId, itemNumber: li.item }, l.qty, {
          reason: "UNDO_SHIP",
          refType: "sales-order",
          refId: String(soNumber),
          actor: req.account!,
        });
      }
    }
    await tx.shipmentRecord.delete({ where: { id: last.id } });
    await tx.salesOrder.update({
      where: { soNumber },
      data: { status: "PICK_PACKED", pendingShipment: lines, version: { increment: 1 } },
    });
    logAudit(req.account!, "SHIPMENT_UNDONE", "sales-order", String(soNumber), `S.O. #${soNumber}`, {
      units: lines.reduce((sum, l) => sum + (l.qty > 0 ? l.qty : 0), 0),
    });
  });
  const updated = await prisma.salesOrder.findUnique({ where: { soNumber }, include });
  res.json(mapOut(updated!));
});

// Cancels an order (or what's left of a partly shipped one): releases its
// allocation and any packed-but-unshipped pick, records who and why, and
// takes it out of every queue. Shipped units stay shipped - undo those
// separately if the goods are coming back (that's a return).
router.post("/:soNumber/cancel", requireAnyPermission(ORDER_CANCEL_PAGES, "edit"), async (req: AuthedRequest, res) => {
  const soNumber = parseInt(req.params.soNumber, 10);
  const parsed = cancelSchema.safeParse(req.body);
  if (!Number.isFinite(soNumber) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Order not found" : parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, parsed.data.version);
    if (order.status === "SHIPPED" || order.status === "CANCELLED") {
      throw new HttpError(409, `S.O. #${soNumber} is already ${STATUS_OUT[order.status]}.`, { conflict: true });
    }
    await tx.salesOrder.update({
      where: { soNumber },
      data: {
        status: "CANCELLED",
        allocation: Prisma.JsonNull,
        pendingShipment: [],
        cancelledAt: new Date(),
        cancelledBy: req.account!.username,
        cancelReason: parsed.data.reason,
        version: { increment: 1 },
      },
    });
  });
  logAudit(req.account!, "ORDER_CANCELLED", "sales-order", String(soNumber), `S.O. #${soNumber}`, { reason: parsed.data.reason });
  const updated = await prisma.salesOrder.findUnique({ where: { soNumber }, include });
  res.json(mapOut(updated!));
});

// Releases allocated orders to the warehouse (Release Orders): each order's
// allocated quantities (or the smaller per-line quantities sent) become its
// staged pick, and the order moves to Pick & Packed, waiting on its pick
// list and packing slip. Each order is its own transaction, so one stale
// order doesn't hold up the rest of the batch - the response says which
// released and why any didn't.
//
// Same rules as the single-order release page: a line can release at most
// what's allocated to it (revise the allocation to send more), and a
// released line's allocation is used up by the release.
router.post("/release", requirePermission("pick-release", "edit"), async (req: AuthedRequest, res) => {
  const parsed = releaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  type AllocationJson = { lines: { lineItemId: string; allocatedQty: number }[] } & Record<string, unknown>;
  const results: { soNumber: string; ok: boolean; error?: string }[] = [];
  const releasedSoNumbers: number[] = [];
  for (const request of parsed.data.orders) {
    const soNumber = Number(request.soNumber);
    try {
      if (!Number.isInteger(soNumber)) throw new HttpError(404, "Order not found");
      const summary = await prisma.$transaction(async (tx) => {
        const order = await lockOrder(tx, soNumber, request.version);
        if (order.status !== "ALLOCATED") {
          throw new HttpError(409, `S.O. #${soNumber} is already ${STATUS_OUT[order.status]} - someone else moved it on.`, { conflict: true });
        }
        const allocation = order.allocation as AllocationJson | null;
        const allocatedFor = (id: string) => allocation?.lines.find((l) => l.lineItemId === id)?.allocatedQty ?? 0;
        const lineIds = new Set(order.lineItems.map((li) => li.id));
        if (request.lines?.some((l) => !lineIds.has(l.lineItemId))) {
          throw new HttpError(400, `S.O. #${soNumber} changed since it was loaded - reload and try again.`);
        }
        const requested = request.lines ? new Map(request.lines.map((l) => [l.lineItemId, l.qty])) : null;
        const pending: { lineItemId: string; qty: number }[] = [];
        for (const li of order.lineItems) {
          const allocated = allocatedFor(li.id);
          const qty = requested ? (requested.get(li.id) ?? 0) : allocated;
          if (qty > allocated) {
            throw new HttpError(409, `S.O. #${soNumber}: ${li.item} can release at most ${allocated} (what's allocated). Revise the allocation to send more.`, { conflict: true });
          }
          if (qty > 0) pending.push({ lineItemId: li.id, qty });
        }
        if (pending.length === 0) throw new HttpError(409, `S.O. #${soNumber} has nothing to release.`, { conflict: true });

        const shippedFor = (id: string) =>
          order.shipmentHistory.reduce((sum, r) => sum + ((r.lines as { lineItemId: string; qty: number }[]).find((x) => x.lineItemId === id)?.qty ?? 0), 0);
        const pendingFor = (id: string) => pending.find((p) => p.lineItemId === id)?.qty ?? 0;
        const complete = order.lineItems.every((li) => Math.max(0, li.ordered - shippedFor(li.id)) - pendingFor(li.id) <= 0);
        const released = new Set(pending.map((p) => p.lineItemId));
        const nextAllocation = allocation
          ? { ...allocation, lines: order.lineItems.map((li) => ({ lineItemId: li.id, allocatedQty: released.has(li.id) ? 0 : allocatedFor(li.id) })) }
          : null;
        await tx.salesOrder.update({
          where: { soNumber },
          data: {
            status: "PICK_PACKED",
            pickPackStatus: complete ? "COMPLETE" : "PARTIAL",
            pickedAt: new Date(),
            pendingShipment: pending,
            pickListPrintedAt: null,
            packingSlipPrintedAt: null,
            allocation: nextAllocation ?? Prisma.JsonNull,
            version: { increment: 1 },
          },
        });
        return { lines: pending.length, units: pending.reduce((sum, p) => sum + p.qty, 0), complete };
      });
      logAudit(req.account!, "ORDER_STATUS_CHANGED", "sales-order", String(soNumber), `S.O. #${soNumber}`, {
        from: "Allocated",
        to: "Pick & Packed",
        lines: summary.lines,
        units: summary.units,
        release: summary.complete ? "Complete" : "Partial",
      });
      releasedSoNumbers.push(soNumber);
      results.push({ soNumber: String(soNumber), ok: true });
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      const label = `S.O. #${request.soNumber}`;
      results.push({ soNumber: String(request.soNumber), ok: false, error: err.message.startsWith(label) ? err.message : `${label}: ${err.message}` });
    }
  }
  const orders = releasedSoNumbers.length
    ? await prisma.salesOrder.findMany({ where: { soNumber: { in: releasedSoNumbers } }, include })
    : [];
  res.json({ results, orders: orders.map(mapOut) });
});

export default router;
