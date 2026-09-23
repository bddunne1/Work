import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

const router = Router();

router.use(requireAuth);

// Every app-wide setting as a key -> parsed-value map. Readable by anyone
// logged in (lead time, company info, etc. show up on ordinary pages), but
// see the PUT below for who can change one.
router.get("/", async (_req, res) => {
  const rows = await prisma.setting.findMany();
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      // corrupt row - skip it rather than fail the whole settings load
    }
  }
  res.json(settings);
});

const putSchema = z.object({ value: z.unknown() });

// Settings are administrative by nature (company profile, lead time,
// document numbering) - writing one requires the "settings" page
// permission, same gate the frontend's Settings page itself uses.
router.put("/:key", async (req: AuthedRequest, res) => {
  const parsed = putSchema.safeParse(req.body);
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
  await prisma.setting.upsert({
    where: { key: req.params.key },
    create: { key: req.params.key, value: JSON.stringify(parsed.data.value) },
    update: { value: JSON.stringify(parsed.data.value) },
  });
  res.status(204).end();
});

export default router;
