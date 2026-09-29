import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { isoDate } from "../lib/dates.js";
import { estimatedShipDateFor } from "../lib/leadTime.js";
import { hasPermission, requireAnyPermission, requireAuth, requirePermission, type AuthedAccount, type AuthedRequest } from "../middleware/auth.js";
import { idempotent } from "../middleware/idempotency.js";
import { auditIn, logAudit } from "../lib/audit.js";
import { ConflictError, HttpError } from "../lib/conflictError.js";
import { createInvoiceForShipment, voidInvoiceForShipment } from "../lib/documents.js";
import { adjustOnHand, findItemByNumber, itemIdFor, lockItems, resolveItemIds } from "../lib/inventory.js";
import { assertAllocationAvailable, syncReservations } from "../lib/reservations.js";
import { hidePrices, requireOrderRead } from "../lib/orderView.js";
import { pageLabels } from "../lib/pages.js";
import { syncChildren } from "../lib/syncChildren.js";
import { prisma } from "../prisma.js";

// Sales orders.
//
// Round 5 moved every workflow step onto its own command endpoint, each with
// a narrow input, one permission, and the actor stamped from the token:
//
//   PUT  /:so              edit header fields and (while Entered/Checked) lines
//   POST /:so/check        Entered -> Checked          (Validation)
//   POST /:so/uncheck      Checked -> Entered          (Validation)
//   POST /:so/allocate     Checked/Backordered -> Allocated | Backordered,
//                          or revise an Allocated order (Allocation, Back Orders,
//                          Release Orders)
//   POST /:so/unallocate   Allocated | unprinted Pick & Packed -> Checked
//   POST /release          Allocated -> Pick & Packed, in bulk (Release Orders)
//   POST /:so/mark-printed stamp pick list / packing slip printed; trim the
//                          staged quantities (Release Orders, Open Picks)
//   POST /:so/set-ship-date estimated ship date (Schedule, Back Orders)
//   POST /:so/set-bol      BOL details (Generate BOL)
//   POST /:so/ship         confirm a shipment (Open Picks, Shipment History)
//   POST /:so/undo-shipment
//   POST /:so/cancel
//
// Status, attribution (who entered / who checked), allocation, the staged
// pick, printed stamps and shipment history are server-owned: the PUT
// ignores them if sent. This is what closes review findings R5-01, R5-02,
// R5-03, R5-05 and R5-11.

const router = Router();

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
const PICK_PACK_STATUS_OUT: Record<string, string> = { PARTIAL: "Partial", COMPLETE: "Complete" };
void STATUS_IN;

const SO_COUNTER_KEY = "salesOrder";
const SO_START = 10001;

const money = z.number().finite().nonnegative();

const addressSchema = z.object({
  name: z.string().max(200),
  addressLine1: z.string().max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100),
  state: z.string().max(50),
  zip: z.string().max(20),
  notes: z.string().max(2000).optional(),
});

const lineItemSchema = z.object({
  id: z.string().optional(),
  item: z.string().min(1).max(100),
  description: z.string().max(500),
  um: z.string().max(20).default("EA"),
  ordered: z.number().int().positive(),
  rate: money,
  customerPartNumber: z.string().max(100).nullish(),
});

const allocationLineSchema = z.object({ lineItemId: z.string(), allocatedQty: z.number().int().nonnegative() });
const shipmentLineSchema = z.object({ lineItemId: z.string(), qty: z.number().int().nonnegative() });

const bolSchema = z.object({
  weight: z.string().max(50),
  packageCount: z.string().max(50),
  palletSlip: z.enum(["Y", "N"]),
  handlingUnitQty: z.string().max(50),
  handlingUnitType: z.string().max(50),
  packageQty: z.string().max(50),
  packageType: z.string().max(50),
  hazmat: z.boolean(),
  commodityDescription: z.string().max(500),
  nmfcNumber: z.string().max(50),
  freightClass: z.string().max(50),
  additionalInfo: z.string().max(2000),
  generatedAt: z.string(),
});

// Header fields the person entering or correcting an order may set. Unknown
// keys (status, allocation, checkedBy, shipmentHistory...) are stripped by
// zod, never applied.
const headerSchema = z.object({
  poNumber: z.string().max(100).default(""),
  orderDate: isoDate,
  dueDate: isoDate,
  customerId: z.string().nullish(),
  shipToLocationId: z.string().nullish(),
  billTo: addressSchema,
  shipTo: addressSchema,
  fob: z.string().max(100).default(""),
  shipVia: z.string().max(100).default(""),
  terms: z.string().max(100).default(""),
  rep: z.string().max(100).default(""),
  taxRate: z.number().finite().min(0).max(100).default(0),
  notes: z.string().max(5000).default(""),
  lineItems: z.array(lineItemSchema).max(500).default([]),
});

const createSchema = headerSchema;
// A login that can't see prices gets the order without them (B-10) and
// sends it back the same way: on a PUT, a missing rate or tax rate means
// "leave it as it is", filled in from the stored order below.
const updateSchema = headerSchema.extend({
  version: z.number().int(),
  taxRate: z.number().finite().min(0).max(100).nullish(),
  lineItems: z.array(lineItemSchema.extend({ rate: money.nullish() })).max(500).default([]),
});

