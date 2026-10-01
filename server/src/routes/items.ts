import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAnyPermission, requireAuth, requirePermission, type AuthedAccount, type AuthedRequest } from "../middleware/auth.js";
import { enqueueIfSynced } from "../integrations/sync.js";
import { auditIn, diffFields, logAudit } from "../lib/audit.js";
import { canSeeCost, canSeePrices } from "../lib/orderView.js";
import { ConflictError } from "../lib/conflictError.js";
import { syncChildren } from "../lib/syncChildren.js";
import { prisma } from "../prisma.js";

const router = Router();

const componentSchema = z.object({
  id: z.string().optional(),
  partNumber: z.string(),
  description: z.string().optional(),
});

const linkSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  url: z.string(),
});

// `.nullish()` (not `.optional()`) on every field the DB can hand back as
// null: Prisma serializes an unset nullable column as `null` over JSON, and
// this schema round-trips a fetched record right back through the same PUT
// on every save - `.optional()` alone rejects that `null` with a 400.
const itemSchema = z.object({
  itemNumber: z.string().min(1),
  description: z.string().min(1),
  um: z.string().max(20).default("EA"),
  rate: z.number().finite().nonnegative().default(0),
  // Last purchase cost (E-05); null while unknown. Catalog edit sets it,
  // every PO receipt overwrites it with the line's cost.
  cost: z.number().finite().nonnegative().nullish(),
  qtyOnHand: z.number().int().default(0),
  reorderPoint: z.number().int().nonnegative().nullish(),
  countryOfOrigin: z.string().max(100).nullish(),
  weight: z.number().finite().nonnegative().nullish(),
  notes: z.string().nullish(),
  preferredVendorId: z.string().nullish(),
  components: z.array(componentSchema).default([]),
  links: z.array(linkSchema).default([]),
});

// Required on PUT (every fetched record has one), absent on POST (a new
// item has no prior version to check against).
const updateSchema = itemSchema.extend({ version: z.number().int() });

const adjustQtySchema = z.object({
  qtyOnHandDelta: z.number().int().optional(),
  qtyOnPurchaseOrder: z.number().int().nonnegative().optional(),
  // Cycle-count correction: set qtyOnHand to `setQtyOnHand`, but only if it
  // is still `expectedQtyOnHand` (what the person was looking at). A
  // shipment or receipt landing in between gets a 409 instead of being
  // silently undone by a delta computed from a stale number.
  setQtyOnHand: z.number().int().nonnegative().optional(),
  expectedQtyOnHand: z.number().int().optional(),
});

// The preferred vendor's name rides along so lists don't fetch every vendor to show it (C-16).
const include = { components: true, links: true, preferredVendor: { select: { name: true } } };

// Cost leaves the response only for accounts that may see it (E-05).
function present<T extends { cost?: unknown }>(item: T, account: AuthedAccount): Omit<T, "cost"> | T {
  if (canSeeCost(account)) return item;
  const { cost: _cost, ...rest } = item;
  return rest;
}

router.use(requireAuth);

