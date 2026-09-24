import { Prisma } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

// Paged, server-filtered sales order search - for history pages (Closed
// Orders, Shipment History, reports, item profile) that used to download
// every order ever entered via GET /api/sales-orders and filter in the
// browser. Mounted at /api/sales-orders/search, ahead of the main
// sales-orders router so "/search" isn't taken for an S.O. #.
//
//   GET /api/sales-orders/search?status=Shipped,Cancelled&q=&customerId=&item=
//       &poNumber=&orderFrom=YYYY-MM-DD&orderTo=&shippedFrom=&shippedTo=
//       &page=1&pageSize=50&sort=soNumber|orderDate|shippedAt&dir=asc|desc
//   -> { rows, total, page, pageSize }
//
// `rows` have exactly the shape GET /api/sales-orders returns (same include
// and mapOut as salesOrders.ts - duplicated here rather than shared so the
// two files can change independently).
const router = Router();

// App-facing status names -> Prisma enum labels. Unknown names are ignored.
// CANCELLED is listed ahead of the enum value existing in every database;
// statuses the database's enum doesn't know yet are dropped at query time
// (see knownStatuses) rather than failing the cast.
const STATUS_IN: Record<string, string> = {
  Entered: "ENTERED",
  Checked: "CHECKED",
  Allocated: "ALLOCATED",
  Backordered: "BACKORDERED",
  "Pick & Packed": "PICK_PACKED",
  Shipped: "SHIPPED",
  Cancelled: "CANCELLED",
};
const STATUS_OUT: Record<string, string> = {
  ENTERED: "Entered",
  CHECKED: "Checked",
  ALLOCATED: "Allocated",
  BACKORDERED: "Backordered",
  PICK_PACKED: "Pick & Packed",
  SHIPPED: "Shipped",
  CANCELLED: "Cancelled",
};
const PICK_PACK_STATUS_OUT: Record<string, string> = { PARTIAL: "Partial", COMPLETE: "Complete" };

const include = {
  lineItems: true,
  shipmentHistory: { orderBy: { shippedAt: "asc" as const } },
};

function mapOut<T extends { soNumber: number; status: string; pickPackStatus: string | null }>(order: T) {
  return {
    ...order,
    soNumber: String(order.soNumber),
    status: STATUS_OUT[order.status] ?? order.status,
    pickPackStatus: order.pickPackStatus ? (PICK_PACK_STATUS_OUT[order.pickPackStatus] ?? order.pickPackStatus) : null,
  };
}

const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 50;
const MAX_SO_NUMBER = 2_147_483_647;

