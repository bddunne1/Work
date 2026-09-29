import type { Prisma } from "@prisma/client";
import { logAudit } from "../lib/audit.js";
import { prisma } from "../prisma.js";
import { QboHttpClient, SYSTEM, qboConfigured } from "./quickbooks/client.js";
import { fakeQuickBooks } from "./quickbooks/fake.js";
import type { QboAddress, QboDocLine, QuickBooksApi } from "./quickbooks/types.js";
import { QuickBooksError } from "./quickbooks/types.js";

// The accounting bridge: an outbox written in the same transaction as each
// document, and a worker that pushes outbox rows to QuickBooks with retry,
// resolving dependencies (customer and items before the invoice that
// references them) as it goes. Idempotent throughout: re-running never
// duplicates a customer, item or invoice.

type Tx = Prisma.TransactionClient;
type Action = "UPSERT" | "VOID";
type EntityType = "customer" | "item" | "invoice" | "credit-memo";

// Backoff after each failed attempt; a row that fails more times than this
// list is long is DEAD until someone retries it by hand.
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];

export function usingFakeQuickBooks(): boolean {
  return process.env.QBO_FAKE === "1";
}

let httpClient: QboHttpClient | null = null;
export function quickBooks(): QuickBooksApi {
  if (usingFakeQuickBooks()) return fakeQuickBooks;
  if (!httpClient) httpClient = new QboHttpClient();
  return httpClient;
}

export async function isConnected(): Promise<boolean> {
  if (usingFakeQuickBooks()) return true;
  if (!qboConfigured()) return false;
  return (await prisma.integrationConnection.count({ where: { system: SYSTEM } })) > 0;
}

// Queues work for the worker. A PENDING row for the same entity and action
// is reused rather than duplicated; a VOID supersedes a pending UPSERT.
export async function enqueueSync(tx: Tx, entityType: EntityType, entityId: string, action: Action): Promise<void> {
  if (action === "VOID") {
    await tx.syncOutbox.updateMany({
      where: { system: SYSTEM, entityType, entityId, action: "UPSERT", status: { in: ["PENDING", "FAILED"] } },
      data: { status: "DONE", processedAt: new Date(), lastError: "Superseded by void" },
    });
  }
  const existing = await tx.syncOutbox.findFirst({ where: { system: SYSTEM, entityType, entityId, action, status: { in: ["PENDING", "FAILED"] } } });
  if (existing) {
    await tx.syncOutbox.update({ where: { id: existing.id }, data: { nextAttemptAt: new Date() } });
    return;
  }
  await tx.syncOutbox.create({ data: { system: SYSTEM, entityType, entityId, action } });
}

// Queues an update only for records QuickBooks already knows - a customer
// or item that was never on an invoice has nothing to update there.
export async function enqueueIfSynced(tx: Tx, entityType: "customer" | "item", entityId: string): Promise<void> {
  const ref = await tx.externalRef.findUnique({ where: { system_entityType_entityId: { system: SYSTEM, entityType, entityId } } });
  if (ref) await enqueueSync(tx, entityType, entityId, "UPSERT");
}

async function getRef(entityType: EntityType, entityId: string) {
  return prisma.externalRef.findUnique({ where: { system_entityType_entityId: { system: SYSTEM, entityType, entityId } } });
}

async function saveRef(entityType: EntityType, entityId: string, ref: { id: string; syncToken: string }) {
  await prisma.externalRef.upsert({
    where: { system_entityType_entityId: { system: SYSTEM, entityType, entityId } },
    create: { system: SYSTEM, entityType, entityId, externalId: ref.id, syncToken: ref.syncToken },
    update: { externalId: ref.id, syncToken: ref.syncToken, lastSyncedAt: new Date() },
  });
}

function toAddr(a: unknown): QboAddress | undefined {
  const x = a as { name?: string; addressLine1?: string; addressLine2?: string; city?: string; state?: string; zip?: string } | null;
  if (!x) return undefined;
  return { line1: x.name, line2: x.addressLine1, line3: x.addressLine2 || undefined, city: x.city, state: x.state, postalCode: x.zip };
}

// ---- per-entity pushes -------------------------------------------------------------

async function pushCustomer(api: QuickBooksApi, customerId: string): Promise<string> {
  const c = await prisma.customer.findUnique({ where: { id: customerId }, include: { shipToLocations: true } });
  if (!c) throw new QuickBooksError(`Customer ${customerId} no longer exists`, 404, undefined, true);
  const existing = await getRef("customer", customerId);
  const ref = await api.upsertCustomer(existing?.externalId ?? null, {
    displayName: c.name,
    companyName: c.name,
    billAddr: toAddr(c.billTo),
    shipAddr: toAddr(c.shipToLocations[0]?.address),
    taxable: !c.taxExempt,
    notes: c.accountNumber ? `Account ${c.accountNumber}` : undefined,
  });
  await saveRef("customer", customerId, ref);
  return ref.id;
}