const versionSchema = z.object({ version: z.number().int() });
const allocateSchema = z.object({
  version: z.number().int(),
  lines: z.array(allocationLineSchema).max(500),
  // The ship-complete decision for a partial allocation. Omitted = use the
  // customer record's flag.
  shipCompleteOnly: z.boolean().nullish(),
});
const markPrintedSchema = z.object({
  version: z.number().int(),
  pickList: z.boolean().default(false),
  packingSlip: z.boolean().default(false),
  // Optional trim of the staged pick (a shortfall found on the floor) - a
  // line can only go down from what was staged.
  lines: z.array(shipmentLineSchema).max(500).optional(),
});
const setShipDateSchema = z.object({ version: z.number().int(), estimatedShipDate: isoDate.nullable() });
const setBolSchema = z.object({ version: z.number().int(), bol: bolSchema });
const shipSchema = z.object({ version: z.number().int(), lines: z.array(shipmentLineSchema).max(500) });
const cancelSchema = z.object({ version: z.number().int(), reason: z.string().trim().min(1, "Give a reason for cancelling").max(2000) });
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
type OrderRow = Prisma.SalesOrderGetPayload<{ include: typeof include }>;
type ShipLine = { lineItemId: string; qty: number };
type AllocationJson = { lines: { lineItemId: string; allocatedQty: number }[]; fullyAllocated: boolean; shipCompleteOnly?: boolean; decidedAt: string };

function mapOut<T extends { soNumber: number; status: string; pickPackStatus: string | null }>(order: T) {
  return {
    ...order,
    soNumber: String(order.soNumber),
    status: STATUS_OUT[order.status] ?? order.status,
    pickPackStatus: order.pickPackStatus ? (PICK_PACK_STATUS_OUT[order.pickPackStatus] ?? order.pickPackStatus) : null,
  };
}

// Units shipped so far per line id, from the shipment records.
function shippedByLine(order: Pick<OrderRow, "shipmentHistory">): Map<string, number> {
  const out = new Map<string, number>();
  for (const rec of order.shipmentHistory) {
    for (const l of rec.lines as ShipLine[]) out.set(l.lineItemId, (out.get(l.lineItemId) ?? 0) + (l.qty > 0 ? l.qty : 0));
  }
  return out;
}

function remainingFor(li: { id: string; ordered: number }, shipped: Map<string, number>): number {
  return Math.max(0, li.ordered - (shipped.get(li.id) ?? 0));
}

function stagedByLine(order: Pick<OrderRow, "pendingShipment">): Map<string, number> {
  return new Map(((order.pendingShipment as ShipLine[] | null) ?? []).map((l) => [l.lineItemId, l.qty]));
}

function parseSo(raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== raw.trim()) throw new HttpError(404, "Order not found");
  return n;
}

// Which pages may run a command. Checked inside the handler (after the
// order is locked) when the answer depends on the order's state.
const ORDER_CREATE_PAGES = ["order-entry", "import"];
// Correcting header fields or lines: customer service, order entry, and
// the analysts who own validation.
// Import creates orders but never edits them (R4-07, decided 29 Sep).
const ORDER_EDIT_PAGES = ["order-entry", "order-detail", "validation"];
// Once stock is committed to an order only the two pricing pages may change
// what it will be billed at; once it is released nobody can (R4-03).
const PRICE_PAGES = ["order-entry", "order-detail"];
// Everything that still needs work - listed positively so the status index
// can serve the open-orders query (PF-04).
const OPEN_STATUSES = ["ENTERED", "CHECKED", "ALLOCATED", "BACKORDERED", "PICK_PACKED"] as const;
const MAX_SHIPPED_SINCE_DAYS = 90;
const ORDER_SHIP_PAGES = ["open-picks", "shipment-history"];
const ORDER_CANCEL_PAGES = ["order-detail", "allocation"];
const ALLOCATE_PAGES = ["allocation", "back-orders"];
const REVISE_ALLOCATION_PAGES = ["allocation", "back-orders", "pick-release"];
const UNALLOCATE_PAGES = ["allocation", "pick-release"];
const PRINT_PAGES = ["pick-pack", "open-picks"];
const SHIP_DATE_PAGES = ["schedule", "back-orders", "allocation"];

function requireEditOn(account: AuthedAccount, pageKeys: string[], what: string): void {
  if (!pageKeys.some((key) => hasPermission(account, key, "edit"))) {
    throw new HttpError(403, `${what} needs edit access to ${pageLabels(pageKeys)}.`);
  }
}

function assertOpen(order: OrderRow): void {
  if (order.status === "SHIPPED") throw new HttpError(409, `S.O. #${order.soNumber} has already shipped.`, { conflict: true });
  if (order.status === "CANCELLED") throw new HttpError(409, `S.O. #${order.soNumber} was cancelled and can't be changed.`, { conflict: true });
}

function assertStatus(order: OrderRow, expected: OrderRow["status"][], action: string): void {
  if (!expected.includes(order.status)) {
    throw new HttpError(
      409,
      `S.O. #${order.soNumber} is ${STATUS_OUT[order.status]}, so it can't be ${action} - someone else may have moved it on. Reload and check.`,
      { conflict: true }
    );
  }
}

// Locks the order row for the rest of the transaction and checks the
// caller's version, so no two commands interleave on one order.
async function lockOrder(tx: Prisma.TransactionClient, soNumber: number, version: number): Promise<OrderRow> {
  const rows = await tx.$queryRaw<{ version: number }[]>`SELECT "version" FROM "SalesOrder" WHERE "soNumber" = ${soNumber} FOR UPDATE`;
  if (rows.length === 0) throw new HttpError(404, "Order not found");
  if (rows[0].version !== version) throw new ConflictError();
  return tx.salesOrder.findUniqueOrThrow({ where: { soNumber }, include });
}

// The order as the caller may see it (prices only for the office, B-10).
async function reload(soNumber: number, account: AuthedAccount) {
  const updated = await prisma.salesOrder.findUnique({ where: { soNumber }, include });
  return hidePrices(mapOut(updated!), account);
}

router.use(requireAuth);

