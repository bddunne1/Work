import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

const router = Router();

router.use(requireAuth);

// Read-only peek at the current stored value (the last number actually
// issued) - for display, e.g. Settings showing "next number" before
// anyone commits to it. Doesn't reserve or change anything.
router.get("/:key", async (req, res) => {
  const row = await prisma.counter.findUnique({ where: { key: req.params.key } });
  res.json({ key: req.params.key, value: row?.value ?? null });
});

const nextSchema = z.object({ start: z.number().int() });

// Atomically reserves and returns the next number for `key`, seeding it at
// `start` the first time it's ever used. Two concurrent callers can never
// get the same number back - this is what a document-creating save calls.
router.post("/:key/next", async (req, res) => {
  const parsed = nextSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const updated = await prisma.counter.upsert({
    where: { key: req.params.key },
    create: { key: req.params.key, value: parsed.data.start },
    update: { value: { increment: 1 } },
  });
  res.json({ key: req.params.key, value: updated.value });
});

const setSchema = z.object({ value: z.number().int() });

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
  const updated = await prisma.counter.upsert({
    where: { key: req.params.key },
    create: { key: req.params.key, value: parsed.data.value },
    update: { value: parsed.data.value },
  });
  res.json({ key: req.params.key, value: updated.value });
});

export default router;