// A document for a customer this system doesn't have a record for (a
// walk-in typed straight into the order) still needs a QuickBooks customer;
// it's keyed by the bill-to name.
async function pushAdHocCustomer(api: QuickBooksApi, name: string, billTo: unknown): Promise<string> {
  const key = `name:${name.trim().toLowerCase()}`;
  const existing = await getRef("customer", key);
  const ref = await api.upsertCustomer(existing?.externalId ?? null, { displayName: name.trim(), billAddr: toAddr(billTo), taxable: true });
  await saveRef("customer", key, ref);
  return ref.id;
}

async function pushItem(api: QuickBooksApi, itemId: string): Promise<string> {
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) throw new QuickBooksError(`Item ${itemId} no longer exists`, 404, undefined, true);
  const existing = await getRef("item", itemId);
  const ref = await api.upsertItem(existing?.externalId ?? null, {
    name: item.itemNumber,
    sku: item.itemNumber,
    description: item.description,
    unitPrice: Number(item.rate),
  });
  await saveRef("item", itemId, ref);
  return ref.id;
}

// A line whose catalog item was deleted is billed under its item number.
async function pushAdHocItem(api: QuickBooksApi, itemNumber: string, description: string, rate: number): Promise<string> {
  const key = `name:${itemNumber.trim().toLowerCase()}`;
  const existing = await getRef("item", key);
  const ref = await api.upsertItem(existing?.externalId ?? null, { name: itemNumber, sku: itemNumber, description, unitPrice: rate });
  await saveRef("item", key, ref);
  return ref.id;
}

async function docLines(api: QuickBooksApi, lines: { itemId: string | null; item: string; description: string; qty: number; rate: Prisma.Decimal; amount: Prisma.Decimal }[]): Promise<QboDocLine[]> {
  const out: QboDocLine[] = [];
  for (const l of lines) {
    const itemRefId = l.itemId ? await pushItem(api, l.itemId) : await pushAdHocItem(api, l.item, l.description, Number(l.rate));
    out.push({ itemRefId, description: `${l.item} - ${l.description}`.slice(0, 4000), qty: l.qty, unitPrice: Number(l.rate), amount: Number(l.amount) });
  }
  return out;
}

// A document that QuickBooks says it no longer has needs no voiding: the
// outcome we wanted already holds, so the row completes instead of dying.
function goneIsVoided(err: unknown): null {
  if (err instanceof QuickBooksError && (err.status === 404 || /object not found/i.test(err.message))) return null;
  throw err;
}

async function pushInvoice(api: QuickBooksApi, invoiceNumber: string, action: Action): Promise<string> {
  const inv = await prisma.invoice.findUnique({ where: { invoiceNumber }, include: { lines: true } });
  if (!inv) throw new QuickBooksError(`Invoice ${invoiceNumber} no longer exists`, 404, undefined, true);
  const existing = await getRef("invoice", invoiceNumber);
  if (action === "VOID" || inv.status === "VOID") {
    if (!existing) return "never reached QuickBooks - nothing to void";
    const ref = await api.voidInvoice(existing.externalId).catch(goneIsVoided);
    if (!ref) return `QuickBooks invoice ${existing.externalId} no longer exists - nothing to void`;
    await saveRef("invoice", invoiceNumber, ref);
    return `voided QuickBooks invoice ${ref.id}`;
  }
  const customerRefId = inv.customerId ? await pushCustomer(api, inv.customerId) : await pushAdHocCustomer(api, inv.customerName, inv.billTo);
  const ref = await api.createInvoice({
    docNumber: inv.invoiceNumber,
    customerRefId,
    txnDate: inv.invoiceDate.toISOString().slice(0, 10),
    dueDate: inv.dueDate.toISOString().slice(0, 10),
    poNumber: inv.poNumber,
    customerMemo: inv.poNumber ? `Your PO ${inv.poNumber}` : undefined,
    privateNote: `S.O. #${inv.soNumber}`,
    billAddr: toAddr(inv.billTo),
    shipAddr: toAddr(inv.shipTo),
    lines: await docLines(api, inv.lines),
    totalTax: Number(inv.tax),
    total: Number(inv.total),
  });
  await saveRef("invoice", invoiceNumber, ref);
  return `QuickBooks invoice ${ref.id}`;
}