// `?open=1` returns only orders that haven't fully shipped (or been cancelled) - everything the
// workflow queues and stock-availability math need - instead of every order
// ever entered (which grows by ~150/day and was fetched by ~20 pages).
// `?limit=N` returns just the N most recent (e.g. the Dashboard's list).
// `?open=1&shippedSince=<ISO date>` adds orders with a shipment on or after
// that date - what warehouse capacity needs for its throughput window.
router.get("/", async (req: AuthedRequest, res) => {
  requireOrderRead(req.account!);
  // `?pulls=1`: cancelled orders whose printed pick is still on the floor (A-23).
  if (req.query.pulls === "1" || req.query.pulls === "true") {
    const pulls = await prisma.salesOrder.findMany({
      where: { status: "CANCELLED", pullRequestedAt: { not: null }, pullAcknowledgedAt: null },
      orderBy: { pullRequestedAt: "asc" },
      include,
    });
    res.json(pulls.map((o) => hidePrices(mapOut(o), req.account!)));
    return;
  }
  const openOnly = req.query.open === "1" || req.query.open === "true";
  const limit = Number(req.query.limit);
  const since = typeof req.query.shippedSince === "string" ? new Date(req.query.shippedSince) : null;
  // The capacity window never reaches back more than 90 days (N-05): a
  // Settings typo of 365 used to pull a year of shipments per page open.
  const oldest = new Date(Date.now() - MAX_SHIPPED_SINCE_DAYS * 86_400_000);
  const shippedSince = since && !Number.isNaN(since.getTime()) ? (since < oldest ? oldest : since) : null;
  const orders = await prisma.salesOrder.findMany({
    where: openOnly
      ? shippedSince
        ? { OR: [{ status: { in: [...OPEN_STATUSES] } }, { shipmentHistory: { some: { shippedAt: { gte: shippedSince } } } }] }
        : { status: { in: [...OPEN_STATUSES] } }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : undefined,
    include,
  });
  res.json(orders.map((o) => hidePrices(mapOut(o), req.account!)));
});

router.get("/:soNumber", async (req: AuthedRequest, res) => {
  requireOrderRead(req.account!);
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
  res.json(hidePrices(mapOut(order), req.account!));
});

// Assigns the S.O. # itself (atomically, via the shared Counter table)
// rather than trusting one the client precomputed, and stamps the writer
// from the token rather than the body.
router.post("/", requireAnyPermission(ORDER_CREATE_PAGES, "edit"), idempotent("sales-order"), async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const account = req.account!;
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
        // Order date plus the standard lead time; Schedule Shipments can
        // move it afterwards.
        estimatedShipDate: await estimatedShipDateFor(tx, new Date(data.orderDate)),
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
        writtenBy: account.initials,
        writtenById: account.id,
        writtenByColor: account.color,
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
  logAudit(account, "ORDER_CREATED", "sales-order", String(order.soNumber), `S.O. #${order.soNumber}`, {
    poNumber: order.poNumber,
    customer: (order.billTo as { name?: string }).name,
    lines: order.lineItems.length,
  });
  res.status(201).json(hidePrices(mapOut(order), account));
});