// Reads are open to any signed-in account: nearly every workflow page
// (order entry, validation, allocation, pick/pack, receiving, pricing,
// returns, labels) needs item numbers, weights and stock, and gating them
// on the Catalog page key 403'd whole roles. Writes stay gated below.
router.get("/", async (req: AuthedRequest, res) => {
  const q = String(req.query.q ?? "").trim();
  const items = await prisma.item.findMany({
    where: q
      ? {
          OR: [
            { itemNumber: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { itemNumber: "asc" },
    include,
  });
  res.json(items.map((i) => present(i, req.account!)));
});

router.get("/:id", async (req: AuthedRequest, res) => {
  const item = await prisma.item.findUnique({ where: { id: req.params.id }, include });
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(present(item, req.account!));
});

router.post("/", requirePermission("catalog", "edit"), async (req: AuthedRequest, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const existing = await prisma.item.findUnique({ where: { itemNumber: data.itemNumber } });
  if (existing) {
    res.status(409).json({ error: `Item number "${data.itemNumber}" already exists` });
    return;
  }
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.item.create({
      data: {
        itemNumber: data.itemNumber,
        description: data.description,
        um: data.um,
        rate: data.rate,
        cost: data.cost,
        qtyOnHand: data.qtyOnHand,
        reorderPoint: data.reorderPoint,
        countryOfOrigin: data.countryOfOrigin,
        weight: data.weight,
        notes: data.notes,
        preferredVendorId: data.preferredVendorId,
        components: { create: data.components.map((c) => ({ partNumber: c.partNumber, description: c.description })) },
        links: { create: data.links.map((l) => ({ label: l.label, url: l.url })) },
      },
      include,
    });
    // Opening stock is a movement like any other, so the ledger starts at
    // zero for every item and start-plus-movements always equals on hand (R4-26).
    if (created.qtyOnHand !== 0) {
      await tx.stockMovement.create({
        data: {
          itemId: created.id,
          itemNumber: created.itemNumber,
          delta: created.qtyOnHand,
          qtyAfter: created.qtyOnHand,
          reason: "OPENING",
          refType: "item",
          refId: created.id,
          actorId: req.account!.id,
          actorUsername: req.account!.username,
        },
      });
    }
    return created;
  });
  logAudit(req.account!, "ITEM_CREATED", "item", item.id, item.itemNumber, { qtyOnHand: item.qtyOnHand });
  res.status(201).json(item);
});

// The catalog fields whose changes are recorded field by field.
const ITEM_FIELDS = ["itemNumber", "description", "um", "rate", "cost", "qtyOnHand", "reorderPoint", "countryOfOrigin", "weight", "notes", "preferredVendorId"];

router.put("/:id", requirePermission("catalog", "edit"), async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const id = req.params.id;

  const existing = await prisma.item.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.item.updateMany({
        where: { id, version: data.version },
        data: {
          itemNumber: data.itemNumber,
          description: data.description,
          um: data.um,
          rate: data.rate,
          // Left out of the body (an account that can't see cost saving the
          // record back) leaves the cost alone.
          ...(data.cost === undefined ? {} : { cost: data.cost }),
          qtyOnHand: data.qtyOnHand,
          reorderPoint: data.reorderPoint,
          countryOfOrigin: data.countryOfOrigin,
          weight: data.weight,
          notes: data.notes,
          preferredVendorId: data.preferredVendorId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConflictError();
      // A renamed, repriced or redescribed item that QuickBooks knows gets updated there too.
      if (data.itemNumber !== existing.itemNumber || !existing.rate.equals(new Prisma.Decimal(data.rate)) || data.description !== existing.description) {
        await enqueueIfSynced(tx, "item", id);
      }
      await syncChildren(tx.itemComponent, id, "itemId", data.components, (c) => ({
        partNumber: c.partNumber,
        description: c.description,
      }));
      await syncChildren(tx.itemLink, id, "itemId", data.links, (l) => ({
        label: l.label,
        url: l.url,
      }));
      // An edited on-hand figure is a stock movement like any other.
      if (data.qtyOnHand !== existing.qtyOnHand) {
        await tx.stockMovement.create({
          data: {
            itemId: id,
            itemNumber: data.itemNumber,
            delta: data.qtyOnHand - existing.qtyOnHand,
            qtyAfter: data.qtyOnHand,
            reason: "ITEM_EDIT",
            refType: "item",
            refId: id,
            actorId: req.account!.id,
            actorUsername: req.account!.username,
          },
        });
      }
      // A renamed item keeps its history: order, PO and return lines linked
      // to it (and customer prices / part numbers keyed by item #) follow the
      // new number instead of being orphaned under the old one.
      if (data.itemNumber !== existing.itemNumber) {
        await tx.salesOrderLine.updateMany({ where: { itemId: id }, data: { item: data.itemNumber } });
        await tx.vendorPoLine.updateMany({ where: { itemId: id }, data: { itemNumber: data.itemNumber } });
        await tx.returnLine.updateMany({ where: { itemId: id }, data: { itemNumber: data.itemNumber } });
        await tx.stockMovement.updateMany({ where: { itemId: id }, data: { itemNumber: data.itemNumber } });
        await tx.customerPriceOverride.updateMany({ where: { itemNumber: existing.itemNumber }, data: { itemNumber: data.itemNumber } });
        await tx.customerPartMapping.updateMany({ where: { itemNumber: existing.itemNumber }, data: { itemNumber: data.itemNumber } });
      }
      // Field by field, in the transaction (B-11).
      const changes: Record<string, unknown> = diffFields(existing, data, ITEM_FIELDS);
      if (data.itemNumber !== existing.itemNumber) changes.renamedFrom = existing.itemNumber;
      await auditIn(tx, req.account!, "ITEM_UPDATED", "item", id, data.itemNumber, changes);
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message, conflict: true });
      return;
    }
    throw err;
  }

  const updated = await prisma.item.findUnique({ where: { id }, include });
  res.json(updated);
});

