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

const itemSchema = z.object({
  itemNumber: z.string().min(1),
  description: z.string().min(1),
  um: z.string().default("EA"),
  rate: z.number().default(0),
  qtyOnHand: z.number().int().default(0),
  reorderPoint: z.number().int().optional(),
  countryOfOrigin: z.string().optional(),
  preferredVendorId: z.string().optional(),
  components: z.array(componentSchema).default([]),
});

const include = { components: true };

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
      preferredVendorId: data.preferredVendorId,
      components: { create: data.components.map((c) => ({ partNumber: c.partNumber, description: c.description })) },
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
        preferredVendorId: data.preferredVendorId,
      },
    });
    await syncChildren(tx.itemComponent, id, "itemId", data.components, (c) => ({
      partNumber: c.partNumber,
      description: c.description,
    }));
  });

  const updated = await prisma.item.findUnique({ where: { id }, include });
  res.json(updated);
});

router.delete("/:id", requirePermission("catalog", "edit"), async (req, res) => {
  await prisma.item.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
});

export default router;
