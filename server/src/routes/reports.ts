import { Router } from "express";
import { HttpError } from "../lib/conflictError.js";
import { describeSource, readableSources, runReport } from "../lib/reports/engine.js";
import { REPORT_SOURCES, runRequestSchema, tzOffsetSchema } from "../lib/reports/spec.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

// The report engine's API (see lib/reports): run a spec, and describe what
// the account may build one from.
//   POST /api/reports/run        { spec, tzOffset, page?, pageSize? }
//   GET  /api/reports/sources?tzOffset=300
const router = Router();

router.use(requireAuth);
router.use(requirePermission("reports", "view"));

router.post("/run", async (req: AuthedRequest, res) => {
  const parsed = runRequestSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid report");
  const { spec, tzOffset, page, pageSize } = parsed.data;
  res.json(await runReport(spec, { account: req.account!, tzOffset, page, pageSize }));
});

router.get("/sources", (req: AuthedRequest, res) => {
  const tzOffset = tzOffsetSchema.parse(req.query.tzOffset ?? 0);
  const readable = readableSources(req.account!);
  res.json(REPORT_SOURCES.filter((k) => readable.includes(k)).map((k) => describeSource(req.account!, k, tzOffset)));
});

export default router;