// Edits header fields and, while the order is Entered or Checked, its lines.
// The order's own writer may correct it without page edit access (the
// carve-out the Sales Order View always offered - open bug N-03).
router.put("/:soNumber", async (req: AuthedRequest, res) => {
  const soNumber = parseSo(req.params.soNumber);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const sent = parsed.data;
  const account = req.account!;

  const changes: Record<string, unknown> = {};
  await prisma.$transaction(async (tx) => {
    const existing = await lockOrder(tx, soNumber, sent.version);
    if (existing.writtenById !== account.id) requireEditOn(account, ORDER_EDIT_PAGES, "Editing an order");
    assertOpen(existing);

    // Prices the caller left out stay what they were (an existing line) or
    // start at the catalog rate (a new line); see updateSchema.
    const priorRate = new Map(existing.lineItems.map((l) => [l.id, Number(l.rate)]));
    const lineItems: z.infer<typeof lineItemSchema>[] = [];
    for (const l of sent.lineItems) {
      let rate = l.rate ?? (l.id ? priorRate.get(l.id) : undefined);
      if (rate == null) rate = Number((await findItemByNumber(tx, l.item))?.rate ?? 0);
      lineItems.push({ ...l, rate });
    }
    const data = { ...sent, taxRate: sent.taxRate ?? Number(existing.taxRate), lineItems };

    // Line ids the caller sent that belong to a different order would be
    // "upserted" onto that other order's row - refuse instead.
    const ids = data.lineItems.map((l) => l.id).filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      const foreign = await tx.salesOrderLine.count({ where: { id: { in: ids }, soNumber: { not: soNumber } } });
      if (foreign > 0) throw new HttpError(400, "Some lines on this order belong to a different order - reload the order and try again.");
    }

    const sig = (item: string, ordered: number) => `${item.trim().toLowerCase()}|${ordered}`;
    const before = new Map(existing.lineItems.map((l) => [l.id, l]));
    const after = new Map(data.lineItems.filter((l) => l.id).map((l) => [l.id as string, l]));
    const linesChanged =
      before.size !== data.lineItems.length ||
      [...before.values()].some((l) => {
        const a = after.get(l.id);
        return !a || sig(a.item, a.ordered) !== sig(l.item, l.ordered);
      });

    // Once stock is committed to an order, its lines are frozen: changing a
    // quantity or item under an allocation or a packed pick leaves them out
    // of step. Unallocate first (back to Checked), then edit.
    if (linesChanged && !["ENTERED", "CHECKED"].includes(existing.status)) {
      throw new HttpError(
        409,
        `S.O. #${soNumber} is ${STATUS_OUT[existing.status]} - unallocate it (back to Checked) before changing items or quantities.`,
        { conflict: true }
      );
    }
    // A line that has shipped is part of the record whatever the status:
    // it stays, keeps its item, and can't be cut below what went out (R5-11).
    const shipped = shippedByLine(existing);
    for (const l of existing.lineItems) {
      const qty = shipped.get(l.id) ?? 0;
      if (qty <= 0) continue;
      const a = after.get(l.id);
      if (!a) throw new HttpError(409, `${l.item} on S.O. #${soNumber} has already shipped ${qty} and can't be removed.`, { conflict: true });
      if (a.item.trim().toLowerCase() !== l.item.trim().toLowerCase()) {
        throw new HttpError(409, `${l.item} on S.O. #${soNumber} has already shipped and can't be changed to another item.`, { conflict: true });
      }
      if (a.ordered < qty) throw new HttpError(409, `${l.item} on S.O. #${soNumber} has already shipped ${qty} - ordered can't go below that.`, { conflict: true });
    }

    const itemIds = await resolveItemIds(tx, data.lineItems.map((l) => l.item));
    const header = {
      poNumber: data.poNumber,
      orderDate: new Date(data.orderDate),
      dueDate: new Date(data.dueDate),
      customerId: data.customerId ?? null,
      shipToLocationId: data.shipToLocationId ?? null,
      billTo: data.billTo,
      shipTo: data.shipTo,
      fob: data.fob,
      shipVia: data.shipVia,
      terms: data.terms,
      rep: data.rep,
      taxRate: new Prisma.Decimal(data.taxRate),
      notes: data.notes,
    };
    const track = <K extends keyof typeof header>(key: K, was: unknown) => {
      const now = header[key];
      const same = now instanceof Date || was instanceof Date
        ? new Date(String(was)).toDateString() === (now as Date).toDateString()
        : now instanceof Prisma.Decimal
          ? now.equals(new Prisma.Decimal(String(was ?? 0)))
          : JSON.stringify(now) === JSON.stringify(was ?? (typeof now === "string" ? "" : null));
      if (!same) changes[key] = { from: was, to: now instanceof Date ? now.toISOString().slice(0, 10) : now };
    };
    track("poNumber", existing.poNumber);
    track("orderDate", existing.orderDate);
    track("dueDate", existing.dueDate);
    track("customerId", existing.customerId);
    track("billTo", existing.billTo);
    track("shipTo", existing.shipTo);
    track("terms", existing.terms);
    track("rep", existing.rep);
    track("taxRate", existing.taxRate);
    track("notes", existing.notes);
    if (linesChanged) changes.lines = { from: existing.lineItems.length, to: data.lineItems.length };
    // Price changes are the ones people ask about later - record each.
    const rateChanges: Record<string, { from: string; to: number }> = {};
    for (const l of data.lineItems) {
      const was = l.id ? before.get(l.id) : undefined;
      if (was && !was.rate.equals(new Prisma.Decimal(l.rate))) rateChanges[was.item] = { from: was.rate.toString(), to: l.rate };
    }
    if (Object.keys(rateChanges).length > 0) changes.rates = rateChanges;

    // Price lock (R4-03): what the order will be billed at is frozen once
    // the pick is released, and needs a pricing page once stock is held.
    const priceChanged = Object.keys(rateChanges).length > 0 || "taxRate" in changes || "customerId" in changes;
    if (priceChanged) {
      if (existing.status === "PICK_PACKED") {
        throw new HttpError(409, `S.O. #${soNumber} is released to the warehouse - prices, tax and customer are locked. Unallocate it first to change them.`, { conflict: true });
      }
      if (existing.status === "ALLOCATED" || existing.status === "BACKORDERED") {
        requireEditOn(account, PRICE_PAGES, "Changing prices, tax or customer on an allocated order");
      }
    }

    // A line, quantity, price or customer change to a Checked order sends it
    // back for checking (A-22): the stamp came off with the change.
    const recheck = existing.status === "CHECKED" && (linesChanged || priceChanged);
    if (recheck) changes.status = { from: "Checked", to: "Entered" };
    await tx.salesOrder.update({
      where: { soNumber },
      data: { ...header, ...(recheck ? { status: "ENTERED", checkedAt: null, checkedBy: null, checkedByColor: null } : {}), version: { increment: 1 } },
    });
    await syncChildren(tx.salesOrderLine, soNumber, "soNumber", data.lineItems, (l) => ({
      itemId: itemIdFor(itemIds, l.item),
      item: l.item,
      description: l.description,
      um: l.um,
      ordered: l.ordered,
      rate: l.rate,
      customerPartNumber: l.customerPartNumber ?? null,
    }));
  });

  logAudit(account, "ORDER_UPDATED", "sales-order", String(soNumber), `S.O. #${soNumber}`, changes);
  res.json(await reload(soNumber, req.account!));
});

// Validation: Entered -> Checked, stamped with who checked it.
router.post("/:soNumber/check", requirePermission("validation", "edit"), async (req: AuthedRequest, res) => {
  const soNumber = parseSo(req.params.soNumber);
  const parsed = versionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const account = req.account!;
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, parsed.data.version);
    assertStatus(order, ["ENTERED"], "checked");
    await tx.salesOrder.update({
      where: { soNumber },
      data: { status: "CHECKED", checkedAt: new Date(), checkedBy: account.initials, checkedByColor: account.color, version: { increment: 1 } },
    });
  });
  logAudit(account, "ORDER_STATUS_CHANGED", "sales-order", String(soNumber), `S.O. #${soNumber}`, { from: "Entered", to: "Checked" });
  res.json(await reload(soNumber, req.account!));
});

// Validation: send a Checked order back to Entered (a correction is needed).
router.post("/:soNumber/uncheck", requirePermission("validation", "edit"), async (req: AuthedRequest, res) => {
  const soNumber = parseSo(req.params.soNumber);
  const parsed = versionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, parsed.data.version);
    assertStatus(order, ["CHECKED"], "sent back to Entered");
    await tx.salesOrder.update({
      where: { soNumber },
      data: { status: "ENTERED", checkedAt: null, checkedBy: null, checkedByColor: null, version: { increment: 1 } },
    });
  });
  logAudit(req.account!, "ORDER_STATUS_CHANGED", "sales-order", String(soNumber), `S.O. #${soNumber}`, { from: "Checked", to: "Entered" });
  res.json(await reload(soNumber, req.account!));
});

