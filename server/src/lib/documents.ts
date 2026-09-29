import type { Prisma } from "@prisma/client";
import { enqueueSync } from "../integrations/sync.js";
import { addDays, fromCents, lineAmountCents, taxCents, termsDays } from "./money.js";

// Financial documents raised from operational events, inside the same
// transaction as the event itself: an invoice per shipment, a credit memo
// per received return. They are what the accounting bridge pushes to
// QuickBooks (see integrations/sync.ts).

type Tx = Prisma.TransactionClient;
type Actor = { id: string; username: string };

export const INVOICE_COUNTER_KEY = "invoice";
export const INVOICE_START = 20001;
export const CREDIT_MEMO_COUNTER_KEY = "creditMemo";
export const CREDIT_MEMO_START = 30001;

async function nextNumber(tx: Tx, key: string, start: number, prefix: string): Promise<string> {
  const counter = await tx.counter.upsert({
    where: { key },
    create: { key, value: start },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${counter.value}`;
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

// Raises the invoice for one shipment from the order's lines and prices as
// they stand now. Tax follows the order's rate unless the customer is
// flagged tax exempt. The invoice is queued for QuickBooks in the same
// transaction.
export async function createInvoiceForShipment(tx: Tx, order: OrderForInvoice, shipment: ShipmentForInvoice, _actor: Actor) {
  const customer = order.customerId
    ? await tx.customer.findUnique({ where: { id: order.customerId }, select: { name: true, taxExempt: true } })
    : null;
  const byId = new Map(order.lineItems.map((li) => [li.id, li]));
  const lines = shipment.lines
    .filter((l) => l.qty > 0)
    .flatMap((l) => {
      const li = byId.get(l.lineItemId);
      if (!li) return [];
      return [
        {
          salesOrderLineId: li.id,
          itemId: li.itemId,
          item: li.item,
          description: li.description,
          um: li.um,
          qty: l.qty,
          rate: li.rate,
          amountCents: lineAmountCents(l.qty, li.rate),
        },
      ];
    });
  const subtotalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const taxRate = customer?.taxExempt ? 0 : order.taxRate;
  const tax = taxCents(subtotalCents, taxRate);
  const invoiceDate = new Date(shipment.shippedAt.toISOString().slice(0, 10));
  const billToName = (order.billTo as { name?: string } | null)?.name;
  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber: await nextNumber(tx, INVOICE_COUNTER_KEY, INVOICE_START, "INV"),
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
      subtotal: fromCents(subtotalCents),
      taxRate,
      tax: fromCents(tax),
      total: fromCents(subtotalCents + tax),
      lines: {
        create: lines.map((l) => ({
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
  await enqueueSync(tx, "invoice", invoice.invoiceNumber, "UPSERT");
  return invoice;
}

// The shipment is being undone: the invoice for it is void (never deleted -
// its number was issued and may have been sent), and QuickBooks is told.
export async function voidInvoiceForShipment(tx: Tx, shipmentRecordId: string, actor: Actor, reason: string) {
  const invoice = await tx.invoice.findUnique({ where: { shipmentRecordId } });
  if (!invoice || invoice.status === "VOID") return invoice;
  const voided = await tx.invoice.update({
    where: { invoiceNumber: invoice.invoiceNumber },
    data: { status: "VOID", voidedAt: new Date(), voidedBy: actor.username, voidReason: reason },
  });
  await enqueueSync(tx, "invoice", invoice.invoiceNumber, "VOID");
  return voided;
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

// Raises the credit memo when returned goods are received. Each line is
// priced from the invoice that billed that item on the referenced order
// when one can be found (the price actually charged - open bug M-15),
// otherwise from the RA line.
export async function createCreditMemoForReturn(tx: Tx, ra: ReturnForCredit, _actor: Actor) {
  const existing = await tx.creditMemo.findUnique({ where: { raNumber: ra.raNumber } });
  if (existing) return existing;
  const soNumber = parseInt(String(ra.soNumber ?? "").replace(/[^0-9]/g, ""), 10);
  const invoices = Number.isFinite(soNumber)
    ? await tx.invoice.findMany({ where: { soNumber, status: "ISSUED" }, include: { lines: true }, orderBy: { invoiceDate: "desc" } })
    : [];
  const customer = ra.customerId ? await tx.customer.findUnique({ where: { id: ra.customerId }, select: { name: true } }) : null;
  const priceFor = (itemNumber: string) => {
    const key = itemNumber.trim().toLowerCase();
    for (const inv of invoices) {
      const line = inv.lines.find((l) => l.item.trim().toLowerCase() === key);
      if (line) return { rate: line.rate, invoiceNumber: inv.invoiceNumber, taxRate: inv.taxRate };
    }
    return null;
  };
  const lines = ra.lines.map((l) => {
    const billed = priceFor(l.itemNumber);
    const rate = billed?.rate ?? l.rate;
    return {
      returnLineId: l.id,
      invoiceNumber: billed?.invoiceNumber ?? null,
      itemId: l.itemId,
      item: l.itemNumber,
      description: l.description,
      um: l.um,
      qty: l.qty,
      rate,
      amountCents: lineAmountCents(l.qty, rate),
    };
  });
  const taxRate = lines.map((l) => (l.invoiceNumber ? priceFor(l.item)?.taxRate : undefined)).find((t) => t !== undefined) ?? 0;
  const subtotalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const tax = taxCents(subtotalCents, taxRate);
  const memoDate = new Date((ra.receivedAt ?? new Date()).toISOString().slice(0, 10));
  const memo = await tx.creditMemo.create({
    data: {
      creditMemoNumber: await nextNumber(tx, CREDIT_MEMO_COUNTER_KEY, CREDIT_MEMO_START, "CM"),
      raNumber: ra.raNumber,
      customerId: ra.customerId,
      customerName: (ra.billTo as { name?: string } | null)?.name || customer?.name || "Customer",
      billTo: ra.billTo as Prisma.InputJsonValue,
      soNumber: ra.soNumber,
      memoDate,
      subtotal: fromCents(subtotalCents),
      taxRate,
      tax: fromCents(tax),
      total: fromCents(subtotalCents + tax),
      reason: ra.reason,
      lines: {
        create: lines.map((l) => ({
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
  await enqueueSync(tx, "credit-memo", memo.creditMemoNumber, "UPSERT");
  return memo;
}
