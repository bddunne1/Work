import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/", async (req, res) => {
  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 200;
  const entries = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  res.json(entries);
});

export default router;