// The OrderStatus enum labels this database actually has, loaded once per
// process - lets `status=Cancelled` be requested before (or after) the
// migration adding it lands without a cast error.
let enumLabels: Promise<Set<string>> | null = null;
function knownStatuses(): Promise<Set<string>> {
  if (!enumLabels) {
    enumLabels = prisma.$queryRaw<{ label: string }[]>`SELECT unnest(enum_range(NULL::"OrderStatus"))::text AS label`
      .then((rows) => new Set(rows.map((r) => r.label)))
      .catch((err) => {
        enumLabels = null;
        throw err;
      });
  }
  return enumLabels;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function likePattern(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// A date bound: plain YYYY-MM-DD covers that whole (UTC) day; a full ISO
// timestamp is used as-is, which lets a browser send its own local-day
// boundaries. Returns null for anything unparseable (the filter is skipped).
function parseBound(raw: string, end: boolean): Date | null {
  if (!raw) return null;
  if (DATE_ONLY.test(raw)) {
    const d = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return null;
    return end ? new Date(d.getTime() + 86_400_000 - 1) : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateOnly(raw: string): string | null {
  return DATE_ONLY.test(raw) && !Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime()) ? raw : null;
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  const query = req.query;
  const conditions: Prisma.Sql[] = [];

  const statusNames = str(query.status)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (statusNames.length > 0) {
    const known = await knownStatuses();
    const labels = [...new Set(statusNames.map((s) => STATUS_IN[s]).filter((l): l is string => !!l && known.has(l)))];
    if (labels.length === 0) {
      // Only unknown / not-yet-migrated statuses asked for - nothing can match.
      conditions.push(Prisma.sql`FALSE`);
    } else {
      conditions.push(Prisma.sql`so."status" IN (${Prisma.join(labels.map((l) => Prisma.sql`${l}::"OrderStatus"`))})`);
    }
  }

  const q = str(query.q);
  if (q) {
    const pattern = likePattern(q);
    const ors: Prisma.Sql[] = [
      Prisma.sql`so."poNumber" ILIKE ${pattern}`,
      Prisma.sql`so."billTo"->>'name' ILIKE ${pattern}`,
      Prisma.sql`so."shipTo"->>'name' ILIKE ${pattern}`,
    ];
    if (/^\d+$/.test(q)) {
      const n = Number(q);
      if (n <= MAX_SO_NUMBER) ors.unshift(Prisma.sql`so."soNumber" = ${n}`);
    }
    conditions.push(Prisma.sql`(${Prisma.join(ors, " OR ")})`);
  }

  const customerId = str(query.customerId);
  if (customerId) conditions.push(Prisma.sql`so."customerId" = ${customerId}`);

  const poNumber = str(query.poNumber);
  if (poNumber) conditions.push(Prisma.sql`so."poNumber" ILIKE ${likePattern(poNumber)}`);

  const item = str(query.item);
  if (item) {
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "SalesOrderLine" l WHERE l."soNumber" = so."soNumber" AND lower(btrim(l."item")) = ${item.toLowerCase()})`,
    );
  }

  const orderFrom = parseDateOnly(str(query.orderFrom));
  if (orderFrom) conditions.push(Prisma.sql`so."orderDate" >= ${orderFrom}::date`);
  const orderTo = parseDateOnly(str(query.orderTo));
  if (orderTo) conditions.push(Prisma.sql`so."orderDate" <= ${orderTo}::date`);

  const shippedFrom = parseBound(str(query.shippedFrom), false);
  const shippedTo = parseBound(str(query.shippedTo), true);
  if (shippedFrom || shippedTo) {
    const sr: Prisma.Sql[] = [Prisma.sql`sr."soNumber" = so."soNumber"`];
    // shippedAt is a UTC timestamp without time zone (Prisma's convention),
    // so compare against the bound's UTC wall-clock text, not a Date param
    // whose conversion would depend on the session time zone.
    if (shippedFrom) sr.push(Prisma.sql`sr."shippedAt" >= ${shippedFrom.toISOString()}::timestamp`);
    if (shippedTo) sr.push(Prisma.sql`sr."shippedAt" <= ${shippedTo.toISOString()}::timestamp`);
    conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "ShipmentRecord" sr WHERE ${Prisma.join(sr, " AND ")})`);
  }

  const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

  const pageRaw = parseInt(str(query.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const sizeRaw = parseInt(str(query.pageSize), 10);
  const pageSize = Number.isFinite(sizeRaw) && sizeRaw > 0 ? Math.min(sizeRaw, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  const dir = str(query.dir).toLowerCase() === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const sort = str(query.sort);
  let join = Prisma.empty;
  let orderBy: Prisma.Sql;
  if (sort === "shippedAt") {
    // Latest shipment per order; never-shipped orders sort last either way.
    join = Prisma.sql`LEFT JOIN (SELECT "soNumber", max("shippedAt") AS "lastShippedAt" FROM "ShipmentRecord" GROUP BY "soNumber") ls ON ls."soNumber" = so."soNumber"`;
    orderBy = Prisma.sql`ls."lastShippedAt" ${dir} NULLS LAST, so."soNumber" ${dir}`;
  } else if (sort === "orderDate") {
    orderBy = Prisma.sql`so."orderDate" ${dir}, so."soNumber" ${dir}`;
  } else {
    orderBy = Prisma.sql`so."soNumber" ${dir}`;
  }

  const [countRows, idRows] = await Promise.all([
    prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM "SalesOrder" so ${where}`,
    prisma.$queryRaw<
      { soNumber: number }[]
    >`SELECT so."soNumber" FROM "SalesOrder" so ${join} ${where} ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
  ]);
  const total = countRows[0]?.total ?? 0;
  const ids = idRows.map((r) => r.soNumber);

  const orders = ids.length > 0 ? await prisma.salesOrder.findMany({ where: { soNumber: { in: ids } }, include }) : [];
  const bySo = new Map(orders.map((o) => [o.soNumber, o]));
  const rows = ids.flatMap((id) => {
    const o = bySo.get(id);
    return o ? [mapOut(o)] : [];
  });

  res.json({ rows, total, page, pageSize });
});

export default router;
