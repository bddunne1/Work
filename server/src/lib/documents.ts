import { Prisma } from "@prisma/client";
import { enqueueSync } from "../integrations/sync.js";
import { HttpError } from "./conflictError.js";
import { addDays, fromCents, lineAmountCents, taxCents, termsDays, toCents } from "./money.js";

// Financial documents raised from operational events, inside the same
// transaction as the event itself: an invoice per shipment, a credit memo
// per received return. Since sprint 2 both start as a DRAFT with no number:
// Accounting reviews the draft (adds freight and other charges, corrects a
// rate), then issues it, which assigns the number and queues it for
// QuickBooks (see integrations/sync.ts). A draft is never pushed.

type Tx = Prisma.TransactionClient;
type Actor = { id: string; username: string };

export const INVOICE_COUNTER_KEY = "invoice";
export const INVOICE_START = 20001;
export const CREDIT_MEMO_COUNTER_KEY = "creditMemo";
export const CREDIT_MEMO_START = 30001;

// Charge lines added at review carry one of these codes as their item.
export const CHARGE_CODES = ["FREIGHT", "HANDLING", "OTHER", "DEDUCTION"] as const;
export type ChargeCode = (typeof CHARGE_CODES)[number];

async function nextNumber(tx: Tx, key: string, start: number, prefix: string): Promise<string> {
  const counter = await tx.counter.upsert({
    where: { key },
    create: { key, value: start },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${counter.value}`;
}

// Totals from the lines: the subtotal is every line; tax applies to the
// taxable lines only (a freight charge is often exempt). Integer cents, half
// up, as the order screens do.
export function documentTotals(lines: { amountCents: number; taxable: boolean }[], taxRatePercent: Prisma.Decimal | number) {
  const subtotalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const taxableCents = lines.reduce((s, l) => s + (l.taxable ? l.amountCents : 0), 0);
  const tax = taxCents(taxableCents, taxRatePercent);
  return { subtotalCents, taxCentsValue: tax, totalCents: subtotalCents + tax };
}

interface OrderForInvoice {
  soNumber: number;
  customerId: string | null;
  billTo: unknown;
  shipTo: unknown;
  poNumber: string;
  terms: string;
  rep: string;
  taxRate: Prisma.Decimal;
  lineItems: { id: string; itemId: string | null; item: string; description: string; um: string; rate: Prisma.Decimal }[];
}

interface ShipmentForInvoice {
  id: string;
  shippedAt: Date;
  lines: { lineItemId: string; qty: number }[];
}

// Raises the draft invoice for one shipment from the order's lines and
// prices as they stand now. Tax follows the order's rate unless the
// customer is flagged tax exempt.
export async function createInvoiceForShipment(tx: Tx, order: OrderForInvoice, shipment: ShipmentForInvoice, _actor: Actor) {
  const customer = order.customerId
    ? await tx.customer.findUnique({ where: { id: order.customerId }, select: { name: true, taxExempt: true } })
    : null;
  const byId = new Map(order.lineItems.map((li) => [li.id, li]));
  const lines = shipment.lines
    .filter((l) => l.qty > 0)
    .flatMap((l, position) => {
      const li = byId.get(l.lineItemId);
      if (!li) return [];
      return [
        {
          position,
          salesOrderLineId: li.id,
          itemId: li.itemId,
          item: li.item,
          description: li.description,
          um: li.um,
          qty: l.qty,
          rate: li.rate,
          amountCents: lineAmountCents(l.qty, li.rate),
          taxable: true,
        },
      ];
    });
  const taxRate = customer?.taxExempt ? 0 : order.taxRate;
  const totals = documentTotals(lines, taxRate);
  const invoiceDate = new Date(shipment.shippedAt.toISOString().slice(0, 10));
  const billToName = (order.billTo as { name?: string } | null)?.name;
  return tx.invoice.create({
    data: {
      status: "DRAFT",
      soNumber: order.soNumber,
      shipmentRecordId: shipment.id,
      customerId: order.customerId,
      customerName: billToName || customer?.name || "Customer",
      billTo: order.billTo as Prisma.InputJsonValue,
      shipTo: order.shipTo as Prisma.InputJsonValue,
      poNumber: order.poNumber,
      terms: order.terms,
      rep: order.rep,
      invoiceDate,
      dueDate: addDays(invoiceDate, termsDays(order.terms)),
      subtotal: fromCents(totals.subtotalCents),
      taxRate,
      tax: fromCents(totals.taxCentsValue),
      total: fromCents(totals.totalCents),
      lines: {
        create: lines.map((l) => ({
          position: l.position,
          kind: "ITEM",
          taxable: l.taxable,
          salesOrderLineId: l.salesOrderLineId,
          itemId: l.itemId,
          item: l.item,
          description: l.description,
          um: l.um,
          qty: l.qty,
          rate: l.rate,
          amount: fromCents(l.amountCents),
        })),
      },
    },
    include: { lines: true },
  });
}

// The shipment is being undone. A draft is simply removed (it never had a
// number and never left the building); an issued invoice is void, never
// deleted - its number was issued and may have been sent - and QuickBooks
// is told.
export async function voidInvoiceForShipment(tx: Tx, shipmentRecordId: string, actor: Actor, reason: string) {
  const invoice = await tx.invoice.findUnique({ where: { shipmentRecordId } });
  if (!invoice) return null;
  if (invoice.status === "DRAFT") {
    await tx.invoice.delete({ where: { id: invoice.id } });
    return { ...invoice, status: "DELETED" as const };
  }
  if (invoice.status === "VOID") return invoice;
  const voided = await tx.invoice.update({
    where: { id: invoice.id },
    data: { status: "VOID", voidedAt: new Date(), voidedBy: actor.username, voidReason: reason },
  });
  await enqueueSync(tx, "invoice", invoice.invoiceNumber!, "VOID");
  return voided;
}

// What a reviewer may change on a draft: a note, the rate on a shipped
// line, and charge lines (freight, handling, other; a deduction on a credit
// memo). Quantities and items on shipped or returned lines are the record
// of what moved and stay as they are.
export interface DraftLineInput {
  id?: string;
  kind: "ITEM" | "CHARGE";
  item: string;
  description: string;
  um?: string;
  qty: number;
  rate: number;
  taxable: boolean;
}

interface DraftLineRow {
  id: string;
  kind: "ITEM" | "CHARGE";
  salesOrderLineId?: string | null;
  returnLineId?: string | null;
  itemId: string | null;
  item: string;
  description: string;
  um: string;
  qty: number;
  rate: Prisma.Decimal;
  taxable: boolean;
}

// Merges the reviewer's lines over the draft's current lines and returns the
// rows to write, or throws when a shipped line is missing or changed in a
// way the review may not.
export function reviewedLines(current: DraftLineRow[], input: DraftLineInput[], allowNegative: boolean) {
  const byId = new Map(current.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const out = input.map((l, position) => {
    if (l.kind === "ITEM") {
      const was = l.id ? byId.get(l.id) : undefined;
      if (!was || was.kind !== "ITEM") throw new HttpError(400, "Shipped lines can only be repriced, not added. Reload the draft and try again.");
      if (seen.has(was.id)) throw new HttpError(400, `${was.item} appears twice.`);
      seen.add(was.id);
      if (l.qty !== was.qty || l.item.trim().toLowerCase() !== was.item.trim().toLowerCase()) {
        throw new HttpError(409, `${was.item}: the quantity and item come from the shipment and can't change here. Undo the shipment to correct them.`, { conflict: true });
      }
      if (l.rate < 0) throw new HttpError(400, `${was.item}: the rate can't be negative.`);
      const rate = new Prisma.Decimal(l.rate);
      return {
        id: was.id,
        position,
        kind: "ITEM" as const,
        salesOrderLineId: was.salesOrderLineId ?? null,
        returnLineId: was.returnLineId ?? null,
        itemId: was.itemId,
        item: was.item,
        description: l.description.trim() || was.description,
        um: was.um,
        qty: was.qty,
        rate,
        amountCents: lineAmountCents(was.qty, rate),
        taxable: l.taxable,
      };
    }
    const code = l.item.trim().toUpperCase();
    if (!(CHARGE_CODES as readonly string[]).includes(code)) throw new HttpError(400, `Charge type must be one of ${CHARGE_CODES.join(", ")}.`);
    if (!l.description.trim()) throw new HttpError(400, "Give each charge a description.");
    if (!Number.isFinite(l.rate)) throw new HttpError(400, "Give each charge an amount.");
    if (l.rate < 0 && !allowNegative) throw new HttpError(400, "A charge on an invoice can't be negative; use a credit memo for a credit.");
    if (l.rate > 0 && code === "DEDUCTION") throw new HttpError(400, "A deduction reduces the credit: enter it as a negative amount.");
    const qty = Number.isInteger(l.qty) && l.qty > 0 ? l.qty : 1;
    const rate = new Prisma.Decimal(l.rate);
    return {
      id: l.id && byId.get(l.id)?.kind === "CHARGE" ? l.id : undefined,
      position,
      kind: "CHARGE" as const,
      salesOrderLineId: null,
      returnLineId: null,
      itemId: null,
      item: code,
      description: l.description.trim(),
      um: "EA",
      qty,
      rate,
      amountCents: Math.round(toCents(Number(rate)) * qty),
      taxable: l.taxable,
    };
  });
  const missing = current.filter((l) => l.kind === "ITEM" && !seen.has(l.id));
  if (missing.length > 0) throw new HttpError(409, `${missing[0].item} is on the shipment and must stay on the invoice.`, { conflict: true });
  return out;
}

