import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { ConflictError } from "../lib/conflictError.js";
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

// version required even though every other field stays optional (this
// endpoint is technically partial-update, though the frontend always sends
// the whole fetched record) - there's no prior version to compare a field
// that's genuinely absent against, so the check would be meaningless there.
router.put("/:id", requirePermission("vendors", "edit"), async (req, res) => {
  const parsed = vendorSchema.partial().extend({ version: z.number().int() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { address, version, ...rest } = parsed.data;

  const existing = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  const result = await prisma.vendor.updateMany({
    where: { id: req.params.id, version },
    data: { ...rest, address: address === undefined ? undefined : (address ?? Prisma.JsonNull), version: { increment: 1 } },
  });
  if (result.count === 0) {
    res.status(409).json({ error: new ConflictError().message, conflict: true });
    return;
  }

  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  res.json(vendor);
});

router.delete("/:id", requirePermission("vendors", "edit"), async (req, res) => {
  // A missing row is fine (already gone); anything else - notably a
  // foreign-key violation because orders/POs still reference it - goes to
  // the error handler as a 409 instead of a false "deleted" 204.
  await prisma.vendor.delete({ where: { id: req.params.id } }).catch((err) => {
    if (err?.code === "P2025") return null;
    throw err;
  });
  res.status(204).end();
});

export default router;
