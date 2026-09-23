import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

const router = Router();

// .nullish() not .optional() on the top-level fields: Prisma hands back
// `null` for an unset nullable column, and this same object round-trips
// through PUT on every save - .optional() alone rejects that `null` with a
// 400. (addressLine2/notes inside address stay .optional() since address
// itself is one JSON blob the app always writes with those keys present,
// never a column Prisma can hand back null for individually.)
const vendorSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
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
    .nullish(),
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
  const { address, ...rest } = parsed.data;
  const vendor = await prisma.vendor.create({ data: { ...rest, address: address ?? Prisma.JsonNull } });
  res.status(201).json(vendor);
});

router.put("/:id", requirePermission("vendors", "edit"), async (req, res) => {
  const parsed = vendorSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { address, ...rest } = parsed.data;
  const vendor = await prisma.vendor
    .update({ where: { id: req.params.id }, data: { ...rest, address: address === undefined ? undefined : (address ?? Prisma.JsonNull) } })
    .catch(() => null);
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