// Allocation decision. From Checked or Backordered: allocating every
// remaining unit moves the order to Allocated; allocating nothing (or a
// partial for a ship-complete-only customer) holds it as Backordered with
// no stock reserved; a partial otherwise goes to Allocated for what's on
// hand. On an Allocated order this revises the quantities in place.
// Every increase is checked against free stock under the allocation lock.
router.post("/:soNumber/allocate", async (req: AuthedRequest, res) => {
  const soNumber = parseSo(req.params.soNumber);
  const parsed = allocateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const account = req.account!;
  const { version, lines } = parsed.data;
  const outcome = await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, version);
    // Permission first (nobody without any allocation page learns the
    // order's state from the error), then the state-specific page.
    requireEditOn(account, REVISE_ALLOCATION_PAGES, "Allocating an order");
    assertStatus(order, ["CHECKED", "BACKORDERED", "ALLOCATED"], "allocated");
    const revising = order.status === "ALLOCATED";
    requireEditOn(account, revising ? REVISE_ALLOCATION_PAGES : ALLOCATE_PAGES, revising ? "Revising an allocation" : "Allocating an order");

    const shipped = shippedByLine(order);
    const byId = new Map(order.lineItems.map((li) => [li.id, li]));
    const requested = new Map<string, number>();
    for (const l of lines) {
      const li = byId.get(l.lineItemId);
      if (!li) throw new HttpError(400, `S.O. #${soNumber} changed since it was loaded - reload and try again.`);
      const remaining = remainingFor(li, shipped);
      if (l.allocatedQty > remaining) {
        throw new HttpError(400, `${li.item}: only ${remaining} remaining to ship on S.O. #${soNumber}, ${l.allocatedQty} requested.`);
      }
      requested.set(li.id, l.allocatedQty);
    }
    const qtyFor = (id: string) => requested.get(id) ?? 0;
    const total = order.lineItems.reduce((sum, li) => sum + qtyFor(li.id), 0);
    const fullyAllocated = order.lineItems.every((li) => qtyFor(li.id) >= remainingFor(li, shipped));

    let shipCompleteOnly = parsed.data.shipCompleteOnly ?? undefined;
    if (!fullyAllocated && shipCompleteOnly === undefined && order.customerId) {
      const customer = await tx.customer.findUnique({ where: { id: order.customerId }, select: { shipCompleteOnly: true } });
      shipCompleteOnly = customer?.shipCompleteOnly ?? false;
    }

    let status: OrderRow["status"];
    let hold = false;
    if (revising) {
      if (total === 0) throw new HttpError(400, "Nothing is allocated - use Unallocate to send the order back to Checked instead.");
      status = "ALLOCATED";
    } else if (total === 0 || (!fullyAllocated && shipCompleteOnly === true)) {
      status = "BACKORDERED";
      hold = true;
    } else {
      status = "ALLOCATED";
    }
    const allocation: AllocationJson = {
      lines: order.lineItems.map((li) => ({ lineItemId: li.id, allocatedQty: hold ? 0 : qtyFor(li.id) })),
      fullyAllocated,
      ...(fullyAllocated ? {} : { shipCompleteOnly: shipCompleteOnly ?? false }),
      decidedAt: new Date().toISOString(),
    };
    await assertAllocationAvailable(tx, soNumber, { status, lineItems: order.lineItems, allocation, pendingShipment: order.pendingShipment });
    await tx.salesOrder.update({ where: { soNumber }, data: { status, allocation, version: { increment: 1 } } });
    await syncReservations(tx, soNumber);
    return { from: STATUS_OUT[order.status], to: STATUS_OUT[status], units: hold ? 0 : total, fullyAllocated };
  });
  logAudit(account, outcome.from === outcome.to ? "ORDER_ALLOCATION_REVISED" : "ORDER_STATUS_CHANGED", "sales-order", String(soNumber), `S.O. #${soNumber}`, outcome);
  res.json(await reload(soNumber, req.account!));
});

// Releases an order's allocation and any unprinted staged pick, sending it
// back to Checked for a fresh decision. A pick whose documents have printed
// is on the floor and can't be recalled from here.
router.post("/:soNumber/unallocate", requireAnyPermission(UNALLOCATE_PAGES, "edit"), async (req: AuthedRequest, res) => {
  const soNumber = parseSo(req.params.soNumber);
  const parsed = versionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const from = await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, parsed.data.version);
    assertStatus(order, ["ALLOCATED", "PICK_PACKED"], "unallocated");
    if (order.status === "PICK_PACKED" && (order.pickListPrintedAt || order.packingSlipPrintedAt)) {
      throw new HttpError(409, `S.O. #${soNumber}'s pick list or packing slip has printed - the pick is on the floor. Confirm it from Open Picks or cancel the order.`, { conflict: true });
    }
    await tx.salesOrder.update({
      where: { soNumber },
      data: {
        status: "CHECKED",
        allocation: Prisma.JsonNull,
        pendingShipment: [],
        pickedAt: null,
        pickPackStatus: null,
        pickListPrintedAt: null,
        packingSlipPrintedAt: null,
        version: { increment: 1 },
      },
    });
    await syncReservations(tx, soNumber);
    return STATUS_OUT[order.status];
  });
  logAudit(req.account!, "ORDER_STATUS_CHANGED", "sales-order", String(soNumber), `S.O. #${soNumber}`, { from, to: "Checked", unallocated: true });
  res.json(await reload(soNumber, req.account!));
});