// Issues a reviewed draft: assigns the number, stamps who approved it,
// recomputes the totals from the lines as stored, and queues it.
export async function issueInvoice(tx: Tx, id: string, version: number, actor: Actor) {
  const invoice = await tx.invoice.findUnique({ where: { id }, include: { lines: true } });
  if (!invoice) throw new HttpError(404, "Invoice not found");
  if (invoice.status !== "DRAFT") throw new HttpError(409, `${invoice.invoiceNumber ?? "This invoice"} has already been issued.`, { conflict: true });
  if (invoice.version !== version) throw new HttpError(409, "This draft was changed by someone else since you loaded it. Reload and try again.", { conflict: true });
  const totals = documentTotals(invoice.lines.map((l) => ({ amountCents: toCents(Number(l.amount)), taxable: l.taxable })), invoice.taxRate);
  const issued = await tx.invoice.update({
    where: { id },
    data: {
      invoiceNumber: await nextNumber(tx, INVOICE_COUNTER_KEY, INVOICE_START, "INV"),
      status: "ISSUED",
      approvedAt: new Date(),
      approvedBy: actor.username,
      subtotal: fromCents(totals.subtotalCents),
      tax: fromCents(totals.taxCentsValue),
      total: fromCents(totals.totalCents),
      version: { increment: 1 },
    },
    include: { lines: true },
  });
  await enqueueSync(tx, "invoice", issued.invoiceNumber!, "UPSERT");
  return issued;
}

