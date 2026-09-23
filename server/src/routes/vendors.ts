import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

const router = Router();

const vendorSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z
    .object({
      name: z.string(),
      addressLine1: z.string(),
      addressLine2: z.string().optional(),
      city: z.string(),
      state: z.string(),
      zip: z.string(),
      notes: z.string().optional(),
    })
    .optional(),
});

router.use(requireAuth);

router.get("/", requirePermission("vendors", "view"), async (_req, res) => {
  const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });
  res.json(vendors);
});

router.post("/", requirePermission("vendors", "edit"), async (req, res) => {
  const parsed = vendorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const vendor = await prisma.vendor.create({ data: parsed.data });
  res.status(201).json(vendor);
});

router.put("/:id", requirePermission("vendors", "edit"), async (req, res) => {
  const parsed = vendorSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const vendor = await prisma.vendor.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  res.json(vendor);
});

router.delete("/:id", requirePermission("vendors", "edit"), async (req, res) => {
  await prisma.vendor.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
});

export default router;
