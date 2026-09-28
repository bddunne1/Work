import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { hasPermission, requireAnyPermission, requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { logAudit } from "../lib/audit.js";
import { ConflictError, HttpError } from "../lib/conflictError.js";
import { createCreditMemoForReturn } from "../lib/documents.js";
import { adjustOnHand, itemIdFor, resolveItemIds } from "../lib/inventory.js";
import { syncChildren } from "../lib/syncChildren.js";
import { prisma } from "../prisma.js";

const router = Router();

// App-facing status strings <-> the Prisma enum, same translation approach
// as vendorPurchaseOrders.ts.
const STATUS_IN = { Issued: "ISSUED", Received: "RECEIVED", Closed: "CLOSED" } as const;
const STATUS_OUT: Record<string, string> = { ISSUED: "Issued", RECEIVED: "Received", CLOSED: "Closed" };

const RETURN_COUNTER_KEY = "return";
const RETURN_START = 3001;

const addressSchema = z.object({
  name: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  notes: z.string().optional(),
});

const lineSchema = z.object({
  id: z.string().optional(),
  itemNumber: z.string().min(1).max(100),
  description: z.string().max(500),
  um: z.string().max(20).default("EA"),
  qty: z.number().int().positive(),
  rate: z.number().finite().nonnegative(),
  reason: z.string().max(500).default(""),
  // false = damaged/scrap: received but not put back on the shelf.
  restock: z.boolean().default(true),
});

// Who wrote the RA is stamped from the token, never taken from the body
// (R5-02); zod strips those keys if a client still sends them.
const createSchema = z.object({
  customerId: z.string().nullish(),
  soNumber: z.string().max(50).nullish(),
  billTo: addressSchema,
  requestDate: z.string(),
  reason: z.string().max(2000).default(""),
  notes: z.string().max(5000).default(""),
  lines: z.array(lineSchema).max(500).default([]),
});

const updateSchema = createSchema.extend({
  status: z.enum(["Issued", "Received", "Closed"]),
  version: z.number().int(),
});

const receiveSchema = z.object({
  version: z.number().int(),
  // Optional per-line override of the restock flag decided at the dock.
  lines: z.array(z.object({ lineId: z.string(), restock: z.boolean() })).default([]),
});

// Customer service issues RAs (returns page); the dock / purchasing receives
// the goods back (receiving page) - both need to see them.
const RETURN_VIEW_PAGES = ["returns", "receiving"];
const RETURN_RECEIVE_PAGES = ["receiving", "returns"];

const include = { lines: true };

// An RA tied to an S.O. can't send back more of an item than that order
// actually shipped, less what other RAs against the same order already
// cover. (RAs without an S.O. - e.g. a customer returning old stock - skip
// this check.)
async function assertWithinShipped(
  tx: Prisma.TransactionClient,
  soNumberText: string | null | undefined,
  raNumber: string | null,
  lines: { itemNumber: string; qty: number }[]
): Promise<void> {
  const soNumber = parseInt(String(soNumberText ?? "").replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(soNumber)) return;
  const order = await tx.salesOrder.findUnique({ where: { soNumber }, include: { lineItems: true, shipmentHistory: true } });
  if (!order) throw new HttpError(400, `S.O. #${soNumber} doesn't exist - check the order number on this return.`);
  const shipped = new Map<string, number>();
  for (const li of order.lineItems) {
    const qty = order.shipmentHistory.reduce(
      (sum, r) => sum + ((r.lines as { lineItemId: string; qty: number }[]).find((x) => x.lineItemId === li.id)?.qty ?? 0),
      0
    );
    const key = li.item.trim().toLowerCase();
    shipped.set(key, (shipped.get(key) ?? 0) + qty);
  }
  const others = await tx.returnLine.findMany({
    where: { returnAuth: { soNumber: { in: [String(soNumber), soNumberText ?? ""] }, status: { not: "CLOSED" }, ...(raNumber ? { raNumber: { not: raNumber } } : {}) } },
  });
  const already = new Map<string, number>();
  for (const l of others) already.set(l.itemNumber.trim().toLowerCase(), (already.get(l.itemNumber.trim().toLowerCase()) ?? 0) + l.qty);
  const requested = new Map<string, number>();
  for (const l of lines) requested.set(l.itemNumber.trim().toLowerCase(), (requested.get(l.itemNumber.trim().toLowerCase()) ?? 0) + l.qty);
  const problems: string[] = [];
  for (const [item, qty] of requested) {
    const allowed = (shipped.get(item) ?? 0) - (already.get(item) ?? 0);
    if (qty > allowed) problems.push(`${item.toUpperCase()}: ${qty} requested, ${Math.max(0, allowed)} returnable`);
  }
  if (problems.length > 0) {
    throw new HttpError(400, `More than S.O. #${soNumber} shipped (less other returns against it): ${problems.join("; ")}.`);
  }
}

function mapOut<T extends { status: string }>(ra: T) {
  return { ...ra, status: STATUS_OUT[ra.status] ?? ra.status };
}

router.use(requireAuth);

// `?open=1` returns only RAs issued and not yet received back.
router.get("/", requireAnyPermission(RETURN_VIEW_PAGES, "view"), async (req, res) => {
  const openOnly = req.query.open === "1" || req.query.open === "true";
  const returns = await prisma.returnAuthorization.findMany({
    where: openOnly ? { status: "ISSUED" } : undefined,
    orderBy: { createdAt: "desc" },
    include,
  });
  res.json(returns.map(mapOut));
});

router.get("/:raNumber", requireAnyPermission(RETURN_VIEW_PAGES, "view"), async (req, res) => {
  const ra = await prisma.returnAuthorization.findUnique({ where: { raNumber: req.params.raNumber }, include });
  if (!ra) {
    res.status(404).json({ error: "Return not found" });
    return;
  }
  res.json(mapOut(ra));
});

// Assigns the RA number itself (atomically, via the shared Counter table)
// rather than trusting one the client precomputed - same reasoning as
// vendor PO numbers (see vendorPurchaseOrders.ts).
router.post("/", requirePermission("returns", "edit"), async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const ra = await prisma.$transaction(async (tx) => {
    const itemIds = await resolveItemIds(tx, data.lines.map((l) => l.itemNumber));
    await assertWithinShipped(tx, data.soNumber, null, data.lines);
    const counter = await tx.counter.upsert({
      where: { key: RETURN_COUNTER_KEY },
      create: { key: RETURN_COUNTER_KEY, value: RETURN_START },
      update: { value: { increment: 1 } },
    });
    return tx.returnAuthorization.create({
      data: {
        raNumber: `RA-${counter.value}`,
        customerId: data.customerId,
        soNumber: data.soNumber,
        billTo: data.billTo,
        requestDate: new Date(data.requestDate),
        reason: data.reason,
        status: "ISSUED",
        notes: data.notes,
        writtenBy: req.account!.initials,
        writtenById: req.account!.id,
        writtenByColor: req.account!.color,
        lines: {
          create: data.lines.map((l) => ({
            itemId: itemIdFor(itemIds, l.itemNumber),
            itemNumber: l.itemNumber,
            description: l.description,
            um: l.um,
            qty: l.qty,
            rate: l.rate,
            reason: l.reason,
            restock: l.restock,
          })),
        },
      },
      include,
    });
  });
  logAudit(req.account!, "RETURN_ISSUED", "return", ra.raNumber, ra.raNumber, { soNumber: ra.soNumber, lines: ra.lines.length });
  res.status(201).json(mapOut(ra));
});

