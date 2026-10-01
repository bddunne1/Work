import { Prisma } from "@prisma/client";
import { Router } from "express";
import { requireAnyPermission, requireAuth } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

// Server-side aggregates for the Analytics page (src/pages/Analytics.tsx),
// which used to download every order, customer and item and total them in
// the browser. The math is the same as that client code:
//   order total = sum(ordered * rate) * (1 + taxRate / 100)
//   top customers = existing customers with revenue > 0, top 8
//   monthly series = the `months` calendar months ending at `endMonth`
//
//   GET /api/analytics/summary?endMonth=YYYY-MM&thisMonth=YYYY-MM&months=12
//   GET /api/analytics/customer/:customerId?endMonth=YYYY-MM&months=12
//   GET /api/analytics/capacity?days=30&tzOffset=300
//
// Revenue is what was invoiced (issued invoices less issued credit memos, by
// document date), not what was ordered (D-13 / E-03).
//
// `endMonth` / `thisMonth` let the browser pass the months it would have
// used itself (its local month for the chart window, and the UTC month the
// "Orders This Month" card has always used); both default to the server's
// current UTC month.
const router = Router();

const STATUS_OUT: Record<string, string> = {
  ENTERED: "Entered",
  CHECKED: "Checked",
  ALLOCATED: "Allocated",
  BACKORDERED: "Backordered",
  PICK_PACKED: "Pick & Packed",
  SHIPPED: "Shipped",
  CANCELLED: "Cancelled",
};

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentUtcMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function monthParam(v: unknown): string {
  return typeof v === "string" && MONTH_KEY.test(v) ? v : currentUtcMonth();
}

function monthsParam(v: unknown): number {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 60) : 12;
}

