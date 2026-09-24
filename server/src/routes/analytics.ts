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
function orderTotalsCte(where: Prisma.Sql = Prisma.empty): Prisma.Sql {
  return Prisma.sql`
    WITH ot AS (
      SELECT so."soNumber", so."customerId", so."status"::text AS "status", so."orderDate",
             COALESCE(SUM(l."ordered" * l."rate"), 0) * (1 + COALESCE(so."taxRate", 0) / 100) AS "total"
      -- Cancelled orders were never sold: keep them out of bookings.
      FROM (SELECT * FROM "SalesOrder" WHERE "status" <> 'CANCELLED') so
      LEFT JOIN "SalesOrderLine" l ON l."soNumber" = so."soNumber"
      ${where}
      GROUP BY so."soNumber"
    )`;
}

async function monthlySeries(window: string[], customerId?: string) {
  const start = `${window[0]}-01`;
  const conds = [Prisma.sql`so."orderDate" >= ${start}::date`];
  if (customerId) conds.push(Prisma.sql`so."customerId" = ${customerId}`);
  const rows = await prisma.$queryRaw<{ month: string; revenue: number }[]>`
    ${orderTotalsCte(Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`)}
    SELECT to_char("orderDate", 'YYYY-MM') AS "month", SUM("total")::float8 AS "revenue"
    FROM ot GROUP BY 1`;
  const byMonth = new Map(rows.map((r) => [r.month, r.revenue]));
  return window.map((month) => ({ month, revenue: byMonth.get(month) ?? 0 }));
}

router.use(requireAuth);
router.use(requireAnyPermission(["analytics", "reports"], "view"));

router.get("/summary", async (req, res) => {
  const endMonth = monthParam(req.query.endMonth);
  const thisMonth = monthParam(req.query.thisMonth);
  const window = monthWindow(endMonth, monthsParam(req.query.months));

  const [salesRows, statusRows, topCustomers, monthlyRevenue, inventoryRows, topInventoryValue, outOfStockItems] =
    await Promise.all([
      prisma.$queryRaw<{ totalOrders: number; totalRevenue: number; openOrders: number; ordersThisMonth: number }[]>`
        ${orderTotalsCte()}
        SELECT COUNT(*)::int AS "totalOrders",
               COALESCE(SUM("total"), 0)::float8 AS "totalRevenue",
               (COUNT(*) FILTER (WHERE "status" NOT IN ('SHIPPED', 'CANCELLED')))::int AS "openOrders",
               (COUNT(*) FILTER (WHERE to_char("orderDate", 'YYYY-MM') = ${thisMonth}))::int AS "ordersThisMonth"
        FROM ot`,
      prisma.$queryRaw<{ status: string; count: number }[]>`
        SELECT "status"::text AS "status", COUNT(*)::int AS "count" FROM "SalesOrder" GROUP BY 1`,
      // Ties keep the page's old order: customers were listed by name.
      prisma.$queryRaw<{ customerId: string; name: string; revenue: number }[]>`
        ${orderTotalsCte(Prisma.sql`WHERE so."customerId" IS NOT NULL`)}
        SELECT c."id" AS "customerId", c."name", SUM(ot."total")::float8 AS "revenue"
        FROM ot JOIN "Customer" c ON c."id" = ot."customerId"
        GROUP BY c."id", c."name"
        HAVING SUM(ot."total") > 0
        ORDER BY SUM(ot."total") DESC, c."name" ASC
        LIMIT 8`,
      monthlySeries(window),
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

  res.json({
    sales: salesRows[0],
    ordersByStatus,
    monthlyRevenue,
    topCustomers,
    inventory: inventoryRows[0],
    topInventoryValue,
    outOfStockItems,
  });
});

router.get("/customer/:customerId", async (req, res) => {
  const customerId = req.params.customerId;
  const window = monthWindow(monthParam(req.query.endMonth), monthsParam(req.query.months));
  const [statsRows, itemsPurchased, monthly] = await Promise.all([
    prisma.$queryRaw<{ totalOrders: number; lifetimeRevenue: number; lastOrderDate: string | null }[]>`
      ${orderTotalsCte(Prisma.sql`WHERE so."customerId" = ${customerId}`)}
      SELECT COUNT(*)::int AS "totalOrders",
             COALESCE(SUM("total"), 0)::float8 AS "lifetimeRevenue",
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
    monthlySeries(window, customerId),
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