async function pushCreditMemo(api: QuickBooksApi, creditMemoNumber: string, action: Action): Promise<string> {
  const memo = await prisma.creditMemo.findUnique({ where: { creditMemoNumber }, include: { lines: true } });
  if (!memo) throw new QuickBooksError(`Credit memo ${creditMemoNumber} no longer exists`, 404, undefined, true);
  const existing = await getRef("credit-memo", creditMemoNumber);
  if (action === "VOID" || memo.status === "VOID") {
    if (!existing) return "never reached QuickBooks - nothing to void";
    const ref = await api.voidCreditMemo(existing.externalId).catch(goneIsVoided);
    if (!ref) return `QuickBooks credit memo ${existing.externalId} no longer exists - nothing to void`;
    await saveRef("credit-memo", creditMemoNumber, ref);
    return `voided QuickBooks credit memo ${ref.id}`;
  }
  const customerRefId = memo.customerId ? await pushCustomer(api, memo.customerId) : await pushAdHocCustomer(api, memo.customerName, memo.billTo);
  const ref = await api.createCreditMemo({
    docNumber: memo.creditMemoNumber,
    customerRefId,
    txnDate: memo.memoDate.toISOString().slice(0, 10),
    customerMemo: memo.reason || undefined,
    privateNote: `${memo.raNumber}${memo.soNumber ? ` against S.O. #${memo.soNumber}` : ""}`,
    billAddr: toAddr(memo.billTo),
    lines: await docLines(api, memo.lines),
    totalTax: Number(memo.tax),
    total: Number(memo.total),
  });
  await saveRef("credit-memo", creditMemoNumber, ref);
  return `QuickBooks credit memo ${ref.id}`;
}

async function handle(api: QuickBooksApi, row: { entityType: string; entityId: string; action: string }): Promise<string> {
  const action = row.action as Action;
  switch (row.entityType as EntityType) {
    case "customer":
      return `QuickBooks customer ${await pushCustomer(api, row.entityId)}`;
    case "item":
      return `QuickBooks item ${await pushItem(api, row.entityId)}`;
    case "invoice":
      return pushInvoice(api, row.entityId, action);
    case "credit-memo":
      return pushCreditMemo(api, row.entityId, action);
    default:
      throw new QuickBooksError(`Unknown entity type ${row.entityType}`, 400, undefined, true);
  }
}

// ---- the worker ---------------------------------------------------------------------

export interface SyncRunSummary {
  attempted: number;
  done: number;
  failed: number;
  dead: number;
  skipped: number;
  reason?: string;
}

let running = false;

export async function processOutbox(opts: { limit?: number; now?: Date; ids?: string[] } = {}): Promise<SyncRunSummary> {
  const now = opts.now ?? new Date();
  const summary: SyncRunSummary = { attempted: 0, done: 0, failed: 0, dead: 0, skipped: 0 };
  if (running) {
    summary.reason = "A sync is already running.";
    return summary;
  }
  running = true;
  try {
    const where: Prisma.SyncOutboxWhereInput = opts.ids
      ? { id: { in: opts.ids }, system: SYSTEM }
      : { system: SYSTEM, status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } };
    const rows = await prisma.syncOutbox.findMany({ where, orderBy: { createdAt: "asc" }, take: opts.limit ?? 100 });
    if (rows.length === 0) return summary;
    if (!(await isConnected())) {
      summary.skipped = rows.length;
      summary.reason = qboConfigured() ? "QuickBooks is not connected - connect it under Settings." : "QuickBooks is not configured (QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI).";
      return summary;
    }
    const api = quickBooks();
    for (const row of rows) {
      summary.attempted++;
      await prisma.syncOutbox.update({ where: { id: row.id }, data: { status: "PROCESSING" } });
      try {
        const message = await handle(api, row);
        await prisma.syncOutbox.update({ where: { id: row.id }, data: { status: "DONE", processedAt: new Date(), lastError: null, attempts: { increment: 1 } } });
        await prisma.syncLog.create({ data: { system: SYSTEM, entityType: row.entityType, entityId: row.entityId, action: row.action, ok: true, message } });
        summary.done++;
      } catch (err) {
        const attempts = row.attempts + 1;
        const permanent = err instanceof QuickBooksError && err.permanent;
        const dead = permanent || attempts > BACKOFF_MS.length;
        const message = err instanceof Error ? err.message : String(err);
        await prisma.syncOutbox.update({
          where: { id: row.id },
          data: {
            status: dead ? "DEAD" : "FAILED",
            attempts,
            lastError: message.slice(0, 2000),
            nextAttemptAt: dead ? row.nextAttemptAt : new Date(now.getTime() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]),
          },
        });
        await prisma.syncLog.create({
          data: {
            system: SYSTEM,
            entityType: row.entityType,
            entityId: row.entityId,
            action: row.action,
            ok: false,
            message: message.slice(0, 2000),
            detail: err instanceof QuickBooksError && err.detail ? (JSON.parse(JSON.stringify(err.detail)) as Prisma.InputJsonValue) : undefined,
          },
        });
        if (dead) summary.dead++;
        else summary.failed++;
      }
    }
    return summary;
  } finally {
    running = false;
  }
}

