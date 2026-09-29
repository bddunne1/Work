import { Router } from "express";
import { z } from "zod";
import { logAudit } from "../lib/audit.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { HttpError } from "../lib/conflictError.js";
import { prisma } from "../prisma.js";

const router = Router();

router.use(requireAuth);

// Document counters the server itself knows about. Numbers are assigned
// inside each document's create transaction (see salesOrders.ts,
// vendorPurchaseOrders.ts, returns.ts) - the old POST /:key/next that let
// any signed-in account reserve (and so burn) numbers is gone (R5-17).
const KNOWN_KEYS = new Set(["salesOrder", "vendorPo", "return"]);

// Read-only peek at the current stored value (the last number actually
// issued) - for display, e.g. Settings showing "next number" before
// anyone commits to it. Doesn't reserve or change anything.
router.get("/:key", async (req, res) => {
  const row = await prisma.counter.findUnique({ where: { key: req.params.key } });
  res.json({ key: req.params.key, value: row?.value ?? null });
});

// Highest number already issued for `key`, so an override can't set the
// counter back onto numbers in use (every later create would then fail its
// primary-key insert, roll the counter back, and fail again - forever).
async function maxIssued(key: string): Promise<number> {
  if (key === "salesOrder") {
    const r = await prisma.salesOrder.aggregate({ _max: { soNumber: true } });
    return r._max.soNumber ?? 0;
  }
  const table = key === "vendorPo" ? "VendorPurchaseOrder" : key === "return" ? "ReturnAuthorization" : null;
  if (!table) return 0;
  const col = key === "vendorPo" ? "poNumber" : "raNumber";
  const rows = await prisma.$queryRawUnsafe<{ max: number | null }[]>(
    `SELECT MAX(CAST(SUBSTRING("${col}" FROM '[0-9]+$') AS INTEGER)) AS max FROM "${table}"`
  );
  return Number(rows[0]?.max ?? 0);
}

const setSchema = z.object({ value: z.number().int().nonnegative() });

// Admin override (Settings > Document Numbering) - sets the stored value
// outright, same permission gate as writing a Setting.
router.put("/:key", async (req: AuthedRequest, res) => {
  const parsed = setSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const account = req.account;
  const allowed = account?.role === "ADMIN" || account?.permissions?.settings === "edit";
  if (!allowed) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  if (!KNOWN_KEYS.has(req.params.key)) throw new HttpError(404, "Unknown counter");
  // The stored value is the last number issued; the next document gets +1.
  const highest = await maxIssued(req.params.key);
  if (parsed.data.value < highest) {
    throw new HttpError(400, `Number ${parsed.data.value + 1} is at or below one already in use (highest is ${highest}). Choose ${highest + 1} or higher.`);
  }
  const previous = await prisma.counter.findUnique({ where: { key: req.params.key } });
  const updated = await prisma.counter.upsert({
    where: { key: req.params.key },
    create: { key: req.params.key, value: parsed.data.value },
    update: { value: parsed.data.value },
  });
  logAudit(account!, "COUNTER_SET", "counter", req.params.key, req.params.key, { from: previous?.value ?? null, to: updated.value });
  res.json({ key: req.params.key, value: updated.value });
});

export default router;