// Stamps the pick list and/or packing slip as printed, optionally trimming
// the staged quantities first (a shortfall found while picking - the reprint
// then matches what the floor can actually fulfil). Quantities only go down.
router.post("/:soNumber/mark-printed", requireAnyPermission(PRINT_PAGES, "edit"), async (req: AuthedRequest, res) => {
  const soNumber = parseSo(req.params.soNumber);
  const parsed = markPrintedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { version, pickList, packingSlip, lines } = parsed.data;
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, version);
    assertStatus(order, ["PICK_PACKED"], "marked printed");
    const data: Prisma.SalesOrderUpdateInput = { version: { increment: 1 } };
    const now = new Date();
    if (pickList) data.pickListPrintedAt = now;
    if (packingSlip) data.packingSlipPrintedAt = now;
    if (lines) {
      const staged = stagedByLine(order);
      const byId = new Map(order.lineItems.map((li) => [li.id, li]));
      const next: ShipLine[] = [];
      for (const l of lines) {
        const li = byId.get(l.lineItemId);
        const was = staged.get(l.lineItemId);
        if (!li || was === undefined) throw new HttpError(400, `S.O. #${soNumber} changed since it was loaded - reload and try again.`);
        if (l.qty > was) throw new HttpError(400, `${li.item}: ${was} is staged for this pick - it can be trimmed, not increased. Revise the allocation to send more.`);
        if (l.qty > 0) next.push({ lineItemId: l.lineItemId, qty: l.qty });
      }
      // Lines the caller didn't mention keep their staged quantity.
      for (const [lineItemId, qty] of staged) if (!lines.some((l) => l.lineItemId === lineItemId) && qty > 0) next.push({ lineItemId, qty });
      if (next.length === 0) throw new HttpError(400, "Every line is trimmed to 0 - unallocate the order instead.");
      data.pendingShipment = next;
    }
    await tx.salesOrder.update({ where: { soNumber }, data });
    if (lines) await syncReservations(tx, soNumber);
  });
  logAudit(req.account!, "ORDER_PRINTED", "sales-order", String(soNumber), `S.O. #${soNumber}`, { pickList, packingSlip, trimmed: Boolean(lines) });
  res.json(await reload(soNumber, req.account!));
});

router.post("/:soNumber/set-ship-date", requireAnyPermission(SHIP_DATE_PAGES, "edit"), async (req: AuthedRequest, res) => {
  const soNumber = parseSo(req.params.soNumber);
  const parsed = setShipDateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const date = parsed.data.estimatedShipDate ? new Date(parsed.data.estimatedShipDate) : null;
  if (date && Number.isNaN(date.getTime())) {
    res.status(400).json({ error: "That isn't a valid date." });
    return;
  }
  let from: string | null = null;
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, parsed.data.version);
    assertOpen(order);
    from = order.estimatedShipDate ? order.estimatedShipDate.toISOString().slice(0, 10) : null;
    await tx.salesOrder.update({ where: { soNumber }, data: { estimatedShipDate: date, version: { increment: 1 } } });
  });
  logAudit(req.account!, "ORDER_SHIP_DATE_SET", "sales-order", String(soNumber), `S.O. #${soNumber}`, { from, to: parsed.data.estimatedShipDate });
  res.json(await reload(soNumber, req.account!));
});

router.post("/:soNumber/set-bol", requirePermission("bol", "edit"), async (req: AuthedRequest, res) => {
  const soNumber = parseSo(req.params.soNumber);
  const parsed = setBolSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, parsed.data.version);
    if (order.status === "CANCELLED") throw new HttpError(409, `S.O. #${soNumber} was cancelled.`, { conflict: true });
    await tx.salesOrder.update({ where: { soNumber }, data: { bol: parsed.data.bol, version: { increment: 1 } } });
  });
  logAudit(req.account!, "ORDER_BOL_GENERATED", "sales-order", String(soNumber), `S.O. #${soNumber}`, { weight: parsed.data.bol.weight, packages: parsed.data.bol.packageCount });
  res.json(await reload(soNumber, req.account!));
});

// Confirms a shipment: records it, rolls the order to Shipped/Backordered,
// clears the staged pick AND takes the shipped units out of qtyOnHand - all
// in one transaction. Only what was staged for this pick can ship, never
// more than a line still owes, and never below zero on hand (R5-01).
router.post("/:soNumber/ship", requireAnyPermission(ORDER_SHIP_PAGES, "edit"), async (req: AuthedRequest, res) => {
  const soNumber = parseSo(req.params.soNumber);
  const parsed = shipSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { version, lines } = parsed.data;
  const account = req.account!;
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, version);
    assertStatus(order, ["PICK_PACKED"], "shipped");
    const staged = stagedByLine(order);
    const shippedSoFar = shippedByLine(order);
    const lineById = new Map(order.lineItems.map((li) => [li.id, li]));
    const seen = new Set<string>();
    const shipped: ShipLine[] = [];
    // Every item on the order, in id order - the same set every command locks.
    await lockItems(tx, order.lineItems.map((li) => li.itemId));
    for (const l of lines) {
      if (l.qty <= 0) continue;
      const li = lineById.get(l.lineItemId);
      if (!li) throw new HttpError(400, "Shipment references a line that is no longer on this order - reload and try again.");
      if (seen.has(l.lineItemId)) throw new HttpError(400, `${li.item} appears twice in this shipment.`);
      seen.add(l.lineItemId);
      const stagedQty = staged.get(l.lineItemId) ?? 0;
      if (l.qty > stagedQty) {
        throw new HttpError(409, `${li.item}: ${stagedQty} ${stagedQty === 1 ? "unit is" : "units are"} staged for this pick, ${l.qty} entered. Only what was released can ship.`, { conflict: true });
      }
      const remaining = remainingFor(li, shippedSoFar);
      if (l.qty > remaining) throw new HttpError(409, `${li.item}: only ${remaining} still owed on S.O. #${soNumber}, ${l.qty} entered.`, { conflict: true });
      shipped.push({ lineItemId: l.lineItemId, qty: l.qty });
    }
    if (shipped.length === 0) throw new HttpError(400, "Nothing to ship - every line is 0.");
    for (const l of shipped) {
      const li = lineById.get(l.lineItemId)!;
      const after = await adjustOnHand(tx, { itemId: li.itemId, itemNumber: li.item }, -l.qty, {
        reason: "SHIP",
        refType: "sales-order",
        refId: String(soNumber),
        actor: account,
      });
      if (after && after.qtyOnHand < 0) {
        throw new HttpError(
          409,
          `${after.itemNumber}: shipping ${l.qty} would take on-hand to ${after.qtyOnHand}. Correct the count under Inventory first.`,
          { conflict: true }
        );
      }
    }
    const record = await tx.shipmentRecord.create({ data: { soNumber, shippedAt: new Date(), lines: shipped } });
    // The invoice for this shipment, from the order's prices as they stand,
    // queued for the accounting bridge in this same transaction.
    const invoice = await createInvoiceForShipment(tx, order, { id: record.id, shippedAt: record.shippedAt, lines: shipped }, account);
    const history = await tx.shipmentRecord.findMany({ where: { soNumber } });
    const totals = shippedByLine({ shipmentHistory: history });
    const fullyShipped = order.lineItems.every((li) => (totals.get(li.id) ?? 0) >= li.ordered);
    // A partial shipment sends the remainder back to the back-order queue
    // with nothing held: whatever was still allocated is released for a
    // fresh decision, so it can go to another order if that is the better
    // call (A-07, decided 29 Sep).
    await tx.salesOrder.update({
      where: { soNumber },
      data: fullyShipped
        ? { status: "SHIPPED", pendingShipment: [], lastShippedAt: record.shippedAt, version: { increment: 1 } }
        : { status: "BACKORDERED", pendingShipment: [], allocation: Prisma.JsonNull, lastShippedAt: record.shippedAt, version: { increment: 1 } },
    });
    await syncReservations(tx, soNumber);
    await auditIn(tx, account, "ORDER_SHIPPED", "sales-order", String(soNumber), `S.O. #${soNumber}`, {
      units: shipped.reduce((sum, l) => sum + l.qty, 0),
      result: fullyShipped ? "Shipped" : "Backordered",
      invoice: invoice.invoiceNumber,
      invoiceTotal: invoice.total.toString(),
    });
  });
  res.json(await reload(soNumber, req.account!));
});

