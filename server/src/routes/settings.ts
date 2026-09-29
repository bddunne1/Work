import { Router } from "express";
import { z } from "zod";
import { auditIn } from "../lib/audit.js";
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

// The settings that exist, and what each accepts (B-11). A key not listed
// here is refused: the table is not a free-form store.
const text = z.string().trim().max(200);
export const SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  // Business days from order date to the estimated ship date on new orders.
  lead_time_days: z.number().int().min(0).max(60),
  // Default window for Warehouse Capacity; the page caps at 90 either way.
  capacity_lookback_days: z.number().int().min(1).max(90),
  // The name and address printed on every document.
  company_info: z.object({ name: text, street: text, city: text, state: text, zip: text, phone: text }).strict(),
};

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
  const key = req.params.key;
  const schema = SETTING_SCHEMAS[key];
  if (!schema) {
    res.status(400).json({ error: `"${key}" is not a setting.` });
    return;
  }
  const value = schema.safeParse(parsed.data.value);
  if (!value.success) {
    res.status(400).json({ error: `Not a valid value for ${key}: ${value.error.issues.map((i) => i.message).join("; ")}`, issues: value.error.flatten() });
    return;
  }
  await prisma.$transaction(async (tx) => {
    const previous = await tx.setting.findUnique({ where: { key } });
    await tx.setting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value.data) },
      update: { value: JSON.stringify(value.data) },
    });
    await auditIn(tx, account!, "SETTING_CHANGED", "setting", key, key, {
      from: previous ? JSON.parse(previous.value) : null,
      to: value.data,
    });
  });
  res.status(204).end();
});

export default router;
