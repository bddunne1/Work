import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

const router = Router();

// Admins always pass requirePermission; other accounts need the Activity
// Log page ("audit-log") - it used to be admin-only even though the page
// permission could be granted.
router.use(requireAuth, requirePermission("audit-log", "view"));

// Filters: targetType (sales-order | vendor-po | return | item | customer |
// vendor | account), targetId, actor (username), action (prefix, e.g.
// "ORDER_"), from/to (ISO dates), before (ISO timestamp cursor for paging).
router.get("/", async (req, res) => {
  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 200;
  const str = (k: string) => (typeof req.query[k] === "string" && req.query[k] ? String(req.query[k]) : undefined);
  const where: Prisma.AuditLogWhereInput = {};
  if (str("targetType")) where.targetType = str("targetType");
  if (str("targetId")) where.targetId = str("targetId");
  if (str("actor")) where.actorUsername = { equals: str("actor"), mode: "insensitive" };
  if (str("action")) where.action = { startsWith: str("action")!.toUpperCase() };
  const createdAt: Prisma.DateTimeFilter = {};
  if (str("from")) createdAt.gte = new Date(str("from")!);
  if (str("to")) createdAt.lt = new Date(new Date(str("to")!).getTime() + 86_400_000);
  if (str("before")) createdAt.lt = new Date(str("before")!);
  if (Object.keys(createdAt).length) where.createdAt = createdAt;
  const entries = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  res.json(entries);
});

export default router;