interface ReturnForCredit {
  raNumber: string;
  customerId: string | null;
  soNumber: string | null;
  billTo: unknown;
  reason: string;
  receivedAt: Date | null;
  lines: { id: string; itemId: string | null; itemNumber: string; description: string; um: string; qty: number; rate: Prisma.Decimal }[];
}

// Raises the draft credit memo when returned goods are received. Each line
// is priced from the invoice that billed that item on the referenced order
// when one can be found (the price actually charged - open bug M-15),
// otherwise from the RA line.
export async function createCreditMemoForReturn(tx: Tx, ra: ReturnForCredit, _actor: Actor) {
  const existing = await tx.creditMemo.findUnique({ where: { raNumber: ra.raNumber } });
  if (existing) return existing;
  const soNumber = parseInt(String(ra.soNumber ?? "").replace(/[^0-9]/g, ""), 10);
  const invoices = Number.isFinite(soNumber)
    ? await tx.invoice.findMany({ where: { soNumber, status: { in: ["DRAFT", "ISSUED"] } }, include: { lines: true }, orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }] })
    : [];
  const customer = ra.customerId ? await tx.customer.findUnique({ where: { id: ra.customerId }, select: { name: true } }) : null;
  const priceFor = (itemNumber: string) => {
    const key = itemNumber.trim().toLowerCase();
    for (const inv of invoices) {
      const line = inv.lines.find((l) => l.kind === "ITEM" && l.item.trim().toLowerCase() === key);
      if (line) return { rate: line.rate, invoiceNumber: inv.invoiceNumber, taxRate: inv.taxRate };
    }
    return null;
  };
  const lines = ra.lines.map((l, position) => {
    const billed = priceFor(l.itemNumber);
    const rate = billed?.rate ?? l.rate;
    return {
      position,
      returnLineId: l.id,
      invoiceNumber: billed?.invoiceNumber ?? null,
      itemId: l.itemId,
      item: l.itemNumber,
      description: l.description,
      um: l.um,
      qty: l.qty,
      rate,
      amountCents: lineAmountCents(l.qty, rate),
      taxable: true,
    };
  });
  const taxRate = ra.lines.map((l) => priceFor(l.itemNumber)?.taxRate).find((t) => t !== undefined) ?? 0;
  const totals = documentTotals(lines, taxRate);
  const memoDate = new Date((ra.receivedAt ?? new Date()).toISOString().slice(0, 10));
  return tx.creditMemo.create({
    data: {
      status: "DRAFT",
      raNumber: ra.raNumber,
      customerId: ra.customerId,
      customerName: (ra.billTo as { name?: string } | null)?.name || customer?.name || "Customer",
      billTo: ra.billTo as Prisma.InputJsonValue,
      soNumber: ra.soNumber,
      memoDate,
      subtotal: fromCents(totals.subtotalCents),
      taxRate,
      tax: fromCents(totals.taxCentsValue),
      total: fromCents(totals.totalCents),
      reason: ra.reason,
      lines: {
        create: lines.map((l) => ({
          position: l.position,
          kind: "ITEM",
          taxable: l.taxable,
          returnLineId: l.returnLineId,
          invoiceNumber: l.invoiceNumber,
          itemId: l.itemId,
          item: l.item,
          description: l.description,
          um: l.um,
          qty: l.qty,
          rate: l.rate,
          amount: fromCents(l.amountCents),
        })),
      },
    },
    include: { lines: true },
  });
}