// Puts DEAD (or any) rows back in the queue for an immediate attempt.
export async function retryOutbox(ids: string[], actor: { id: string; username: string }): Promise<number> {
  const res = await prisma.syncOutbox.updateMany({
    where: { id: { in: ids }, system: SYSTEM },
    data: { status: "PENDING", nextAttemptAt: new Date(), lastError: null },
  });
  logAudit(actor, "SYNC_RETRIED", "sync-outbox", null, `${res.count} rows`, { ids });
  return res.count;
}

// Our invoices for a date range against QuickBooks', by document number.
export interface ReconcileReport {
  from: string;
  to: string;
  ours: number;
  theirs: number;
  missingInQuickBooks: { invoiceNumber: string; total: string; customerName: string; invoiceDate: string; syncStatus: string }[];
  missingHere: { docNumber: string; total: number; customerName: string; txnDate: string }[];
  totalMismatch: { invoiceNumber: string; ours: string; theirs: number }[];
  voidMismatch: { invoiceNumber: string; oursVoid: boolean; theirsVoid: boolean }[];
}

export async function reconcileInvoices(from: string, to: string): Promise<ReconcileReport> {
  const [ours, theirs, outbox] = await Promise.all([
    prisma.invoice.findMany({ where: { invoiceDate: { gte: new Date(from), lte: new Date(to) } } }),
    quickBooks().listInvoices(from, to),
    prisma.syncOutbox.findMany({ where: { system: SYSTEM, entityType: "invoice" }, orderBy: { createdAt: "desc" } }),
  ]);
  const theirsByDoc = new Map(theirs.map((t) => [t.docNumber, t]));
  const oursByDoc = new Map(ours.map((o) => [o.invoiceNumber, o]));
  const syncStatus = (n: string) => outbox.find((r) => r.entityId === n)?.status ?? "not queued";
  const report: ReconcileReport = { from, to, ours: ours.length, theirs: theirs.length, missingInQuickBooks: [], missingHere: [], totalMismatch: [], voidMismatch: [] };
  for (const o of ours) {
    const t = theirsByDoc.get(o.invoiceNumber);
    if (!t) {
      if (o.status !== "VOID") report.missingInQuickBooks.push({ invoiceNumber: o.invoiceNumber, total: o.total.toString(), customerName: o.customerName, invoiceDate: o.invoiceDate.toISOString().slice(0, 10), syncStatus: syncStatus(o.invoiceNumber) });
      continue;
    }
    const oursVoid = o.status === "VOID";
    if (oursVoid !== t.voided) report.voidMismatch.push({ invoiceNumber: o.invoiceNumber, oursVoid, theirsVoid: t.voided });
    else if (!oursVoid && Math.abs(Number(o.total) - t.total) >= 0.005) report.totalMismatch.push({ invoiceNumber: o.invoiceNumber, ours: o.total.toString(), theirs: t.total });
  }
  for (const t of theirs) {
    if (!oursByDoc.has(t.docNumber)) report.missingHere.push({ docNumber: t.docNumber, total: t.total, customerName: t.customerName, txnDate: t.txnDate });
  }
  return report;
}

// Background schedule: QBO_SYNC_INTERVAL_MS (default 60000; 0 disables).
export function startSyncScheduler(): (() => void) | null {
  const interval = Number(process.env.QBO_SYNC_INTERVAL_MS ?? 60_000);
  if (!Number.isFinite(interval) || interval <= 0) return null;
  const timer = setInterval(() => {
    processOutbox().then((s) => {
      if (s.attempted > 0) console.log(`QuickBooks sync: ${s.done} done, ${s.failed} to retry, ${s.dead} dead`);
    }).catch((err) => console.error("QuickBooks sync failed:", err));
  }, interval);
  timer.unref();
  return () => clearInterval(timer);
}
