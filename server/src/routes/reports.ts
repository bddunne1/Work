import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../lib/conflictError.js";
import { describeSource, readableSources, runReport } from "../lib/reports/engine.js";
import { REPORT_SOURCES, runRequestSchema, tzOffsetSchema } from "../lib/reports/spec.js";
import { catalogFor } from "../lib/reports/standard.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

// The report engine's API (see lib/reports): run a spec, and describe what
// the account may build one from.
//   POST /api/reports/run        { spec, tzOffset, page?, pageSize? }
//   GET  /api/reports/sources?tzOffset=300
//   GET  /api/reports/catalog          the standard reports the account may read
//   GET  /api/reports/preferences      this account's favorites and recent reports
//   POST /api/reports/preferences/favorite { ref, on }
//   POST /api/reports/preferences/recent   { ref }
const router = Router();

router.use(requireAuth);
router.use(requirePermission("reports", "view"));

router.post("/run", async (req: AuthedRequest, res) => {
  const parsed = runRequestSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid report");
  const { spec, tzOffset, page, pageSize } = parsed.data;
  res.json(await runReport(spec, { account: req.account!, tzOffset, page, pageSize }));
});

router.get("/catalog", (req: AuthedRequest, res) => {
  res.json(catalogFor(req.account!));
});

router.get("/sources", (req: AuthedRequest, res) => {
  const tzOffset = tzOffsetSchema.parse(req.query.tzOffset ?? 0);
  const readable = readableSources(req.account!);
  res.json(REPORT_SOURCES.filter((k) => readable.includes(k)).map((k) => describeSource(req.account!, k, tzOffset)));
});

export default router;

// ---- favorites and recent, per account -------------------------------------

const RECENT_KEPT = 12;
const refSchema = z.string().trim().min(1).max(120);

async function preferences(accountId: string) {
  const rows = await prisma.reportPreference.findMany({ where: { accountId }, orderBy: { lastUsedAt: "desc" } });
  return {
    favorites: rows.filter((r) => r.kind === "FAVORITE").map((r) => r.reportRef).sort(),
    recent: rows.filter((r) => r.kind === "RECENT").slice(0, RECENT_KEPT).map((r) => ({ ref: r.reportRef, at: r.lastUsedAt.toISOString() })),
  };
}

router.get("/preferences", async (req: AuthedRequest, res) => {
  res.json(await preferences(req.account!.id));
});

router.post("/preferences/favorite", async (req: AuthedRequest, res) => {
  const parsed = z.object({ ref: refSchema, on: z.boolean() }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { ref, on } = parsed.data;
  const accountId = req.account!.id;
  if (on) {
    await prisma.reportPreference.upsert({
      where: { accountId_reportRef_kind: { accountId, reportRef: ref, kind: "FAVORITE" } },
      create: { accountId, reportRef: ref, kind: "FAVORITE" },
      update: { lastUsedAt: new Date() },
    });
  } else {
    await prisma.reportPreference.deleteMany({ where: { accountId, reportRef: ref, kind: "FAVORITE" } });
  }
  res.json(await preferences(accountId));
});

router.post("/preferences/recent", async (req: AuthedRequest, res) => {
  const parsed = z.object({ ref: refSchema }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const accountId = req.account!.id;
  await prisma.reportPreference.upsert({
    where: { accountId_reportRef_kind: { accountId, reportRef: parsed.data.ref, kind: "RECENT" } },
    create: { accountId, reportRef: parsed.data.ref, kind: "RECENT" },
    update: { lastUsedAt: new Date() },
  });
  // Keep the list short: anything past the newest dozen goes.
  const stale = await prisma.reportPreference.findMany({ where: { accountId, kind: "RECENT" }, orderBy: { lastUsedAt: "desc" }, skip: RECENT_KEPT, select: { id: true } });
  if (stale.length > 0) await prisma.reportPreference.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
  res.status(204).end();
});
