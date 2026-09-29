import { Prisma, type InvoiceStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { enqueueSync } from "../integrations/sync.js";
import { logAudit } from "../lib/audit.js";
import { HttpError } from "../lib/conflictError.js";
import { CHARGE_CODES, documentTotals, issueCreditMemo, issueInvoice, reviewedLines } from "../lib/documents.js";
import { fromCents } from "../lib/money.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

// Invoices and credit memos are raised as drafts by shipments and received
// returns (see lib/documents.ts). This is the review queue: Accounting
// reprices a line, adds freight and other charges, then issues the draft,
// which assigns its number and sends it to QuickBooks. Page key: "invoices".
// Documents are addressed by their number once issued, or by id while a
// draft (a draft has no number yet).

const router = Router();
router.use(requireAuth);

const MAX_PAGE = 500;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function dateOnly(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function paging(q: Record<string, unknown>) {
  const page = Math.max(1, parseInt(str(q.page), 10) || 1);
  const pageSize = Math.min(MAX_PAGE, Math.max(1, parseInt(str(q.pageSize), 10) || 50));
  return { page, pageSize, skip: (page - 1) * pageSize };
}
function statusFilter(q: Record<string, unknown>): InvoiceStatus | undefined {
  const s = str(q.status).toUpperCase();
  return s === "DRAFT" || s === "ISSUED" || s === "VOID" ? s : undefined;
}

// Attach each document's QuickBooks state so the list can show it. A draft
// is not queued anywhere yet.
async function withSync<T extends { status: string; [k: string]: unknown }>(rows: T[], entityType: "invoice" | "credit-memo", key: keyof T) {
  const ids = rows.map((r) => (r[key] == null ? "" : String(r[key]))).filter(Boolean);
  const [refs, outbox] = ids.length
    ? await Promise.all([
        prisma.externalRef.findMany({ where: { system: "quickbooks", entityType, entityId: { in: ids } } }),
        prisma.syncOutbox.findMany({ where: { system: "quickbooks", entityType, entityId: { in: ids } }, orderBy: { createdAt: "desc" } }),
      ])
    : [[], []];
  const refBy = new Map(refs.map((r) => [r.entityId, r]));
  const outBy = new Map<string, (typeof outbox)[number]>();
  for (const o of outbox) if (!outBy.has(o.entityId)) outBy.set(o.entityId, o);
  return rows.map((r) => {
    if (r.status === "DRAFT") return { ...r, sync: { status: "DRAFT", externalId: null, lastError: null } };
    const id = String(r[key]);
    const ref = refBy.get(id);
    const out = outBy.get(id);
    const status = out?.status === "DONE" ? (ref ? "SYNCED" : "DONE") : out?.status ?? (ref ? "SYNCED" : "NOT_QUEUED");
    return { ...r, sync: { status, externalId: ref?.externalId ?? null, lastError: out?.lastError ?? null } };
  });
}

const invoiceInclude = { lines: { orderBy: { position: "asc" as const } } };

async function findInvoice(ref: string) {
  const byNumber = /^INV-/i.test(ref) ? await prisma.invoice.findUnique({ where: { invoiceNumber: ref.toUpperCase() }, include: invoiceInclude }) : null;
  return byNumber ?? (await prisma.invoice.findUnique({ where: { id: ref }, include: invoiceInclude }));
}
async function findMemo(ref: string) {
  const byNumber = /^CM-/i.test(ref) ? await prisma.creditMemo.findUnique({ where: { creditMemoNumber: ref.toUpperCase() }, include: invoiceInclude }) : null;
  return byNumber ?? (await prisma.creditMemo.findUnique({ where: { id: ref }, include: invoiceInclude }));
}

// ---- lists ---------------------------------------------------------------

router.get("/", requirePermission("invoices", "view"), async (req, res) => {
  const q = req.query as Record<string, unknown>;
  const where: Prisma.InvoiceWhereInput = {};
  const status = statusFilter(q);
  if (status) where.status = status;
  if (str(q.customerId)) where.customerId = str(q.customerId);
  if (str(q.soNumber)) where.soNumber = parseInt(str(q.soNumber), 10) || -1;
  const text = str(q.q);
  if (text) {
    where.OR = [
      { invoiceNumber: { contains: text, mode: "insensitive" } },
      { poNumber: { contains: text, mode: "insensitive" } },
      { customerName: { contains: text, mode: "insensitive" } },
    ];
    if (/^\d+$/.test(text)) where.OR.push({ soNumber: parseInt(text, 10) });
  }
  const from = dateOnly(str(q.from));
  const to = dateOnly(str(q.to));
  if (from || to) where.invoiceDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const { page, pageSize, skip } = paging(q);
  // The queue is worked oldest first; history reads newest first.
  const orderBy: Prisma.InvoiceOrderByWithRelationInput[] = status === "DRAFT" ? [{ createdAt: "asc" }] : [{ invoiceDate: "desc" }, { createdAt: "desc" }];
  const [total, rows] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({ where, orderBy, skip, take: pageSize, include: invoiceInclude }),
  ]);
  res.json({ rows: await withSync(rows, "invoice", "invoiceNumber"), total, page, pageSize });
});