// Atomic quantity updates - never routed through the full PUT above, since
// two people editing an item's other fields while stock is simultaneously
// shipped/received would otherwise race on a read-modify-write of the whole
// record. qtyOnHand moves by a signed delta; qtyOnPurchaseOrder is always
// set outright since it's a recomputed total (see vendorPurchaseOrders.ts),
// not something anyone increments by hand. Still bumps `version`: without
// that, a concurrent whole-object PUT that fetched the item just before
// this ran would pass its (now-stale) version check and silently overwrite
// the quantity this just set.
// Inventory Adjust (inventory:edit) is the main caller now that shipping and
// receiving move stock inside their own transactions server-side.
router.patch("/by-number/:itemNumber/qty", requireAnyPermission(["catalog", "inventory"], "edit"), async (req: AuthedRequest, res) => {
  const parsed = adjustQtySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { qtyOnHandDelta, qtyOnPurchaseOrder, setQtyOnHand, expectedQtyOnHand } = parsed.data;
  const itemNumber = req.params.itemNumber;
  const current = await prisma.item.findUnique({ where: { itemNumber } });
  if (!current) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (setQtyOnHand !== undefined && expectedQtyOnHand === undefined) {
    res.status(400).json({ error: "expectedQtyOnHand is required with setQtyOnHand" });
    return;
  }

  let changedBy = 0;
  const conflictAt = await prisma.$transaction(async (tx) => {
    if (setQtyOnHand !== undefined) {
      // Compare-and-set: only if on-hand is still what the person counted against.
      const result = await tx.item.updateMany({
        where: { id: current.id, qtyOnHand: expectedQtyOnHand },
        data: { qtyOnHand: setQtyOnHand, version: { increment: 1 } },
      });
      if (result.count === 0) {
        return (await tx.item.findUnique({ where: { id: current.id } }))?.qtyOnHand ?? null;
      }
      changedBy = setQtyOnHand - (expectedQtyOnHand as number);
    } else if (qtyOnHandDelta) {
      await tx.item.update({ where: { id: current.id }, data: { qtyOnHand: { increment: qtyOnHandDelta }, version: { increment: 1 } } });
      changedBy = qtyOnHandDelta;
    }
    if (changedBy !== 0) {
      const after = await tx.item.findUniqueOrThrow({ where: { id: current.id } });
      await tx.stockMovement.create({
        data: {
          itemId: current.id,
          itemNumber: current.itemNumber,
          delta: changedBy,
          qtyAfter: after.qtyOnHand,
          reason: "ADJUST",
          refType: "inventory-adjust",
          actorId: req.account!.id,
          actorUsername: req.account!.username,
        },
      });
    }
    if (qtyOnPurchaseOrder !== undefined) {
      await tx.item.update({ where: { id: current.id }, data: { qtyOnPurchaseOrder, version: { increment: 1 } } });
    }
    if (changedBy !== 0) await auditIn(tx, req.account!, "STOCK_ADJUSTED", "item", current.id, current.itemNumber, { delta: changedBy });
    return undefined;
  });
  if (conflictAt !== undefined) {
    res.status(409).json({
      error: `On-hand for ${current.itemNumber} changed to ${conflictAt} since you loaded it (a shipment or receipt just posted). Recount against the new figure and save again.`,
      conflict: true,
      qtyOnHand: conflictAt,
    });
    return;
  }
  res.json(await prisma.item.findUnique({ where: { id: current.id }, include }));
});

