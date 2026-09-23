import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
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

const adjustQtySchema = z.object({
  qtyOnHandDelta: z.number().int().optional(),
  qtyOnPurchaseOrder: z.number().int().optional(),
});

const include = { components: true, links: true };

router.use(requireAuth);

router.get("/", requirePermission("catalog", "view"), async (req, res) => {
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

router.get("/:id", requirePermission("catalog", "view"), async (req, res) => {
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
  const parsed = itemSchema.safeParse(req.body);
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

  await prisma.$transaction(async (tx) => {
    await tx.item.update({
      where: { id },
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
      },
    });
    await syncChildren(tx.itemComponent, id, "itemId", data.components, (c) => ({
      partNumber: c.partNumber,
      description: c.description,
    }));
    await syncChildren(tx.itemLink, id, "itemId", data.links, (l) => ({
      label: l.label,
      url: l.url,
    }));
  });

  const updated = await prisma.item.findUnique({ where: { id }, include });
  res.json(updated);
});

// Atomic quantity updates - never routed through the full PUT above, since
// two people editing an item's other fields while stock is simultaneously
// shipped/received would otherwise race on a read-modify-write of the whole
// record. qtyOnHand moves by a signed delta; qtyOnPurchaseOrder is always
// set outright since it's a recomputed total (see vendorPurchaseOrders.ts),
// not something anyone increments by hand.
router.patch("/by-number/:itemNumber/qty", requirePermission("catalog", "edit"), async (req, res) => {
  const parsed = adjustQtySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { qtyOnHandDelta, qtyOnPurchaseOrder } = parsed.data;
  const item = await prisma.item
    .update({
      where: { itemNumber: req.params.itemNumber },
      data: {
        qtyOnHand: qtyOnHandDelta ? { increment: qtyOnHandDelta } : undefined,
        qtyOnPurchaseOrder: qtyOnPurchaseOrder !== undefined ? qtyOnPurchaseOrder : undefined,
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
  await prisma.item.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
});

export default router;
