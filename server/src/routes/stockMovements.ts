import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { requireAnyPermission, requireAuth } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

const router = Router();

// The stock ledger across all items: every ship, receipt, return, undo and
// adjustment, with who did it. Readable by anyone who works with stock.
router.use(requireAuth, requireAnyPermission(["inventory", "catalog", "audit-log", "shipment-history", "reports"], "view"));

// Filters: item (item #), reason (SHIP | UNDO_SHIP | RECEIVE_PO | RETURN |
// ADJUST | ITEM_EDIT, comma list), refType/refId, from/to (ISO dates),
// actor, limit (max 1000).
router.get("/", async (req, res) => {
  const str = (k: string) => (typeof req.query[k] === "string" && req.query[k] ? String(req.query[k]) : undefined);
  const where: Prisma.StockMovementWhereInput = {};
  if (str("item")) where.itemNumber = { equals: str("item"), mode: "insensitive" };
  if (str("reason")) where.reason = { in: str("reason")!.split(",").map((r) => r.trim().toUpperCase()) };
  if (str("refType")) where.refType = str("refType");
  if (str("refId")) where.refId = str("refId");
  if (str("actor")) where.actorUsername = { equals: str("actor"), mode: "insensitive" };
  const createdAt: Prisma.DateTimeFilter = {};
  if (str("from")) createdAt.gte = new Date(str("from")!);
  if (str("to")) createdAt.lt = new Date(new Date(str("to")!).getTime() + 86_400_000);
  if (Object.keys(createdAt).length) where.createdAt = createdAt;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const rows = await prisma.stockMovement.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  res.json(rows);
});

export default router;