// The RA's own writer may correct it without Returns edit access - the
// carve-out the detail page always offered (open bug N-03).
router.put("/:raNumber", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const raNumber = req.params.raNumber;

  const existing = await prisma.returnAuthorization.findUnique({ where: { raNumber } });
  if (!existing) {
    res.status(404).json({ error: "Return not found" });
    return;
  }
  if (existing.writtenById !== req.account!.id && !hasPermission(req.account!, "returns", "edit")) {
    res.status(403).json({ error: "Editing a return needs edit access to Returns." });
    return;
  }
  if (existing.status !== "ISSUED" && data.lines.length !== (await prisma.returnLine.count({ where: { raNumber } }))) {
    res.status(409).json({ error: `${raNumber} has already been received - its lines can't change now.`, conflict: true });
    return;
  }
  // Goods coming back go through Receive Return (which restocks them and
  // records who received them) - a plain save can't mark an RA received.
  if (existing.status === "ISSUED" && data.status === "Received") {
    res.status(409).json({ error: "Use Receive Return to receive the goods - it puts restockable units back on hand.", conflict: true });
    return;
  }
  if (existing.status !== "ISSUED" && data.status === "Issued") {
    res.status(409).json({ error: `${raNumber} has already been ${existing.status === "RECEIVED" ? "received" : "closed"}.`, conflict: true });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const itemIds = await resolveItemIds(tx, data.lines.map((l) => l.itemNumber));
      if (existing.status === "ISSUED") await assertWithinShipped(tx, data.soNumber, raNumber, data.lines);
      const result = await tx.returnAuthorization.updateMany({
        where: { raNumber, version: data.version },
        data: {
          customerId: data.customerId,
          soNumber: data.soNumber,
          billTo: data.billTo,
          requestDate: new Date(data.requestDate),
          reason: data.reason,
          status: STATUS_IN[data.status],
          notes: data.notes,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConflictError();
      await syncChildren(tx.returnLine, raNumber, "raNumber", data.lines, (l) => ({
        itemId: itemIdFor(itemIds, l.itemNumber),
        itemNumber: l.itemNumber,
        description: l.description,
        um: l.um,
        qty: l.qty,
        rate: l.rate,
        reason: l.reason,
        restock: l.restock,
      }));
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message, conflict: true });
      return;
    }
    throw err;
  }

  logAudit(req.account!, existing.status !== STATUS_IN[data.status] ? "RETURN_STATUS_CHANGED" : "RETURN_UPDATED", "return", raNumber, raNumber, {
    from: STATUS_OUT[existing.status],
    to: data.status,
  });
  const updated = await prisma.returnAuthorization.findUnique({ where: { raNumber }, include });
  res.json(mapOut(updated!));
});