const STATUS_LABEL: Record<string, string> = { ENTERED: "Entered", CHECKED: "Checked", ALLOCATED: "Allocated", BACKORDERED: "Backordered", PICK_PACKED: "Pick & Packed", SHIPPED: "Shipped", CANCELLED: "Cancelled" };
const PO_STATUS_LABEL: Record<string, string> = { OPEN: "Open", PARTIALLY_RECEIVED: "Partially Received", RECEIVED: "Received", CLOSED: "Closed" };
const QUICK_REPORT_CAP = 500;

// Everything the Item Quick Report shows, in one small response (D-10):
// the stock summary, the item's order lines (newest first, capped) and its
// vendor PO lines. Prices ride along only for an office login (B-10).
router.get("/:id/quick-report", async (req: AuthedRequest, res) => {
  const item = await prisma.item.findUnique({ where: { id: req.params.id }, include });
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const showPrices = canSeePrices(req.account!);
  const showCost = canSeeCost(req.account!);
  const itemCost = item.cost === null ? null : Number(item.cost);
  const [lines, total, openLines, poLines] = await Promise.all([
    prisma.salesOrderLine.findMany({
      where: { itemId: item.id },
      orderBy: { soNumber: "desc" },
      take: QUICK_REPORT_CAP,
      include: { salesOrder: { select: { soNumber: true, poNumber: true, billTo: true, orderDate: true, status: true, allocation: true, shipmentHistory: { select: { lines: true } } } } },
    }),
    prisma.salesOrderLine.count({ where: { itemId: item.id } }),
    prisma.salesOrderLine.findMany({
      where: { itemId: item.id, salesOrder: { status: { in: ["ENTERED", "CHECKED", "ALLOCATED", "BACKORDERED", "PICK_PACKED"] } } },
      select: { id: true, ordered: true, salesOrder: { select: { shipmentHistory: { select: { lines: true } } } } },
    }),
    prisma.vendorPoLine.findMany({
      where: { itemId: item.id },
      orderBy: { vendorPo: { orderDate: "desc" } },
      take: QUICK_REPORT_CAP,
      include: { vendorPo: { select: { poNumber: true, vendorName: true, orderDate: true, status: true } } },
    }),
  ]);
  const shippedOn = (history: { lines: unknown }[], lineId: string) =>
    history.reduce((sum, rec) => sum + ((rec.lines as { lineItemId: string; qty: number }[]).find((l) => l.lineItemId === lineId)?.qty ?? 0), 0);
  const soLines = lines.map((l) => {
    const o = l.salesOrder;
    const shipped = shippedOn(o.shipmentHistory, l.id);
    const allocated = (o.allocation as { lines?: { lineItemId: string; allocatedQty: number }[] } | null)?.lines?.find((a) => a.lineItemId === l.id)?.allocatedQty ?? 0;
    const rate = Number(l.rate);
    return {
      soNumber: String(o.soNumber),
      poNumber: o.poNumber,
      customer: (o.billTo as { name?: string }).name ?? "",
      orderDate: o.orderDate.toISOString().slice(0, 10),
      status: STATUS_LABEL[o.status] ?? o.status,
      item: l.item,
      description: l.description,
      um: l.um,
      ordered: l.ordered,
      shipped,
      remaining: Math.max(0, l.ordered - shipped),
      allocated: ["ALLOCATED", "BACKORDERED", "PICK_PACKED"].includes(o.status) ? allocated : 0,
      ...(showPrices ? { rate, amount: Math.round(l.ordered * rate * 100) / 100 } : {}),
      // Margin against today's cost (E-02): the rate less what the item
      // costs us, per unit and on the line.
      ...(showPrices && showCost && itemCost !== null ? { margin: Math.round((rate - itemCost) * 10000) / 10000, lineMargin: Math.round(l.ordered * (rate - itemCost) * 100) / 100 } : {}),
    };
  });
  const onSalesOrder = openLines.reduce((sum, l) => sum + Math.max(0, l.ordered - shippedOn(l.salesOrder.shipmentHistory, l.id)), 0);
  res.json({
    item: present(item, req.account!),
    summary: {
      onHand: item.qtyOnHand,
      onSalesOrder,
      allocated: item.qtyReserved,
      onPurchaseOrder: item.qtyOnPurchaseOrder,
      available: item.qtyOnHand - item.qtyReserved,
      ...(showCost ? { cost: itemCost, valueAtCost: itemCost === null ? null : Math.round(item.qtyOnHand * itemCost * 100) / 100 } : {}),
      ...(showCost && showPrices && itemCost !== null ? { margin: Math.round((Number(item.rate) - itemCost) * 10000) / 10000 } : {}),
    },
    soLines,
    poLines: poLines.map((l) => ({
      poNumber: l.vendorPo.poNumber,
      vendor: l.vendorPo.vendorName,
      orderDate: l.vendorPo.orderDate.toISOString().slice(0, 10),
      status: PO_STATUS_LABEL[l.vendorPo.status] ?? l.vendorPo.status,
      orderedQty: l.orderedQty,
      receivedQty: l.receivedQty,
      outstanding: Math.max(0, l.orderedQty - l.receivedQty),
      ...(showCost ? { cost: Number(l.cost) } : {}),
    })),
    notice: total > lines.length ? `Showing the most recent ${lines.length} of ${total} order lines.` : undefined,
    pricesHidden: !showPrices,
    costHidden: !showCost,
  });
});