// ["2025-10", ..., "2026-09"] for endMonth 2026-09, n 12.
function monthWindow(endMonth: string, n: number): string[] {
  const [y, m] = endMonth.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

// Per-order totals, same formula as orderTotal() in src/types.ts.
// Cancelled orders were never sold, so they're always excluded; callers add
// their own conditions. Used for counts; revenue comes from the documents.
function orderTotalsCte(conds: Prisma.Sql[] = []): Prisma.Sql {
  const where = Prisma.sql`WHERE ${Prisma.join([Prisma.sql`so."status" <> 'CANCELLED'`, ...conds], " AND ")}`;
  return Prisma.sql`
    WITH ot AS (
      SELECT so."soNumber", so."customerId", so."status"::text AS "status", so."orderDate",
             COALESCE(SUM(l."ordered" * l."rate"), 0) * (1 + COALESCE(so."taxRate", 0) / 100) AS "total"
      FROM "SalesOrder" so
      LEFT JOIN "SalesOrderLine" l ON l."soNumber" = so."soNumber"
      ${where}
      GROUP BY so."soNumber"
    )`;
}

// Issued invoices less issued credit memos, by document date (D-13 / E-03).
function revenueCte(): Prisma.Sql {
  return Prisma.sql`
    WITH rev AS (
      SELECT "customerId", "invoiceDate" AS "docDate", "total" AS "amount" FROM "Invoice" WHERE "status" = 'ISSUED'
      UNION ALL
      SELECT "customerId", "memoDate" AS "docDate", -"total" AS "amount" FROM "CreditMemo" WHERE "status" = 'ISSUED'
    )`;
}

async function monthlyRevenueSeries(window: string[], customerId?: string) {
  const start = `${window[0]}-01`;
  const forCustomer = customerId ? Prisma.sql`AND "customerId" = ${customerId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ month: string; revenue: number }[]>`
    WITH rev AS (
      SELECT "invoiceDate" AS "docDate", "total" AS "amount" FROM "Invoice"
        WHERE "status" = 'ISSUED' AND "invoiceDate" >= ${start}::date ${forCustomer}
      UNION ALL
      SELECT "memoDate", -"total" FROM "CreditMemo"
        WHERE "status" = 'ISSUED' AND "memoDate" >= ${start}::date ${forCustomer}
    )
    SELECT to_char("docDate", 'YYYY-MM') AS "month", SUM("amount")::float8 AS "revenue" FROM rev GROUP BY 1`;
  const byMonth = new Map(rows.map((r) => [r.month, r.revenue]));
  return window.map((month) => ({ month, revenue: byMonth.get(month) ?? 0 }));
}

// Little's Law over the warehouse (D-02): weight staged on the floor now,
// how fast weight has shipped over the window and how long picks dwelt,
// hence how much can comfortably sit in the pipeline. The same math the
// browser used to do over every open order and the window's shipments.
const CAPACITY_PAGES = ["warehouse-capacity", "pick-pack", "pick-release", "open-picks", "analytics"];
const MAX_CAPACITY_DAYS = 90;

async function computeCapacity(days: number, tzOffsetMin: number) {
  const now = Date.now();
  const windowStart = new Date(now - days * 86_400_000);
  const localDay = (d: Date) => new Date(d.getTime() - tzOffsetMin * 60_000).toISOString().slice(0, 10);
  const lineSelect = { select: { id: true, catalogItem: { select: { weight: true } } } };
  const [staged, shipments, itemsMissingWeight] = await Promise.all([
    prisma.salesOrder.findMany({
      where: { status: "PICK_PACKED" },
      select: { soNumber: true, poNumber: true, billTo: true, pickedAt: true, pendingShipment: true, lineItems: lineSelect },
    }),
    prisma.shipmentRecord.findMany({
      where: { shippedAt: { gte: windowStart } },
      select: { shippedAt: true, lines: true, salesOrder: { select: { pickedAt: true, lineItems: lineSelect } } },
    }),
    prisma.item.count({ where: { OR: [{ weight: null }, { weight: 0 }] } }),
  ]);
  const weightsOf = (lines: { id: string; catalogItem: { weight: unknown } | null }[]) =>
    new Map(lines.map((l) => [l.id, l.catalogItem?.weight == null ? 0 : Number(l.catalogItem.weight)]));
  const sumWeight = (lines: { lineItemId: string; qty: number }[], w: Map<string, number>) => lines.reduce((s, l) => s + l.qty * (w.get(l.lineItemId) ?? 0), 0);

  const inWarehouse = staged
    .map((o) => ({ o, lines: ((o.pendingShipment as { lineItemId: string; qty: number }[] | null) ?? []).filter((l) => l.qty > 0) }))
    .filter((x) => x.lines.length > 0);
  const agingPicks = inWarehouse
    .filter((x) => x.o.pickedAt)
    .map((x) => ({
      soNumber: String(x.o.soNumber),
      poNumber: x.o.poNumber,
      customer: (x.o.billTo as { name?: string }).name ?? "",
      pickedAt: x.o.pickedAt!.toISOString(),
      daysInWarehouse: (now - x.o.pickedAt!.getTime()) / 86_400_000,
      weight: sumWeight(x.lines, weightsOf(x.o.lineItems)),
    }))
    .sort((a, b) => b.daysInWarehouse - a.daysInWarehouse);
  const currentLoadWeight = inWarehouse.reduce((s, x) => s + sumWeight(x.lines, weightsOf(x.o.lineItems)), 0);

  const throughputByDate = new Map<string, number>();
  const dwellSamples: number[] = [];
  for (const rec of shipments) {
    const w = sumWeight(rec.lines as { lineItemId: string; qty: number }[], weightsOf(rec.salesOrder.lineItems));
    const key = localDay(rec.shippedAt);
    throughputByDate.set(key, (throughputByDate.get(key) ?? 0) + w);
    const picked = rec.salesOrder.pickedAt;
    if (picked && picked < rec.shippedAt) dwellSamples.push((rec.shippedAt.getTime() - picked.getTime()) / 86_400_000);
  }
  const dailyThroughput: { date: string; weight: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = localDay(new Date(now - i * 86_400_000));
    dailyThroughput.push({ date: key, weight: throughputByDate.get(key) ?? 0 });
  }
  const totalThroughput = dailyThroughput.reduce((s, p) => s + p.weight, 0);
  const avgDailyThroughputWeight = days > 0 ? totalThroughput / days : null;
  const avgDwellDays = dwellSamples.length > 0 ? dwellSamples.reduce((s, d) => s + d, 0) / dwellSamples.length : null;
  const estimatedCapacityWeight =
    avgDailyThroughputWeight !== null && avgDwellDays !== null && avgDailyThroughputWeight > 0 && avgDwellDays > 0
      ? avgDailyThroughputWeight * avgDwellDays
      : null;
  // Only meaningful with some history behind it: a day or two of shipments
  // on a new system once read "22,469,342% of capacity".
  const shippingDays = dailyThroughput.filter((p) => p.weight > 0).length;
  const enoughHistory = shippingDays >= 5 && dwellSamples.length >= 20;
  const utilizationPct =
    enoughHistory && estimatedCapacityWeight && estimatedCapacityWeight > 0 ? Math.min(999, (currentLoadWeight / estimatedCapacityWeight) * 100) : null;
  return {
    lookbackDays: days,
    currentLoadWeight,
    currentLoadOrders: inWarehouse.length,
    avgDwellDays,
    avgDailyThroughputWeight,
    estimatedCapacityWeight,
    utilizationPct,
    dailyThroughput,
    agingPicks,
    itemsMissingWeight,
  };
}

// A small bounded cache that answers from the last computed value while a
// fresh one is computed in the background (D-13): the figures are for
// trend-watching, so a minute of staleness beats fifteen people each
// waiting on the same six-second aggregate.
class StaleWhileRefresh<T> {
  private entries = new Map<string, { at: number; value: Promise<T> }>();
  constructor(
    private ttlMs: number,
    private maxEntries: number
  ) {}
  get(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at <= this.ttlMs) return hit.value;
    const fresh = compute();
    if (hit) {
      // Stale: hand back what we have; the fresh answer takes over when it lands.
      fresh.then(() => this.entries.set(key, { at: Date.now(), value: fresh })).catch(() => {});
      return hit.value;
    }
    this.entries.set(key, { at: Date.now(), value: fresh });
    fresh.catch(() => {
      if (this.entries.get(key)?.value === fresh) this.entries.delete(key);
    });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    return fresh;
  }
}


router.use(requireAuth);

// Capacity is the warehouse's figure: gated by its own pages, ahead of the
// Analytics-only gate below.
const capacityCache = new StaleWhileRefresh<Awaited<ReturnType<typeof computeCapacity>>>(30_000, 16);
router.get("/capacity", requireAnyPermission(CAPACITY_PAGES, "view"), async (req, res) => {
  const daysRaw = parseInt(String(req.query.days ?? ""), 10);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, MAX_CAPACITY_DAYS) : 30;
  const tzRaw = parseInt(String(req.query.tzOffset ?? ""), 10);
  const tzOffset = Number.isFinite(tzRaw) && Math.abs(tzRaw) <= 14 * 60 ? tzRaw : 0;
  res.json(await capacityCache.get(`${days}|${tzOffset}`, () => computeCapacity(days, tzOffset)));
});

router.use(requireAnyPermission(["analytics", "reports"], "view"));

// The summary aggregates every order line and document ever entered, so 15
// people opening Analytics at once used to run it 15 times in parallel.
// Identical requests share one computation, and after a minute the last
// answer is served while a fresh one is computed (D-13).
const summaryCache = new StaleWhileRefresh<Awaited<ReturnType<typeof computeSummary>>>(60_000, 32);

router.get("/summary", async (req, res) => {
  const endMonth = monthParam(req.query.endMonth);
  const thisMonth = monthParam(req.query.thisMonth);
  const months = monthsParam(req.query.months);
  res.json(await summaryCache.get(`${endMonth}|${thisMonth}|${months}`, () => computeSummary(thisMonth, monthWindow(endMonth, months))));
});

async function computeSummary(thisMonth: string, window: string[]) {
  const [salesRows, statusRows, topCustomers, monthlyRevenue, inventoryRows, topInventoryValue, outOfStockItems] =
    await Promise.all([
      prisma.$queryRaw<{ totalOrders: number; totalRevenue: number; openOrders: number; ordersThisMonth: number }[]>`
        ${orderTotalsCte()}
        SELECT COUNT(*)::int AS "totalOrders",
               (SELECT COALESCE(SUM("amount"), 0)::float8 FROM (
                  SELECT "total" AS "amount" FROM "Invoice" WHERE "status" = 'ISSUED'
                  UNION ALL SELECT -"total" FROM "CreditMemo" WHERE "status" = 'ISSUED') rev) AS "totalRevenue",
               (COUNT(*) FILTER (WHERE "status" NOT IN ('SHIPPED', 'CANCELLED')))::int AS "openOrders",
               (COUNT(*) FILTER (WHERE to_char("orderDate", 'YYYY-MM') = ${thisMonth}))::int AS "ordersThisMonth"
        FROM ot`,
      prisma.$queryRaw<{ status: string; count: number }[]>`
        SELECT "status"::text AS "status", COUNT(*)::int AS "count" FROM "SalesOrder" GROUP BY 1`,
      // Ties keep the page's old order: customers were listed by name.
      prisma.$queryRaw<{ customerId: string; name: string; revenue: number }[]>`
        ${revenueCte()}
        SELECT c."id" AS "customerId", c."name", SUM(rev."amount")::float8 AS "revenue"
        FROM rev JOIN "Customer" c ON c."id" = rev."customerId"
        GROUP BY c."id", c."name"
        HAVING SUM(rev."amount") > 0
        ORDER BY SUM(rev."amount") DESC, c."name" ASC
        LIMIT 8`,
      monthlyRevenueSeries(window),
      prisma.$queryRaw<
        { totalItems: number; totalOnHand: number; totalOnPO: number; outOfStock: number; totalValue: number }[]
      >`
        SELECT COUNT(*)::int AS "totalItems",
               COALESCE(SUM("qtyOnHand"), 0)::float8 AS "totalOnHand",
               COALESCE(SUM("qtyOnPurchaseOrder"), 0)::float8 AS "totalOnPO",
               (COUNT(*) FILTER (WHERE "qtyOnHand" <= 0))::int AS "outOfStock",
               COALESCE(SUM("qtyOnHand" * "rate"), 0)::float8 AS "totalValue"
        FROM "Item"`,
      // Ties keep the page's old order: items were listed by item #.
      prisma.$queryRaw<{ itemNumber: string; description: string; value: number }[]>`
        SELECT "itemNumber", "description", ("qtyOnHand" * "rate")::float8 AS "value"
        FROM "Item"
        WHERE "qtyOnHand" * "rate" > 0
        ORDER BY "qtyOnHand" * "rate" DESC, "itemNumber" ASC
        LIMIT 10`,
      prisma.item.findMany({
        where: { qtyOnHand: { lte: 0 } },
        orderBy: { itemNumber: "asc" },
        take: 10,
        select: { id: true, itemNumber: true, description: true, qtyOnPurchaseOrder: true },
      }),
    ]);

  const ordersByStatus: Record<string, number> = {};
  for (const r of statusRows) ordersByStatus[STATUS_OUT[r.status] ?? r.status] = r.count;

  return {
    sales: salesRows[0],
    ordersByStatus,
    monthlyRevenue,
    topCustomers,
    inventory: inventoryRows[0],
    topInventoryValue,
    outOfStockItems,
  };
}


router.get("/customer/:customerId", async (req, res) => {
  const customerId = req.params.customerId;
  const window = monthWindow(monthParam(req.query.endMonth), monthsParam(req.query.months));
  const [statsRows, itemsPurchased, monthly] = await Promise.all([
    prisma.$queryRaw<{ totalOrders: number; lifetimeRevenue: number; lastOrderDate: string | null }[]>`
      ${orderTotalsCte([Prisma.sql`so."customerId" = ${customerId}`])}
      SELECT COUNT(*)::int AS "totalOrders",
             (SELECT COALESCE(SUM("amount"), 0)::float8 FROM (
                SELECT "total" AS "amount" FROM "Invoice" WHERE "status" = 'ISSUED' AND "customerId" = ${customerId}
                UNION ALL SELECT -"total" FROM "CreditMemo" WHERE "status" = 'ISSUED' AND "customerId" = ${customerId}) rev) AS "lifetimeRevenue",
             to_char(MAX("orderDate"), 'YYYY-MM-DD') AS "lastOrderDate"
      FROM ot`,
    prisma.$queryRaw<{ item: string; qty: number; revenue: number }[]>`
      SELECT l."item", SUM(l."ordered")::float8 AS "qty", SUM(l."ordered" * l."rate")::float8 AS "revenue"
      FROM "SalesOrderLine" l
      JOIN "SalesOrder" so ON so."soNumber" = l."soNumber"
      WHERE so."customerId" = ${customerId}
      GROUP BY l."item"
      ORDER BY SUM(l."ordered" * l."rate") DESC, l."item" ASC
      LIMIT 10`,
    monthlyRevenueSeries(window, customerId),
  ]);
  const stats = statsRows[0];
  res.json({
    totalOrders: stats.totalOrders,
    lifetimeRevenue: stats.lifetimeRevenue,
    avgOrderValue: stats.totalOrders ? stats.lifetimeRevenue / stats.totalOrders : 0,
    lastOrderDate: stats.lastOrderDate,
    itemsPurchased,
    monthlyRevenue: monthly,
  });
});

export default router;