export async function issueCreditMemo(tx: Tx, id: string, version: number, actor: Actor) {
  const memo = await tx.creditMemo.findUnique({ where: { id }, include: { lines: true } });
  if (!memo) throw new HttpError(404, "Credit memo not found");
  if (memo.status !== "DRAFT") throw new HttpError(409, `${memo.creditMemoNumber ?? "This credit memo"} has already been issued.`, { conflict: true });
  if (memo.version !== version) throw new HttpError(409, "This draft was changed by someone else since you loaded it. Reload and try again.", { conflict: true });
  const totals = documentTotals(memo.lines.map((l) => ({ amountCents: toCents(Number(l.amount)), taxable: l.taxable })), memo.taxRate);
  if (totals.totalCents < 0) throw new HttpError(400, "The deductions exceed the credit - the total can't be negative.");
  const issued = await tx.creditMemo.update({
    where: { id },
    data: {
      creditMemoNumber: await nextNumber(tx, CREDIT_MEMO_COUNTER_KEY, CREDIT_MEMO_START, "CM"),
      status: "ISSUED",
      approvedAt: new Date(),
      approvedBy: actor.username,
      subtotal: fromCents(totals.subtotalCents),
      tax: fromCents(totals.taxCentsValue),
      total: fromCents(totals.totalCents),
      version: { increment: 1 },
    },
    include: { lines: true },
  });
  await enqueueSync(tx, "credit-memo", issued.creditMemoNumber!, "UPSERT");
  return issued;
}