// How much is waiting for review - the Dashboard tile.
router.get("/queue", requirePermission("invoices", "view"), async (_req, res) => {
  const [invoices, creditMemos, oldest] = await Promise.all([
    prisma.invoice.count({ where: { status: "DRAFT" } }),
    prisma.creditMemo.count({ where: { status: "DRAFT" } }),
    prisma.invoice.findFirst({ where: { status: "DRAFT" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  res.json({ invoices, creditMemos, oldestDraftAt: oldest?.createdAt ?? null });
});

router.get("/charge-codes", requirePermission("invoices", "view"), (_req, res) => {
  res.json(CHARGE_CODES);
});

router.get("/credit-memos", requirePermission("invoices", "view"), async (req, res) => {
  const q = req.query as Record<string, unknown>;
  const where: Prisma.CreditMemoWhereInput = {};
  const status = statusFilter(q);
  if (status) where.status = status;
  if (str(q.customerId)) where.customerId = str(q.customerId);
  const text = str(q.q);
  if (text) {
    where.OR = [
      { creditMemoNumber: { contains: text, mode: "insensitive" } },
      { raNumber: { contains: text, mode: "insensitive" } },
      { soNumber: { contains: text, mode: "insensitive" } },
      { customerName: { contains: text, mode: "insensitive" } },
    ];
  }
  const { page, pageSize, skip } = paging(q);
  const orderBy: Prisma.CreditMemoOrderByWithRelationInput[] = status === "DRAFT" ? [{ createdAt: "asc" }] : [{ memoDate: "desc" }, { createdAt: "desc" }];
  const [total, rows] = await Promise.all([
    prisma.creditMemo.count({ where }),
    prisma.creditMemo.findMany({ where, orderBy, skip, take: pageSize, include: invoiceInclude }),
  ]);
  res.json({ rows: await withSync(rows, "credit-memo", "creditMemoNumber"), total, page, pageSize });
});

// ---- credit memos --------------------------------------------------------

const lineSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["ITEM", "CHARGE"]),
  item: z.string().trim().max(50),
  description: z.string().trim().max(500),
  um: z.string().trim().max(20).optional(),
  qty: z.number().int(),
  rate: z.number().finite(),
  taxable: z.boolean(),
});
const draftSchema = z.object({
  version: z.number().int(),
  notes: z.string().max(5000).optional(),
  lines: z.array(lineSchema).max(200),
});
const issueSchema = z.object({ version: z.number().int() });
const voidSchema = z.object({ reason: z.string().trim().min(1, "Give a reason").max(2000) });

router.get("/credit-memos/:ref", requirePermission("invoices", "view"), async (req, res) => {
  const memo = await findMemo(req.params.ref);
  if (!memo) throw new HttpError(404, "Credit memo not found");
  res.json((await withSync([memo], "credit-memo", "creditMemoNumber"))[0]);
});

// Review edits on a draft credit memo: rates, and deduction lines.
router.put("/credit-memos/:ref", requirePermission("invoices", "edit"), async (req: AuthedRequest, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const found = await findMemo(req.params.ref);
  if (!found) throw new HttpError(404, "Credit memo not found");
  await prisma.$transaction(async (tx) => {
    const memo = await tx.creditMemo.findUnique({ where: { id: found.id }, include: { lines: true } });
    if (!memo) throw new HttpError(404, "Credit memo not found");
    if (memo.status !== "DRAFT") throw new HttpError(409, `${memo.creditMemoNumber} has been issued and can't be edited. Void it and receive the return again if it is wrong.`, { conflict: true });
    if (memo.version !== parsed.data.version) throw new HttpError(409, "This draft was changed by someone else since you loaded it. Reload and try again.", { conflict: true });
    const rows = reviewedLines(memo.lines, parsed.data.lines, true);
    const totals = documentTotals(rows, memo.taxRate);
    if (totals.totalCents < 0) throw new HttpError(400, "The deductions exceed the credit - the total can't be negative.");
    await tx.creditMemoLine.deleteMany({ where: { creditMemoId: memo.id, id: { notIn: rows.map((r) => r.id).filter((id): id is string => Boolean(id)) } } });
    for (const r of rows) {
      const data = { position: r.position, kind: r.kind, taxable: r.taxable, itemId: r.itemId, item: r.item, description: r.description, um: r.um, qty: r.qty, rate: r.rate, amount: fromCents(r.amountCents), returnLineId: r.returnLineId };
      if (r.id) await tx.creditMemoLine.update({ where: { id: r.id }, data });
      else await tx.creditMemoLine.create({ data: { ...data, creditMemoId: memo.id } });
    }
    await tx.creditMemo.update({
      where: { id: memo.id },
      data: { subtotal: fromCents(totals.subtotalCents), tax: fromCents(totals.taxCentsValue), total: fromCents(totals.totalCents), version: { increment: 1 } },
    });
  });
  const memo = await findMemo(found.id);
  res.json((await withSync([memo!], "credit-memo", "creditMemoNumber"))[0]);
});

router.post("/credit-memos/:ref/issue", requirePermission("invoices", "edit"), async (req: AuthedRequest, res) => {
  const parsed = issueSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const found = await findMemo(req.params.ref);
  if (!found) throw new HttpError(404, "Credit memo not found");
  const issued = await prisma.$transaction((tx) => issueCreditMemo(tx, found.id, parsed.data.version, req.account!));
  logAudit(req.account!, "CREDIT_MEMO_ISSUED", "credit-memo", issued.creditMemoNumber!, issued.creditMemoNumber!, { raNumber: issued.raNumber, total: issued.total.toString() });
  res.json((await withSync([issued], "credit-memo", "creditMemoNumber"))[0]);
});

router.post("/credit-memos/:ref/void", requirePermission("invoices", "edit"), async (req: AuthedRequest, res) => {
  const parsed = voidSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const found = await findMemo(req.params.ref);
  if (!found) throw new HttpError(404, "Credit memo not found");
  await prisma.$transaction(async (tx) => {
    const memo = await tx.creditMemo.findUnique({ where: { id: found.id } });
    if (!memo) throw new HttpError(404, "Credit memo not found");
    if (memo.status === "DRAFT") throw new HttpError(409, "A draft has not been issued, so there is nothing to void. It disappears if the return is reopened.", { conflict: true });
    if (memo.status === "VOID") throw new HttpError(409, `${memo.creditMemoNumber} is already void.`, { conflict: true });
    await tx.creditMemo.update({ where: { id: memo.id }, data: { status: "VOID", voidedAt: new Date(), voidedBy: req.account!.username, voidReason: parsed.data.reason } });
    await enqueueSync(tx, "credit-memo", memo.creditMemoNumber!, "VOID");
  });
  logAudit(req.account!, "CREDIT_MEMO_VOIDED", "credit-memo", found.creditMemoNumber!, found.creditMemoNumber!, { reason: parsed.data.reason });
  const memo = await findMemo(found.id);
  res.json((await withSync([memo!], "credit-memo", "creditMemoNumber"))[0]);
});

// ---- invoices ------------------------------------------------------------

router.get("/:ref", requirePermission("invoices", "view"), async (req, res) => {
  const invoice = await findInvoice(req.params.ref);
  if (!invoice) throw new HttpError(404, "Invoice not found");
  res.json((await withSync([invoice], "invoice", "invoiceNumber"))[0]);
});

// Review edits on a draft: a note, rates on shipped lines, charge lines.
router.put("/:ref", requirePermission("invoices", "edit"), async (req: AuthedRequest, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const found = await findInvoice(req.params.ref);
  if (!found) throw new HttpError(404, "Invoice not found");
  const changes: Record<string, unknown> = {};
  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: found.id }, include: { lines: true } });
    if (!invoice) throw new HttpError(404, "Invoice not found");
    if (invoice.status !== "DRAFT") throw new HttpError(409, `${invoice.invoiceNumber} has been issued and can't be edited. Void it and undo the shipment if it is wrong.`, { conflict: true });
    if (invoice.version !== parsed.data.version) throw new HttpError(409, "This draft was changed by someone else since you loaded it. Reload and try again.", { conflict: true });
    const rows = reviewedLines(invoice.lines, parsed.data.lines, false);
    const totals = documentTotals(rows, invoice.taxRate);
    const before = new Map(invoice.lines.map((l) => [l.id, l]));
    for (const r of rows) {
      const was = r.id ? before.get(r.id) : undefined;
      if (was && !was.rate.equals(r.rate)) changes[was.item] = { from: was.rate.toString(), to: r.rate.toString() };
    }
    changes.charges = rows.filter((r) => r.kind === "CHARGE").map((r) => `${r.item} ${r.description} ${fromCents(r.amountCents)}`);
    await tx.invoiceLine.deleteMany({ where: { invoiceId: invoice.id, id: { notIn: rows.map((r) => r.id).filter((id): id is string => Boolean(id)) } } });
    for (const r of rows) {
      const data = { position: r.position, kind: r.kind, taxable: r.taxable, itemId: r.itemId, item: r.item, description: r.description, um: r.um, qty: r.qty, rate: r.rate, amount: fromCents(r.amountCents), salesOrderLineId: r.salesOrderLineId };
      if (r.id) await tx.invoiceLine.update({ where: { id: r.id }, data });
      else await tx.invoiceLine.create({ data: { ...data, invoiceId: invoice.id } });
    }
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        subtotal: fromCents(totals.subtotalCents),
        tax: fromCents(totals.taxCentsValue),
        total: fromCents(totals.totalCents),
        version: { increment: 1 },
      },
    });
  });
  logAudit(req.account!, "INVOICE_DRAFT_UPDATED", "invoice", found.id, `Draft for S.O. #${found.soNumber}`, changes);
  const invoice = await findInvoice(found.id);
  res.json((await withSync([invoice!], "invoice", "invoiceNumber"))[0]);
});

