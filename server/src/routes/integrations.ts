import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { SYSTEM, authorizeUrl, disconnect, exchangeCode, qboConfigured, qboEnvironment } from "../integrations/quickbooks/client.js";
import { isConnected, processOutbox, quickBooks, reconcileInvoices, retryOutbox, usingFakeQuickBooks } from "../integrations/sync.js";
import { secretsEncrypted } from "../integrations/secrets.js";
import { logAudit } from "../lib/audit.js";
import { HttpError } from "../lib/conflictError.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

// /api/integrations/quickbooks - connection, sync status and controls.
// Administrative: admin, or edit on the Settings page.

const router = Router();

function requireSettings(req: AuthedRequest): void {
  const a = req.account;
  if (!(a?.role === "ADMIN" || a?.permissions?.settings === "edit")) throw new HttpError(403, "This needs edit access to Settings.");
}

// OAuth state values handed out by /connect, good for ten minutes. In-memory
// is fine for the single API process.
const pendingStates = new Map<string, { accountId: string; username: string; expires: number }>();

// Where the browser lands after Intuit redirects back: the frontend's
// Settings page. FRONTEND_URL is the SPA's origin (default: the API itself,
// for a single-origin deployment).
function frontendSettingsUrl(result: string): string {
  const base = process.env.FRONTEND_URL ?? "";
  return `${base}/#/settings?quickbooks=${encodeURIComponent(result)}`;
}

// Intuit calls this without our token, so it sits before requireAuth and
// trusts only the state it issued.
router.get("/quickbooks/callback", async (req, res) => {
  const { code, realmId, state, error } = req.query as Record<string, string | undefined>;
  if (error) {
    res.redirect(frontendSettingsUrl(`error:${error}`));
    return;
  }
  const pending = state ? pendingStates.get(state) : undefined;
  if (!pending || pending.expires < Date.now() || !code || !realmId) {
    res.redirect(frontendSettingsUrl("error:state"));
    return;
  }
  pendingStates.delete(state!);
  try {
    await exchangeCode(code, realmId, pending.username);
    logAudit({ id: pending.accountId, username: pending.username }, "QUICKBOOKS_CONNECTED", "integration", SYSTEM, realmId);
    res.redirect(frontendSettingsUrl("connected"));
  } catch (err) {
    console.error("QuickBooks connect failed:", err);
    res.redirect(frontendSettingsUrl("error:exchange"));
  }
});

router.use(requireAuth);

router.get("/quickbooks/status", async (req: AuthedRequest, res) => {
  requireSettings(req);
  const [conn, pending, failed, dead, lastOk, lastFail] = await Promise.all([
    prisma.integrationConnection.findUnique({ where: { system: SYSTEM } }),
    prisma.syncOutbox.count({ where: { system: SYSTEM, status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.syncOutbox.count({ where: { system: SYSTEM, status: "FAILED" } }),
    prisma.syncOutbox.count({ where: { system: SYSTEM, status: "DEAD" } }),
    prisma.syncLog.findFirst({ where: { system: SYSTEM, ok: true }, orderBy: { createdAt: "desc" } }),
    prisma.syncLog.findFirst({ where: { system: SYSTEM, ok: false }, orderBy: { createdAt: "desc" } }),
  ]);
  let company: { companyName: string; realmId: string } | null = null;
  let companyError: string | null = null;
  if (await isConnected()) {
    try {
      company = await quickBooks().companyInfo();
    } catch (err) {
      companyError = err instanceof Error ? err.message : String(err);
    }
  }
  res.json({
    configured: qboConfigured() || usingFakeQuickBooks(),
    fake: usingFakeQuickBooks(),
    environment: qboEnvironment(),
    connected: Boolean(conn) || usingFakeQuickBooks(),
    realmId: conn?.realmId ?? null,
    connectedBy: conn?.connectedBy ?? null,
    connectedAt: conn?.connectedAt ?? null,
    refreshExpiresAt: conn?.refreshExpiresAt ?? null,
    tokensEncrypted: secretsEncrypted(),
    company,
    companyError,
    queue: { pending, failed, dead },
    lastSuccess: lastOk ? { at: lastOk.createdAt, message: lastOk.message } : null,
    lastFailure: lastFail ? { at: lastFail.createdAt, message: lastFail.message, entity: `${lastFail.entityType} ${lastFail.entityId}` } : null,
    schedulerIntervalMs: Number(process.env.QBO_SYNC_INTERVAL_MS ?? 60_000),
  });
});

router.post("/quickbooks/connect", async (req: AuthedRequest, res) => {
  requireSettings(req);
  if (!qboConfigured()) throw new HttpError(400, "QuickBooks isn't configured on the server: set QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_REDIRECT_URI.");
  for (const [k, v] of pendingStates) if (v.expires < Date.now()) pendingStates.delete(k);
  const state = randomBytes(24).toString("base64url");
  pendingStates.set(state, { accountId: req.account!.id, username: req.account!.username, expires: Date.now() + 10 * 60_000 });
  res.json({ url: authorizeUrl(state) });
});

router.post("/quickbooks/disconnect", async (req: AuthedRequest, res) => {
  requireSettings(req);
  await disconnect();
  logAudit(req.account!, "QUICKBOOKS_DISCONNECTED", "integration", SYSTEM, SYSTEM);
  res.status(204).end();
});

router.post("/quickbooks/sync-now", async (req: AuthedRequest, res) => {
  requireSettings(req);
  const summary = await processOutbox({ limit: 200 });
  logAudit(req.account!, "SYNC_RUN", "integration", SYSTEM, SYSTEM, { ...summary });
  res.json(summary);
});

const retrySchema = z.object({ ids: z.array(z.string()).min(1).max(500) });
router.post("/quickbooks/retry", async (req: AuthedRequest, res) => {
  requireSettings(req);
  const parsed = retrySchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "ids required");
  const count = await retryOutbox(parsed.data.ids, req.account!);
  const summary = await processOutbox({ ids: parsed.data.ids });
  res.json({ requeued: count, ...summary });
});

router.get("/quickbooks/outbox", async (req: AuthedRequest, res) => {
  requireSettings(req);
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase().split(",").filter(Boolean) : undefined;
  const rows = await prisma.syncOutbox.findMany({
    where: { system: SYSTEM, ...(status && status.length ? { status: { in: status } } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(req.query.limit) || 200, 1000),
  });
  res.json(rows);
});

router.get("/quickbooks/log", async (req: AuthedRequest, res) => {
  requireSettings(req);
  const rows = await prisma.syncLog.findMany({
    where: { system: SYSTEM, ...(req.query.ok === "0" ? { ok: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(req.query.limit) || 200, 1000),
  });
  res.json(rows);
});

router.get("/quickbooks/reconcile", async (req: AuthedRequest, res) => {
  requireSettings(req);
  const to = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10);
  const from =
    typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
      ? req.query.from
      : new Date(new Date(to).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  if (!(await isConnected())) throw new HttpError(400, "QuickBooks is not connected.");
  res.json(await reconcileInvoices(from, to));
});

export default router;