// Reverses the most recent shipment: puts its units back into qtyOnHand,
// re-stages them as pendingShipment and returns the order to Pick & Packed -
// atomically, for the same reason as /ship above.
router.post("/:soNumber/undo-shipment", requireAnyPermission(ORDER_SHIP_PAGES, "edit"), async (req: AuthedRequest, res) => {
  const soNumber = parseSo(req.params.soNumber);
  const parsed = versionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, parsed.data.version);
    if (order.status === "CANCELLED") throw new HttpError(409, `S.O. #${soNumber} was cancelled.`, { conflict: true });
    const last = order.shipmentHistory[order.shipmentHistory.length - 1];
    if (!last) throw new HttpError(409, "This order has no shipment to undo.", { conflict: true });
    // Units that came back on a received return are already on hand again;
    // undoing the shipment would count them twice (R4-12).
    const receivedReturns = await tx.returnAuthorization.findMany({
      where: { soNumber: String(soNumber), receivedAt: { not: null } },
      select: { raNumber: true },
    });
    if (receivedReturns.length > 0) {
      throw new HttpError(
        409,
        `S.O. #${soNumber} has a received return (${receivedReturns.map((r) => r.raNumber).join(", ")}) - those units are back on hand, so the shipment can't be undone.`,
        { conflict: true }
      );
    }
    // Once the invoice is in QuickBooks the accounting side owns it: void it
    // from the Invoices page (which pushes the void), then undo (decided 29 Sep).
    const invoice = await tx.invoice.findUnique({ where: { shipmentRecordId: last.id } });
    if (invoice && invoice.status === "ISSUED" && invoice.invoiceNumber) {
      const synced = await tx.externalRef.findFirst({ where: { system: "quickbooks", entityType: "invoice", entityId: invoice.invoiceNumber } });
      if (synced) {
        throw new HttpError(
          409,
          `Invoice ${invoice.invoiceNumber} for this shipment has already reached QuickBooks. Void it from the Invoices page first, then undo the shipment.`,
          { conflict: true }
        );
      }
    }
    const staged = (order.pendingShipment as ShipLine[] | null) ?? [];
    if (staged.some((l) => l.qty > 0)) {
      // Undoing would overwrite the batch that's already packed and staged
      // (and silently drop its reservation) - make them deal with it first.
      throw new HttpError(409, "Another batch is already packed and waiting to ship on this order. Confirm or unallocate it before undoing the last shipment.", { conflict: true });
    }
    const lineById = new Map(order.lineItems.map((li) => [li.id, li]));
    const lines = last.lines as ShipLine[];
    // Every item on the order, in id order - the same set every command locks.
    await lockItems(tx, order.lineItems.map((li) => li.itemId));
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
    // A draft invoice for this shipment is removed; an issued one is void
    // (its number stays issued).
    const voided = await voidInvoiceForShipment(tx, last.id, req.account!, "Shipment undone");
    await tx.shipmentRecord.delete({ where: { id: last.id } });
    const previous = order.shipmentHistory.length > 1 ? order.shipmentHistory[order.shipmentHistory.length - 2].shippedAt : null;
    await tx.salesOrder.update({
      where: { soNumber },
      data: { status: "PICK_PACKED", pendingShipment: lines, lastShippedAt: previous, version: { increment: 1 } },
    });
    await syncReservations(tx, soNumber);
    await auditIn(tx, req.account!, "SHIPMENT_UNDONE", "sales-order", String(soNumber), `S.O. #${soNumber}`, {
      units: lines.reduce((sum, l) => sum + (l.qty > 0 ? l.qty : 0), 0),
      ...(voided ? (voided.status === "DELETED" ? { invoiceDraftRemoved: true } : { invoiceVoided: voided.invoiceNumber }) : {}),
    });
  });
  res.json(await reload(soNumber, req.account!));
});