// Approve and issue: the number is assigned here and the push queued.
router.post("/:ref/issue", requirePermission("invoices", "edit"), async (req: AuthedRequest, res) => {
  const parsed = issueSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const found = await findInvoice(req.params.ref);
  if (!found) throw new HttpError(404, "Invoice not found");
  const issued = await prisma.$transaction((tx) => issueInvoice(tx, found.id, parsed.data.version, req.account!));
  logAudit(req.account!, "INVOICE_ISSUED", "invoice", issued.invoiceNumber!, issued.invoiceNumber!, { soNumber: issued.soNumber, total: issued.total.toString(), charges: issued.lines.filter((l) => l.kind === "CHARGE").length });
  res.json((await withSync([issued], "invoice", "invoiceNumber"))[0]);
});

// Voids an issued invoice that should not have been raised (wrong price,
// wrong customer). The shipment stands; correct the order and re-raise by
// undoing and re-confirming the shipment if the goods were right.
router.post("/:ref/void", requirePermission("invoices", "edit"), async (req: AuthedRequest, res) => {
  const parsed = voidSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const found = await findInvoice(req.params.ref);
  if (!found) throw new HttpError(404, "Invoice not found");
  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: found.id } });
    if (!invoice) throw new HttpError(404, "Invoice not found");
    if (invoice.status === "DRAFT") throw new HttpError(409, "A draft has not been issued, so there is nothing to void. Undo the shipment to remove it.", { conflict: true });
    if (invoice.status === "VOID") throw new HttpError(409, `${invoice.invoiceNumber} is already void.`, { conflict: true });
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: "VOID", voidedAt: new Date(), voidedBy: req.account!.username, voidReason: parsed.data.reason } });
    await enqueueSync(tx, "invoice", invoice.invoiceNumber!, "VOID");
  });
  logAudit(req.account!, "INVOICE_VOIDED", "invoice", found.invoiceNumber!, found.invoiceNumber!, { reason: parsed.data.reason });
  const invoice = await findInvoice(found.id);
  res.json((await withSync([invoice!], "invoice", "invoiceNumber"))[0]);
});

export default router;
