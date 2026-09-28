import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { enqueueSync } from "../integrations/sync.js";
import { logAudit } from "../lib/audit.js";
import { HttpError } from "../lib/conflictError.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

// Invoices and credit memos are raised automatically (see lib/documents.ts)
// and read here; the only write is a void, which is a correction that also
// propagates to QuickBooks. Page key: "invoices".

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

// Attach each document's QuickBooks state so the list can show it.
async function withSync<T extends { [k: string]: unknown }>(rows: T[], entityType: "invoice" | "credit-memo", key: keyof T) {
  const ids = rows.map((r) => String(r[key]));
  if (ids.length === 0) return rows.map((r) => ({ ...r, sync: null as null | { status: string; externalId: string | null; lastError: string | null } }));
  const [refs, outbox] = await Promise.all([
    prisma.externalRef.findMany({ where: { system: "quickbooks", entityType, entityId: { in: ids } } }),
    prisma.syncOutbox.findMany({ where: { system: "quickbooks", entityType, entityId: { in: ids } }, orderBy: { createdAt: "desc" } }),
  ]);
  const refBy = new Map(refs.map((r) => [r.entityId, r]));
  const outBy = new Map<string, (typeof outbox)[number]>();
  for (const o of outbox) if (!outBy.has(o.entityId)) outBy.set(o.entityId, o);
  return rows.map((r) => {
    const id = String(r[key]);
    const ref = refBy.get(id);
    const out = outBy.get(id);
    const status = out?.status === "DONE" ? (ref ? "SYNCED" : "DONE") : out?.status ?? (ref ? "SYNCED" : "NOT_QUEUED");
    return { ...r, sync: { status, externalId: ref?.externalId ?? null, lastError: out?.lastError ?? null } };
  });
}

router.get("/", requirePermission("invoices", "view"), async (req, res) => {
  const q = req.query as Record<string, unknown>;
  const where: Prisma.InvoiceWhereInput = {};
  const status = str(q.status).toUpperCase();
  if (status === "ISSUED" || status === "VOID") where.status = status;
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
  const [total, rows] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({ where, orderBy: [{ invoiceDate: "desc" }, { invoiceNumber: "desc" }], skip, take: pageSize, include: { lines: true } }),
  ]);
  res.json({ rows: await withSync(rows, "invoice", "invoiceNumber"), total, page, pageSize });
});

router.get("/credit-memos", requirePermission("invoices", "view"), async (req, res) => {
  const q = req.query as Record<string, unknown>;
  const where: Prisma.CreditMemoWhereInput = {};
  const status = str(q.status).toUpperCase();
  if (status === "ISSUED" || status === "VOID") where.status = status;
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
  const [total, rows] = await Promise.all([
    prisma.creditMemo.count({ where }),
    prisma.creditMemo.findMany({ where, orderBy: [{ memoDate: "desc" }, { creditMemoNumber: "desc" }], skip, take: pageSize, include: { lines: true } }),
  ]);
  res.json({ rows: await withSync(rows, "credit-memo", "creditMemoNumber"), total, page, pageSize });
});

router.get("/credit-memos/:number", requirePermission("invoices", "view"), async (req, res) => {
  const memo = await prisma.creditMemo.findUnique({ where: { creditMemoNumber: req.params.number }, include: { lines: true } });
  if (!memo) throw new HttpError(404, "Credit memo not found");
  res.json((await withSync([memo], "credit-memo", "creditMemoNumber"))[0]);
});

const voidSchema = z.object({ reason: z.string().trim().min(1, "Give a reason").max(2000) });

router.post("/credit-memos/:number/void", requirePermission("invoices", "edit"), async (req: AuthedRequest, res) => {
  const parsed = voidSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const number = req.params.number;
  await prisma.$transaction(async (tx) => {
    const memo = await tx.creditMemo.findUnique({ where: { creditMemoNumber: number } });
    if (!memo) throw new HttpError(404, "Credit memo not found");
    if (memo.status === "VOID") throw new HttpError(409, `${number} is already void.`, { conflict: true });
    await tx.creditMemo.update({ where: { creditMemoNumber: number }, data: { status: "VOID", voidedAt: new Date(), voidedBy: req.account!.username, voidReason: parsed.data.reason } });
    await enqueueSync(tx, "credit-memo", number, "VOID");
  });
  logAudit(req.account!, "CREDIT_MEMO_VOIDED", "credit-memo", number, number, { reason: parsed.data.reason });
  const memo = await prisma.creditMemo.findUnique({ where: { creditMemoNumber: number }, include: { lines: true } });
  res.json((await withSync([memo!], "credit-memo", "creditMemoNumber"))[0]);
});

router.get("/:number", requirePermission("invoices", "view"), async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { invoiceNumber: req.params.number }, include: { lines: true } });
  if (!invoice) throw new HttpError(404, "Invoice not found");
  res.json((await withSync([invoice], "invoice", "invoiceNumber"))[0]);
});

// Voids an invoice that should not have been raised (wrong price, wrong
// customer). The shipment stands; correct the order and re-raise by
// undoing and re-confirming the shipment if the goods were right.
router.post("/:number/void", requirePermission("invoices", "edit"), async (req: AuthedRequest, res) => {
  const parsed = voidSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const number = req.params.number;
  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { invoiceNumber: number } });
    if (!invoice) throw new HttpError(404, "Invoice not found");
    if (invoice.status === "VOID") throw new HttpError(409, `${number} is already void.`, { conflict: true });
    await tx.invoice.update({ where: { invoiceNumber: number }, data: { status: "VOID", voidedAt: new Date(), voidedBy: req.account!.username, voidReason: parsed.data.reason } });
    await enqueueSync(tx, "invoice", number, "VOID");
  });
  logAudit(req.account!, "INVOICE_VOIDED", "invoice", number, number, { reason: parsed.data.reason });
  const invoice = await prisma.invoice.findUnique({ where: { invoiceNumber: number }, include: { lines: true } });
  res.json((await withSync([invoice!], "invoice", "invoiceNumber"))[0]);
});

export default router;
