import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { requireAnyPermission, requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { canSeePrices } from "../lib/orderView.js";
import { prisma } from "../prisma.js";

// One row per shipment (R4-20): what Shipment History and the end-of-day
// shipped report read. The order list shows an order once, with its last
// ship date, so a partial shipment earlier in the day was invisible there.
//
//   GET /api/shipments?from=YYYY-MM-DD&to=YYYY-MM-DD&q=&page=1&pageSize=50
//   -> { rows, total, totals: { shipments, units, amount } }
//
// `from`/`to` are inclusive calendar days (UTC). `q` matches the S.O. #,
// the customer's P.O. # or the customer name on the invoice.

const router = Router();
router.use(requireAuth);

const VIEW_PAGES = ["shipment-history", "open-picks"];

interface ShipLine {
  lineItemId: string;
  qty: number;
}

function dateOnly(s: string | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

router.get("/", requireAnyPermission(VIEW_PAGES, "view"), async (req: AuthedRequest, res) => {
  const showPrices = canSeePrices(req.account!);
  const str = (k: string) => (typeof req.query[k] === "string" ? String(req.query[k]).trim() : "");
  const from = dateOnly(str("from"));
  const to = dateOnly(str("to"));
  const q = str("q");
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(req.query.pageSize) || 50), 500);

  const shippedAt: Prisma.DateTimeFilter = {};
  if (from) shippedAt.gte = from;
  if (to) shippedAt.lt = new Date(to.getTime() + 86_400_000);
  const where: Prisma.ShipmentRecordWhereInput = {};
  if (from || to) where.shippedAt = shippedAt;
  if (q) {
    const asNumber = parseInt(q.replace(/[^0-9]/g, ""), 10);
    where.OR = [
      ...(Number.isFinite(asNumber) && /^\s*(s\.?o\.?\s*#?\s*)?\d+\s*$/i.test(q) ? [{ soNumber: asNumber }] : []),
      { salesOrder: { poNumber: { contains: q, mode: "insensitive" } } },
      { invoice: { customerName: { contains: q, mode: "insensitive" } } },
    ];
  }

  const include = {
    salesOrder: { select: { poNumber: true, billTo: true, shipTo: true, status: true, version: true, lineItems: { select: { id: true, item: true, description: true, um: true } } } },
    invoice: { select: { id: true, invoiceNumber: true, total: true, status: true } },
  } satisfies Prisma.ShipmentRecordInclude;

  const [records, total] = await Promise.all([
    prisma.shipmentRecord.findMany({ where, include, orderBy: [{ shippedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.shipmentRecord.count({ where }),
  ]);

  // Undo only ever applies to an order's most recent shipment.
  const soNumbers = [...new Set(records.map((r) => r.soNumber))];
  const latest = soNumbers.length
    ? await prisma.shipmentRecord.findMany({ where: { soNumber: { in: soNumbers } }, orderBy: [{ shippedAt: "desc" }, { id: "desc" }], select: { id: true, soNumber: true }, distinct: ["soNumber"] })
    : [];
  const latestId = new Map(latest.map((l) => [l.soNumber, l.id]));

  const rows = records.map((r) => {
    const byLine = new Map(r.salesOrder.lineItems.map((li) => [li.id, li]));
    const lines = ((r.lines as ShipLine[] | null) ?? [])
      .filter((l) => l.qty > 0)
      .map((l) => {
        const li = byLine.get(l.lineItemId);
        return { lineItemId: l.lineItemId, item: li?.item ?? "?", description: li?.description ?? "", um: li?.um ?? "EA", qty: l.qty };
      });
    return {
      id: r.id,
      soNumber: r.soNumber,
      shippedAt: r.shippedAt,
      poNumber: r.salesOrder.poNumber,
      customer: (r.salesOrder.billTo as { name?: string })?.name ?? "",
      shipTo: r.salesOrder.shipTo,
      orderStatus: r.salesOrder.status,
      orderVersion: r.salesOrder.version,
      lines,
      units: lines.reduce((sum, l) => sum + l.qty, 0),
      invoiceId: r.invoice?.id ?? null,
      invoiceNumber: r.invoice?.invoiceNumber ?? null,
      invoiceTotal: r.invoice && showPrices ? r.invoice.total.toString() : null,
      invoiceStatus: r.invoice?.status ?? null,
      isLatest: latestId.get(r.soNumber) === r.id,
    };
  });

  // Totals over the whole filter, not just this page - the end-of-day
  // report is the reason this endpoint exists. Capped so a year-wide range
  // stays a bounded query.
  const all = await prisma.shipmentRecord.findMany({ where, select: { lines: true, invoice: { select: { total: true, status: true } } }, orderBy: { shippedAt: "desc" }, take: 5000 });
  const totals = {
    shipments: total,
    units: all.reduce((sum, r) => sum + ((r.lines as ShipLine[] | null) ?? []).reduce((s, l) => s + (l.qty > 0 ? l.qty : 0), 0), 0),
    amount: showPrices ? all.reduce((sum, r) => sum + (r.invoice && r.invoice.status !== "VOID" ? Number(r.invoice.total) : 0), 0).toFixed(2) : null,
    complete: all.length === total,
  };

  res.json({ rows, total, page, pageSize, totals });
});

export default router;