// Stock ledger for one item, newest first: every ship, receipt, return,
// undo and adjustment with who did it and the balance after.
router.get("/:id/movements", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const movements = await prisma.stockMovement.findMany({
    where: { itemId: req.params.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  res.json(movements);
});

router.delete("/:id", requirePermission("catalog", "edit"), async (req: AuthedRequest, res) => {
  // An item with order/PO/return lines or stock movements is part of the
  // record - deleting it would orphan that history (and wipe its ledger).
  const [lines, poLines, returnLines, movements] = await Promise.all([
    prisma.salesOrderLine.count({ where: { itemId: req.params.id } }),
    prisma.vendorPoLine.count({ where: { itemId: req.params.id } }),
    prisma.returnLine.count({ where: { itemId: req.params.id } }),
    prisma.stockMovement.count({ where: { itemId: req.params.id } }),
  ]);
  if (lines + poLines + returnLines + movements > 0) {
    res.status(409).json({ error: "This item has order, PO, return or stock history and can't be deleted. Rename it or add a note instead." });
    return;
  }
  const doomed = await prisma.item.findUnique({ where: { id: req.params.id } });
  // A missing row is fine (already gone); anything else - notably a
  // foreign-key violation because orders/POs still reference it - goes to
  // the error handler as a 409 instead of a false "deleted" 204.
  await prisma.item.delete({ where: { id: req.params.id } }).catch((err) => {
    if (err?.code === "P2025") return null;
    throw err;
  });
  if (doomed) logAudit(req.account!, "ITEM_DELETED", "item", doomed.id, doomed.itemNumber);
  res.status(204).end();
});

export default router;