// Receives the returned goods: every line marked restock goes back into
// qtyOnHand (with a RETURN stock movement), the RA moves to Received and
// records who received it - one transaction, version-checked, so a double
// click or a stale screen can't restock twice.
router.post("/:raNumber/receive", requireAnyPermission(RETURN_RECEIVE_PAGES, "edit"), async (req: AuthedRequest, res) => {
  const parsed = receiveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const raNumber = req.params.raNumber;
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ version: number; status: string }[]>`SELECT "version", "status"::text AS "status" FROM "ReturnAuthorization" WHERE "raNumber" = ${raNumber} FOR UPDATE`;
    if (rows.length === 0) throw new HttpError(404, "Return not found");
    if (rows[0].version !== parsed.data.version) throw new ConflictError();
    if (rows[0].status !== "ISSUED") throw new HttpError(409, `${raNumber} has already been received or closed.`, { conflict: true });
    const lines = await tx.returnLine.findMany({ where: { raNumber } });
    const override = new Map(parsed.data.lines.map((l) => [l.lineId, l.restock]));
    let restocked = 0;
    for (const line of lines) {
      const restock = override.get(line.id) ?? line.restock;
      if (override.has(line.id) && override.get(line.id) !== line.restock) {
        await tx.returnLine.update({ where: { id: line.id }, data: { restock } });
      }
      if (restock && line.qty > 0) {
        await adjustOnHand(tx, { itemId: line.itemId, itemNumber: line.itemNumber }, line.qty, {
          reason: "RETURN",
          refType: "return",
          refId: raNumber,
          actor: req.account!,
        });
        restocked += line.qty;
      }
    }
    const received = await tx.returnAuthorization.update({
      where: { raNumber },
      data: { status: "RECEIVED", receivedAt: new Date(), receivedBy: req.account!.username, version: { increment: 1 } },
    });
    // Goods are back: the customer is credited, at the price they were
    // billed where that invoice can be found. Queued for QuickBooks here.
    const memo = await createCreditMemoForReturn(tx, { ...received, lines: await tx.returnLine.findMany({ where: { raNumber } }) }, req.account!);
    logAudit(req.account!, "RETURN_RECEIVED", "return", raNumber, raNumber, {
      unitsRestocked: restocked,
      unitsScrapped: lines.reduce((sum, l) => sum + l.qty, 0) - restocked,
      creditMemo: memo.creditMemoNumber,
      creditTotal: memo.total.toString(),
    });
  });
  const updated = await prisma.returnAuthorization.findUnique({ where: { raNumber }, include });
  res.json(mapOut(updated!));
});

export default router;
