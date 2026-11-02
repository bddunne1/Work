import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../lib/conflictError.js";
import { runSchedule } from "../integrations/reportSchedules.js";
import { describeSource, readableSources, runReport, runReportAll } from "../lib/reports/engine.js";
import { isValidCron } from "../lib/reports/cron.js";
import { companyName, runGroup, toRendered } from "../lib/reports/groups.js";
import { CONTENT_TYPES, EXPORT_FORMATS, fileName, render } from "../lib/reports/render.js";
import { REPORT_SOURCES, runRequestSchema, tzOffsetSchema } from "../lib/reports/spec.js";
import { catalogFor } from "../lib/reports/standard.js";
import { requireAnyPermission, requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

// The report engine's API (see lib/reports): run a spec, and describe what
// the account may build one from.
//   POST /api/reports/run        { spec, tzOffset, page?, pageSize? }
//   GET  /api/reports/sources?tzOffset=300
//   GET  /api/reports/catalog          the standard reports the account may read
//   GET  /api/reports/preferences      this account's favorites and recent reports
//   POST /api/reports/preferences/favorite { ref, on }
//   POST /api/reports/preferences/recent   { ref }
//   POST /api/reports/export           { spec, format: csv|xlsx|pdf, tzOffset, title? } -> the file
//   POST /api/reports/groups/:name/run { tzOffset } -> every report in a memorized group
//   GET/POST/PUT/DELETE /api/reports/schedules, POST /api/reports/schedules/:id/run
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

// ---- export ----------------------------------------------------------------

const exportSchema = runRequestSchema.extend({ format: z.enum(["csv", "xlsx", "pdf"]), title: z.string().trim().max(200).optional() });

router.post("/export", async (req: AuthedRequest, res) => {
  const parsed = exportSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid report");
  const { spec, tzOffset, format, title } = parsed.data;
  const account = req.account!;
  const result = await runReportAll(spec, { account, tzOffset });
  const rendered = toRendered(title ?? "Report", spec, result, account, await companyName());
  const content = await render(format, [rendered]);
  res.setHeader("Content-Type", CONTENT_TYPES[format]);
  res.setHeader("Content-Disposition", `attachment; filename="${fileName(rendered.title, format)}"`);
  res.send(content);
});

// ---- memorized report groups -----------------------------------------------

router.post("/groups/:name/run", async (req: AuthedRequest, res) => {
  const tzOffset = tzOffsetSchema.parse(req.body?.tzOffset ?? 0);
  const runs = await runGroup(req.params.name, req.account!, tzOffset);
  if (runs.length === 0) throw new HttpError(404, `No memorized report is in the group "${req.params.name}".`);
  res.json({ group: req.params.name, company: await companyName(), generatedAt: new Date().toISOString(), reports: runs });
});

// ---- schedules (admin or Settings edit) ------------------------------------

const scheduleSchema = z.object({
  groupName: z.string().trim().min(1, "Choose a group").max(80),
  cron: z.string().trim().refine(isValidCron, "Use five cron fields, e.g. 0 7 * * 1-5 for weekdays at 7:00"),
  format: z.enum(["pdf", "csv", "xlsx"]),
  recipients: z.array(z.string().trim().email("Each recipient must be an email address")).min(1, "Add at least one recipient").max(50),
  active: z.boolean().default(true),
});
const manageSchedules = requireAnyPermission(["settings"], "edit");

router.get("/schedules", manageSchedules, async (_req, res) => {
  res.json(await prisma.reportSchedule.findMany({ orderBy: [{ groupName: "asc" }, { createdAt: "asc" }] }));
});

router.post("/schedules", manageSchedules, async (req: AuthedRequest, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid schedule");
  const row = await prisma.reportSchedule.create({ data: { ...parsed.data, createdById: req.account!.id, createdBy: req.account!.username } });
  res.status(201).json(row);
});

router.put("/schedules/:id", manageSchedules, async (req: AuthedRequest, res) => {
  const parsed = scheduleSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid schedule");
  const existing = await prisma.reportSchedule.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, "Schedule not found");
  // Editing takes the schedule over: it runs as the editor from now on.
  const row = await prisma.reportSchedule.update({ where: { id: existing.id }, data: { ...parsed.data, createdById: req.account!.id, createdBy: req.account!.username } });
  res.json(row);
});

router.delete("/schedules/:id", manageSchedules, async (req, res) => {
  await prisma.reportSchedule.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

router.post("/schedules/:id/run", manageSchedules, async (req, res) => {
  try {
    res.json(await runSchedule(req.params.id));
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
});

export { EXPORT_FORMATS };