// Cancels an order (or what's left of a partly shipped one): releases its
// allocation and any packed-but-unshipped pick, records who and why, and
// takes it out of every queue. Shipped units stay shipped - undo those
// separately if the goods are coming back (that's a return).
router.post("/:soNumber/cancel", requireAnyPermission(ORDER_CANCEL_PAGES, "edit"), async (req: AuthedRequest, res) => {
  const soNumber = parseSo(req.params.soNumber);
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, parsed.data.version);
    if (order.status === "SHIPPED" || order.status === "CANCELLED") {
      throw new HttpError(409, `S.O. #${soNumber} is already ${STATUS_OUT[order.status]}.`, { conflict: true });
    }
    // A pick whose documents have printed is on the floor: the staged lines
    // stay on the order as the list of what to pull back, until Open Picks
    // acknowledges it (A-23). Nothing is held either way.
    const onFloor = order.status === "PICK_PACKED" && Boolean(order.pickListPrintedAt || order.packingSlipPrintedAt) && stagedByLine(order).size > 0;
    await tx.salesOrder.update({
      where: { soNumber },
      data: {
        status: "CANCELLED",
        allocation: Prisma.JsonNull,
        pendingShipment: onFloor ? undefined : [],
        pullRequestedAt: onFloor ? new Date() : null,
        pullAcknowledgedAt: null,
        cancelledAt: new Date(),
        cancelledBy: req.account!.username,
        cancelReason: parsed.data.reason,
        version: { increment: 1 },
      },
    });
    await syncReservations(tx, soNumber);
    await auditIn(tx, req.account!, "ORDER_CANCELLED", "sales-order", String(soNumber), `S.O. #${soNumber}`, { reason: parsed.data.reason, pullFromFloor: onFloor });
  });
  res.json(await reload(soNumber, req.account!));
});

// The warehouse has pulled a cancelled order's pick back off the floor.
router.post("/:soNumber/acknowledge-pull", requirePermission("open-picks", "edit"), async (req: AuthedRequest, res) => {
  const soNumber = parseSo(req.params.soNumber);
  const parsed = versionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, soNumber, parsed.data.version);
    if (order.status !== "CANCELLED" || !order.pullRequestedAt) throw new HttpError(409, `S.O. #${soNumber} has no pick waiting to be pulled.`, { conflict: true });
    if (order.pullAcknowledgedAt) throw new HttpError(409, `S.O. #${soNumber} was already pulled.`, { conflict: true });
    await tx.salesOrder.update({ where: { soNumber }, data: { pullAcknowledgedAt: new Date(), pendingShipment: [], version: { increment: 1 } } });
    await auditIn(tx, req.account!, "ORDER_PULL_ACKNOWLEDGED", "sales-order", String(soNumber), `S.O. #${soNumber}`, {
      units: stagedByLine(order).size ? [...stagedByLine(order).values()].reduce((s, q) => s + q, 0) : 0,
    });
  });
  res.json(await reload(soNumber, req.account!));
});

// Releases allocated orders to the warehouse (Release Orders): each order's
// allocated quantities (or the smaller per-line quantities sent) become its
// staged pick, and the order moves to Pick & Packed, waiting on its pick
// list and packing slip. Each order is its own transaction, so one stale
// order doesn't hold up the rest of the batch - the response says which
// released and why any didn't.
//
// A line can release at most what's allocated to it (revise the allocation
// to send more), and a released line's allocation is used up by the release.
router.post("/release", requirePermission("pick-release", "edit"), async (req: AuthedRequest, res) => {
  const parsed = releaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const results: { soNumber: string; ok: boolean; error?: string }[] = [];
  const releasedSoNumbers: number[] = [];
  for (const request of parsed.data.orders) {
    const soNumber = Number(request.soNumber);
    try {
      if (!Number.isInteger(soNumber)) throw new HttpError(404, "Order not found");
      const summary = await prisma.$transaction(async (tx) => {
        const order = await lockOrder(tx, soNumber, request.version);
        assertStatus(order, ["ALLOCATED"], "released");
        const allocation = order.allocation as AllocationJson | null;
        const allocatedFor = (id: string) => allocation?.lines.find((l) => l.lineItemId === id)?.allocatedQty ?? 0;
        const lineIds = new Set(order.lineItems.map((li) => li.id));
        if (request.lines?.some((l) => !lineIds.has(l.lineItemId))) {
          throw new HttpError(400, `S.O. #${soNumber} changed since it was loaded - reload and try again.`);
        }
        const requested = request.lines ? new Map(request.lines.map((l) => [l.lineItemId, l.qty])) : null;
        const pending: ShipLine[] = [];
        for (const li of order.lineItems) {
          const allocated = allocatedFor(li.id);
          const qty = requested ? (requested.get(li.id) ?? 0) : allocated;
          if (qty > allocated) {
            throw new HttpError(409, `S.O. #${soNumber}: ${li.item} can release at most ${allocated} (what's allocated). Revise the allocation to send more.`, { conflict: true });
          }
          if (qty > 0) pending.push({ lineItemId: li.id, qty });
        }
        if (pending.length === 0) throw new HttpError(409, `S.O. #${soNumber} has nothing to release.`, { conflict: true });

        const shipped = shippedByLine(order);
        const pendingFor = (id: string) => pending.find((p) => p.lineItemId === id)?.qty ?? 0;
        const complete = order.lineItems.every((li) => remainingFor(li, shipped) - pendingFor(li.id) <= 0);
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
        await syncReservations(tx, soNumber);
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
      // Any failure stays with its own order: the ones before it released,
      // the ones after it still get their turn (R4-28).
      const label = `S.O. #${request.soNumber}`;
      let message: string;
      if (err instanceof HttpError) {
        message = err.message;
      } else {
        console.error(`release ${label} failed:`, err);
        message = "Unexpected error - this order was not released. Reload and try again.";
      }
      results.push({ soNumber: String(request.soNumber), ok: false, error: message.startsWith(label) ? message : `${label}: ${message}` });
    }
  }
  const orders = releasedSoNumbers.length
    ? await prisma.salesOrder.findMany({ where: { soNumber: { in: releasedSoNumbers } }, include })
    : [];
  res.json({ results, orders: orders.map((o) => hidePrices(mapOut(o), req.account!)) });
});

export default router;
