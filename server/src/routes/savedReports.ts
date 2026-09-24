import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

const router = Router();

router.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1),
  dataSourceKey: z.string().min(1),
  filters: z.record(z.string()),
  columns: z.array(z.string()),
});

router.get("/", requirePermission("reports", "view"), async (_req, res) => {
  const reports = await prisma.savedReport.findMany({ orderBy: { name: "asc" } });
  res.json(reports);
});

router.post("/", requirePermission("reports", "edit"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const report = await prisma.savedReport.create({ data: parsed.data });
  res.status(201).json(report);
});

router.delete("/:id", requirePermission("reports", "edit"), async (req, res) => {
  await prisma.savedReport.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
});

export default router;
