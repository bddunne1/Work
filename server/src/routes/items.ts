import { Router } from "express";
import { z } from "zod";
import { requireAnyPermission, requireAuth, requirePermission } from "../middleware/auth.js";
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
  um: z.string().default("EA"),
  rate: z.number().default(0),
  qtyOnHand: z.number().int().default(0),
  reorderPoint: z.number().int().nullish(),
  countryOfOrigin: z.string().nullish(),
  weight: z.number().nullish(),
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

const include = { components: true, links: true };

router.use(requireAuth);

// Reads are open to any signed-in account: nearly every workflow page
// (order entry, validation, allocation, pick/pack, receiving, pricing,
// returns, labels) needs item numbers, weights and stock, and gating them
// on the Catalog page key 403'd whole roles. Writes stay gated below.
router.get("/", async (req, res) => {
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
  res.json(items);
});

router.get("/:id", async (req, res) => {
  const item = await prisma.item.findUnique({ where: { id: req.params.id }, include });
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
});

router.post("/", requirePermission("catalog", "edit"), async (req, res) => {
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
  const item = await prisma.item.create({
    data: {
      itemNumber: data.itemNumber,
      description: data.description,
      um: data.um,
      rate: data.rate,
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
  res.status(201).json(item);
});

router.put("/:id", requirePermission("catalog", "edit"), async (req, res) => {
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
      await syncChildren(tx.itemComponent, id, "itemId", data.components, (c) => ({
        partNumber: c.partNumber,
        description: c.description,
      }));
      await syncChildren(tx.itemLink, id, "itemId", data.links, (l) => ({
        label: l.label,
        url: l.url,
      }));
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
router.patch("/by-number/:itemNumber/qty", requireAnyPermission(["catalog", "inventory"], "edit"), async (req, res) => {
  const parsed = adjustQtySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { qtyOnHandDelta, qtyOnPurchaseOrder, setQtyOnHand, expectedQtyOnHand } = parsed.data;
  if (setQtyOnHand !== undefined) {
    if (expectedQtyOnHand === undefined) {
      res.status(400).json({ error: "expectedQtyOnHand is required with setQtyOnHand" });
      return;
    }
    const result = await prisma.item.updateMany({
      where: { itemNumber: req.params.itemNumber, qtyOnHand: expectedQtyOnHand },
      data: { qtyOnHand: setQtyOnHand, version: { increment: 1 } },
    });
    if (result.count === 0) {
      const current = await prisma.item.findUnique({ where: { itemNumber: req.params.itemNumber } });
      if (!current) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      res.status(409).json({
        error: `On-hand for ${current.itemNumber} changed to ${current.qtyOnHand} since you loaded it (a shipment or receipt just posted). Recount against the new figure and save again.`,
        conflict: true,
        qtyOnHand: current.qtyOnHand,
      });
      return;
    }
    res.json(await prisma.item.findUnique({ where: { itemNumber: req.params.itemNumber }, include }));
    return;
  }
  const item = await prisma.item
    .update({
      where: { itemNumber: req.params.itemNumber },
      data: {
        qtyOnHand: qtyOnHandDelta ? { increment: qtyOnHandDelta } : undefined,
        qtyOnPurchaseOrder: qtyOnPurchaseOrder !== undefined ? qtyOnPurchaseOrder : undefined,
        version: { increment: 1 },
      },
      include,
    })
    .catch(() => null);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
});

router.delete("/:id", requirePermission("catalog", "edit"), async (req, res) => {
  // A missing row is fine (already gone); anything else - notably a
  // foreign-key violation because orders/POs still reference it - goes to
  // the error handler as a 409 instead of a false "deleted" 204.
  await prisma.item.delete({ where: { id: req.params.id } }).catch((err) => {
    if (err?.code === "P2025") return null;
    throw err;
  });
  res.status(204).end();
});

export default router;
