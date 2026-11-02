import { Prisma } from "@prisma/client";
import { ORDER_READ_PAGES } from "../orderView.js";
import type { ReportSource } from "./spec.js";

// What each report source is made of: the FROM clause, the date it is dated
// by, the dimensions it can be totaled by, the measures it can total and the
// columns a detail report shows. Every expression is parameter-free SQL
// (Prisma.sql with no values) so the same fragment can appear in SELECT,
// GROUP BY and GROUPING() and still read as one expression to Postgres.

export type ValueKind = "text" | "date" | "datetime" | "qty" | "money" | "cost" | "count" | "pct" | "rate";

export interface Dimension {
  key: string;
  label: string;
  sql: Prisma.Sql;
  // Fixed vocabulary (statuses, reasons): offered as filter options and
  // used to label the raw values on screen.
  options?: { value: string; label: string }[];
}

export interface Measure {
  key: string;
  label: string;
  // An aggregate expression.
  sql: Prisma.Sql;
  kind: "qty" | "money" | "cost" | "count";
}

export interface DetailColumn {
  key: string;
  label: string;
  sql: Prisma.Sql;
  kind: ValueKind;
  // Summed into subtotals and the total.
  sum?: boolean;
  // The dimension this column shows, so a zoom can filter on it.
  dimension?: string;
  // Selected for the row's link but never shown.
  hidden?: boolean;
}

export interface SourceDef {
  key: ReportSource;
  label: string;
  // Any one of these pages lets an account read the source (admin always may).
  viewPages: string[];
  from: Prisma.Sql;
  where?: Prisma.Sql;
  // What the date range and the date buckets apply to.
  dateField: { label: string; sql: Prisma.Sql; type: "date" | "timestamp" } | null;
  dimensions: Dimension[];
  measures: Measure[];
  detail: DetailColumn[];
  // Ties in a detail report break on this.
  detailOrder: Prisma.Sql;
  link: (row: Record<string, unknown>) => string | null;
}

const s = Prisma.sql;
const opt = (values: [string, string][]) => values.map(([value, label]) => ({ value, label }));

const ORDER_STATUS = opt([
  ["ENTERED", "Entered"],
  ["CHECKED", "Checked"],
  ["ALLOCATED", "Allocated"],
  ["BACKORDERED", "Backordered"],
  ["PICK_PACKED", "Released"],
  ["SHIPPED", "Shipped"],
  ["CANCELLED", "Cancelled"],
]);
const PO_STATUS = opt([
  ["OPEN", "Open"],
  ["PARTIALLY_RECEIVED", "Partially Received"],
  ["RECEIVED", "Received"],
  ["CLOSED", "Closed"],
]);
const DOC_STATUS = opt([
  ["DRAFT", "Draft"],
  ["ISSUED", "Issued"],
  ["VOID", "Void"],
]);
const RETURN_STATUS = opt([
  ["ISSUED", "Issued"],
  ["RECEIVED", "Received"],
  ["CLOSED", "Closed"],
]);
const LINE_KIND = opt([
  ["ITEM", "Item"],
  ["CHARGE", "Charge"],
]);
const MOVEMENT_REASON = opt([
  ["OPENING", "Opening stock"],
  ["SHIP", "Shipped"],
  ["UNDO_SHIP", "Shipment undone"],
  ["RECEIVE_PO", "Received on PO"],
  ["RETURN", "Customer return"],
  ["ADJUST", "Adjustment"],
]);
const YES_NO = opt([
  ["true", "Yes"],
  ["false", "No"],
]);

// Shipped units per order line, from the shipment records' line JSON.
const SHIPPED_BY_LINE = s`(SELECT sr."soNumber", e->>'lineItemId' AS "lineItemId", SUM((e->>'qty')::int) AS "qty"
  FROM "ShipmentRecord" sr CROSS JOIN LATERAL jsonb_array_elements(sr."lines") e GROUP BY 1, 2)`;

const PURCHASING_PAGES = ["purchase-orders", "receiving", "inbound-shipments"];
const INVENTORY_PAGES = ["inventory", "catalog", "receiving", "purchase-orders"];

const salesOrderLines: SourceDef = {
  key: "sales-order-lines",
  label: "Sales Order Lines",
  viewPages: ORDER_READ_PAGES,
  from: s`"SalesOrderLine" l
    JOIN "SalesOrder" so ON so."soNumber" = l."soNumber"
    LEFT JOIN "Customer" c ON c."id" = so."customerId"
    LEFT JOIN "Item" i ON i."id" = l."itemId"
    LEFT JOIN ${SHIPPED_BY_LINE} sh ON sh."lineItemId" = l."id"`,
  dateField: { label: "Order Date", sql: s`so."orderDate"`, type: "date" },
  dimensions: [
    { key: "customer", label: "Customer", sql: s`COALESCE(c."name", so."billTo"->>'name')` },
    { key: "item", label: "Item", sql: s`l."item"` },
    { key: "rep", label: "Rep", sql: s`so."rep"` },
    { key: "status", label: "Status", sql: s`so."status"::text`, options: ORDER_STATUS },
    { key: "shipVia", label: "Ship Via", sql: s`so."shipVia"` },
    { key: "shipToState", label: "Ship To State", sql: s`so."shipTo"->>'state'` },
    { key: "soNumber", label: "S.O. #", sql: s`so."soNumber"::text` },
    { key: "poNumber", label: "Customer P.O. #", sql: s`so."poNumber"` },
  ],
  measures: [
    { key: "qtyOrdered", label: "Qty Ordered", sql: s`COALESCE(SUM(l."ordered"), 0)::float8`, kind: "qty" },
    { key: "qtyShipped", label: "Qty Shipped", sql: s`COALESCE(SUM(COALESCE(sh."qty", 0)), 0)::float8`, kind: "qty" },
    { key: "qtyRemaining", label: "Qty Remaining", sql: s`COALESCE(SUM(GREATEST(l."ordered" - COALESCE(sh."qty", 0), 0)), 0)::float8`, kind: "qty" },
    { key: "amount", label: "Amount", sql: s`COALESCE(SUM(ROUND(l."ordered" * l."rate", 2)), 0)::float8`, kind: "money" },
    { key: "cost", label: "Cost", sql: s`COALESCE(SUM(l."ordered" * i."cost"), 0)::float8`, kind: "cost" },
    { key: "margin", label: "Margin", sql: s`COALESCE(SUM(l."ordered" * (l."rate" - i."cost")) FILTER (WHERE i."cost" IS NOT NULL), 0)::float8`, kind: "cost" },
    { key: "orders", label: "Orders", sql: s`COUNT(DISTINCT so."soNumber")::int`, kind: "count" },
    { key: "lines", label: "Lines", sql: s`COUNT(*)::int`, kind: "count" },
  ],
  detail: [
    { key: "soNumber", label: "S.O. #", sql: s`so."soNumber"::text`, kind: "text", dimension: "soNumber" },
    { key: "orderDate", label: "Order Date", sql: s`to_char(so."orderDate", 'YYYY-MM-DD')`, kind: "date" },
    { key: "customer", label: "Customer", sql: s`COALESCE(c."name", so."billTo"->>'name')`, kind: "text", dimension: "customer" },
    { key: "poNumber", label: "Customer P.O. #", sql: s`so."poNumber"`, kind: "text", dimension: "poNumber" },
    { key: "status", label: "Status", sql: s`so."status"::text`, kind: "text", dimension: "status" },
    { key: "rep", label: "Rep", sql: s`so."rep"`, kind: "text", dimension: "rep" },
    { key: "shipVia", label: "Ship Via", sql: s`so."shipVia"`, kind: "text", dimension: "shipVia" },
    { key: "item", label: "Item", sql: s`l."item"`, kind: "text", dimension: "item" },
    { key: "description", label: "Description", sql: s`l."description"`, kind: "text" },
    { key: "um", label: "U/M", sql: s`l."um"`, kind: "text" },
    { key: "qtyOrdered", label: "Ordered", sql: s`l."ordered"::float8`, kind: "qty", sum: true },
    { key: "qtyShipped", label: "Shipped", sql: s`COALESCE(sh."qty", 0)::float8`, kind: "qty", sum: true },
    { key: "qtyRemaining", label: "Remaining", sql: s`GREATEST(l."ordered" - COALESCE(sh."qty", 0), 0)::float8`, kind: "qty", sum: true },
    { key: "rate", label: "Rate", sql: s`l."rate"::float8`, kind: "rate" },
    { key: "amount", label: "Amount", sql: s`ROUND(l."ordered" * l."rate", 2)::float8`, kind: "money", sum: true },
    { key: "cost", label: "Cost", sql: s`(l."ordered" * i."cost")::float8`, kind: "cost", sum: true },
    { key: "margin", label: "Margin", sql: s`(l."ordered" * (l."rate" - i."cost"))::float8`, kind: "cost", sum: true },
  ],
  detailOrder: s`so."soNumber", l."id"`,
  link: (r) => `/storage/${r.soNumber}`,
};

const shipments: SourceDef = {
  key: "shipments",
  label: "Shipments",
  viewPages: ORDER_READ_PAGES,
  from: s`"ShipmentRecord" sr
    JOIN "SalesOrder" so ON so."soNumber" = sr."soNumber"
    CROSS JOIN LATERAL jsonb_array_elements(sr."lines") e
    LEFT JOIN "SalesOrderLine" l ON l."id" = e->>'lineItemId'
    LEFT JOIN "Customer" c ON c."id" = so."customerId"
    LEFT JOIN "Item" i ON i."id" = l."itemId"`,
  where: s`(e->>'qty')::int > 0`,
  dateField: { label: "Ship Date", sql: s`sr."shippedAt"`, type: "timestamp" },
  dimensions: [
    { key: "customer", label: "Customer", sql: s`COALESCE(c."name", so."billTo"->>'name')` },
    { key: "item", label: "Item", sql: s`l."item"` },
    { key: "rep", label: "Rep", sql: s`so."rep"` },
    { key: "carrier", label: "Carrier", sql: s`COALESCE(sr."carrier", '')` },
    { key: "shipVia", label: "Ship Via", sql: s`so."shipVia"` },
    { key: "shipToState", label: "Ship To State", sql: s`so."shipTo"->>'state'` },
    { key: "soNumber", label: "S.O. #", sql: s`so."soNumber"::text` },
  ],
  measures: [
    { key: "units", label: "Units", sql: s`COALESCE(SUM((e->>'qty')::int), 0)::float8`, kind: "qty" },
    { key: "shipments", label: "Shipments", sql: s`COUNT(DISTINCT sr."id")::int`, kind: "count" },
    { key: "orders", label: "Orders", sql: s`COUNT(DISTINCT so."soNumber")::int`, kind: "count" },
    { key: "amount", label: "Amount", sql: s`COALESCE(SUM(ROUND((e->>'qty')::int * l."rate", 2)), 0)::float8`, kind: "money" },
    { key: "weight", label: "Weight (lb)", sql: s`COALESCE(SUM((e->>'qty')::int * COALESCE(i."weight", 0)), 0)::float8`, kind: "qty" },
  ],
  detail: [
    { key: "shippedAt", label: "Shipped", sql: s`to_char(sr."shippedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')`, kind: "datetime" },
    { key: "soNumber", label: "S.O. #", sql: s`so."soNumber"::text`, kind: "text", dimension: "soNumber" },
    { key: "customer", label: "Customer", sql: s`COALESCE(c."name", so."billTo"->>'name')`, kind: "text", dimension: "customer" },
    { key: "carrier", label: "Carrier", sql: s`COALESCE(sr."carrier", '')`, kind: "text", dimension: "carrier" },
    { key: "proNumber", label: "PRO #", sql: s`COALESCE(sr."proNumber", '')`, kind: "text" },
    { key: "item", label: "Item", sql: s`l."item"`, kind: "text", dimension: "item" },
    { key: "description", label: "Description", sql: s`l."description"`, kind: "text" },
    { key: "units", label: "Units", sql: s`(e->>'qty')::int::float8`, kind: "qty", sum: true },
    { key: "rate", label: "Rate", sql: s`l."rate"::float8`, kind: "rate" },
    { key: "amount", label: "Amount", sql: s`ROUND((e->>'qty')::int * l."rate", 2)::float8`, kind: "money", sum: true },
    { key: "pickedBy", label: "Picked By", sql: s`COALESCE(sr."pickedBy", '')`, kind: "text" },
    { key: "checkedBy", label: "Checked By", sql: s`COALESCE(sr."checkedBy", '')`, kind: "text" },
  ],
  detailOrder: s`sr."shippedAt", sr."id", l."id"`,
  link: (r) => `/storage/${r.soNumber}`,
};

function documentLines(kind: "invoice" | "credit-memo"): SourceDef {
  const inv = kind === "invoice";
  const docTable = inv ? s`"Invoice"` : s`"CreditMemo"`;
  const lineTable = inv ? s`"InvoiceLine"` : s`"CreditMemoLine"`;
  const docId = inv ? s`dl."invoiceId"` : s`dl."creditMemoId"`;
  const number = inv ? s`d."invoiceNumber"` : s`d."creditMemoNumber"`;
  const date = inv ? s`d."invoiceDate"` : s`d."memoDate"`;
  const numberLabel = inv ? "Invoice #" : "Credit Memo #";
  return {
    key: inv ? "invoice-lines" : "credit-memo-lines",
    label: inv ? "Invoice Lines" : "Credit Memo Lines",
    viewPages: ["invoices"],
    from: s`${lineTable} dl
      JOIN ${docTable} d ON d."id" = ${docId}
      LEFT JOIN "Item" i ON i."id" = dl."itemId"`,
    dateField: { label: inv ? "Invoice Date" : "Memo Date", sql: date, type: "date" },
    dimensions: [
      { key: "customer", label: "Customer", sql: s`d."customerName"` },
      { key: "item", label: "Item", sql: s`dl."item"` },
      ...(inv ? [{ key: "rep", label: "Rep", sql: s`d."rep"` }] : []),
      { key: "status", label: "Status", sql: s`d."status"::text`, options: DOC_STATUS },
      { key: "kind", label: "Line Type", sql: s`dl."kind"::text`, options: LINE_KIND },
      { key: "number", label: numberLabel, sql: s`COALESCE(${number}, 'Draft')` },
      { key: "soNumber", label: "S.O. #", sql: s`d."soNumber"::text` },
      ...(inv ? [{ key: "poNumber", label: "Customer P.O. #", sql: s`d."poNumber"` }] : [{ key: "raNumber", label: "RA #", sql: s`d."raNumber"` }]),
    ],
    measures: [
      { key: "qty", label: "Qty", sql: s`COALESCE(SUM(dl."qty") FILTER (WHERE dl."kind" = 'ITEM'), 0)::float8`, kind: "qty" },
      { key: "amount", label: "Amount", sql: s`COALESCE(SUM(dl."amount"), 0)::float8`, kind: "money" },
      { key: "cost", label: "Cost", sql: s`COALESCE(SUM(dl."qty" * i."cost") FILTER (WHERE dl."kind" = 'ITEM'), 0)::float8`, kind: "cost" },
      { key: "margin", label: "Margin", sql: s`COALESCE(SUM(dl."amount" - dl."qty" * i."cost") FILTER (WHERE dl."kind" = 'ITEM' AND i."cost" IS NOT NULL), 0)::float8`, kind: "cost" },
      { key: "documents", label: inv ? "Invoices" : "Credit Memos", sql: s`COUNT(DISTINCT d."id")::int`, kind: "count" },
    ],
    detail: [
      { key: "number", label: numberLabel, sql: s`COALESCE(${number}, 'Draft')`, kind: "text", dimension: "number" },
      { key: "date", label: inv ? "Invoice Date" : "Memo Date", sql: s`to_char(${date}, 'YYYY-MM-DD')`, kind: "date" },
      ...(inv ? [{ key: "dueDate", label: "Due Date", sql: s`to_char(d."dueDate", 'YYYY-MM-DD')`, kind: "date" as const }] : []),
      { key: "customer", label: "Customer", sql: s`d."customerName"`, kind: "text", dimension: "customer" },
      { key: "soNumber", label: "S.O. #", sql: s`COALESCE(d."soNumber"::text, '')`, kind: "text", dimension: "soNumber" },
      ...(inv ? [{ key: "poNumber", label: "Customer P.O. #", sql: s`d."poNumber"`, kind: "text" as const, dimension: "poNumber" }] : [{ key: "raNumber", label: "RA #", sql: s`d."raNumber"`, kind: "text" as const, dimension: "raNumber" }]),
      { key: "status", label: "Status", sql: s`d."status"::text`, kind: "text", dimension: "status" },
      { key: "kind", label: "Line Type", sql: s`dl."kind"::text`, kind: "text", dimension: "kind" },
      { key: "item", label: "Item", sql: s`dl."item"`, kind: "text", dimension: "item" },
      { key: "description", label: "Description", sql: s`dl."description"`, kind: "text" },
      { key: "qty", label: "Qty", sql: s`dl."qty"::float8`, kind: "qty", sum: true },
      { key: "rate", label: "Rate", sql: s`dl."rate"::float8`, kind: "rate" },
      { key: "amount", label: "Amount", sql: s`dl."amount"::float8`, kind: "money", sum: true },
      { key: "cost", label: "Cost", sql: s`CASE WHEN dl."kind" = 'ITEM' THEN (dl."qty" * i."cost")::float8 END`, kind: "cost", sum: true },
      { key: "_id", label: "", sql: s`d."id"`, kind: "text", hidden: true },
    ],
    detailOrder: s`${date}, d."id", dl."position"`,
    link: (r) => (inv ? `/invoices/${r.number === "Draft" ? r._id : r.number}` : `/invoices/credit-memos/${r.number === "Draft" ? r._id : r.number}`),
  };
}

const purchaseOrderLines: SourceDef = {
  key: "purchase-order-lines",
  label: "Purchase Order Lines",
  viewPages: PURCHASING_PAGES,
  from: s`"VendorPoLine" pl
    JOIN "VendorPurchaseOrder" po ON po."poNumber" = pl."poNumber"
    LEFT JOIN "Vendor" v ON v."id" = po."vendorId"
    LEFT JOIN "Item" i ON i."id" = pl."itemId"`,
  dateField: { label: "Order Date", sql: s`po."orderDate"`, type: "date" },
  dimensions: [
    { key: "vendor", label: "Vendor", sql: s`COALESCE(v."name", po."vendorName")` },
    { key: "item", label: "Item", sql: s`pl."itemNumber"` },
    { key: "status", label: "Status", sql: s`po."status"::text`, options: PO_STATUS },
    { key: "poNumber", label: "PO #", sql: s`po."poNumber"` },
    { key: "createdBy", label: "Written By", sql: s`COALESCE(po."createdBy", '')` },
  ],
  measures: [
    { key: "qtyOrdered", label: "Qty Ordered", sql: s`COALESCE(SUM(pl."orderedQty"), 0)::float8`, kind: "qty" },
    { key: "qtyReceived", label: "Qty Received", sql: s`COALESCE(SUM(pl."receivedQty"), 0)::float8`, kind: "qty" },
    { key: "qtyOutstanding", label: "Qty Outstanding", sql: s`COALESCE(SUM(GREATEST(pl."orderedQty" - pl."receivedQty", 0)), 0)::float8`, kind: "qty" },
    { key: "cost", label: "Cost", sql: s`COALESCE(SUM(ROUND(pl."orderedQty" * pl."cost", 2)), 0)::float8`, kind: "cost" },
    { key: "outstandingValue", label: "Outstanding Value", sql: s`COALESCE(SUM(ROUND(GREATEST(pl."orderedQty" - pl."receivedQty", 0) * pl."cost", 2)), 0)::float8`, kind: "cost" },
    { key: "pos", label: "POs", sql: s`COUNT(DISTINCT po."poNumber")::int`, kind: "count" },
  ],
  detail: [
    { key: "poNumber", label: "PO #", sql: s`po."poNumber"`, kind: "text", dimension: "poNumber" },
    { key: "orderDate", label: "Order Date", sql: s`to_char(po."orderDate", 'YYYY-MM-DD')`, kind: "date" },
    { key: "expectedDate", label: "Expected", sql: s`COALESCE(to_char(po."expectedDate", 'YYYY-MM-DD'), '')`, kind: "date" },
    { key: "vendor", label: "Vendor", sql: s`COALESCE(v."name", po."vendorName")`, kind: "text", dimension: "vendor" },
    { key: "status", label: "Status", sql: s`po."status"::text`, kind: "text", dimension: "status" },
    { key: "item", label: "Item", sql: s`pl."itemNumber"`, kind: "text", dimension: "item" },
    { key: "description", label: "Description", sql: s`pl."description"`, kind: "text" },
    { key: "qtyOrdered", label: "Ordered", sql: s`pl."orderedQty"::float8`, kind: "qty", sum: true },
    { key: "qtyReceived", label: "Received", sql: s`pl."receivedQty"::float8`, kind: "qty", sum: true },
    { key: "qtyOutstanding", label: "Outstanding", sql: s`GREATEST(pl."orderedQty" - pl."receivedQty", 0)::float8`, kind: "qty", sum: true },
    { key: "unitCost", label: "Unit Cost", sql: s`pl."cost"::float8`, kind: "cost" },
    { key: "cost", label: "Cost", sql: s`ROUND(pl."orderedQty" * pl."cost", 2)::float8`, kind: "cost", sum: true },
  ],
  detailOrder: s`po."orderDate", po."poNumber", pl."id"`,
  link: (r) => `/purchase-orders/${r.poNumber}`,
};

const receipts: SourceDef = {
  key: "receipts",
  label: "Receipts",
  viewPages: PURCHASING_PAGES,
  from: s`"VendorReceivingRecord" rr
    JOIN "VendorPurchaseOrder" po ON po."poNumber" = rr."poNumber"
    CROSS JOIN LATERAL jsonb_array_elements(rr."lines") e
    LEFT JOIN "VendorPoLine" pl ON pl."id" = e->>'lineId'
    LEFT JOIN "Vendor" v ON v."id" = po."vendorId"
    LEFT JOIN "Item" i ON i."id" = pl."itemId"`,
  where: s`(e->>'qty')::int > 0`,
  dateField: { label: "Received Date", sql: s`rr."receivedAt"`, type: "timestamp" },
  dimensions: [
    { key: "vendor", label: "Vendor", sql: s`COALESCE(v."name", po."vendorName")` },
    { key: "item", label: "Item", sql: s`pl."itemNumber"` },
    { key: "poNumber", label: "PO #", sql: s`po."poNumber"` },
  ],
  measures: [
    { key: "units", label: "Units", sql: s`COALESCE(SUM((e->>'qty')::int), 0)::float8`, kind: "qty" },
    { key: "cost", label: "Cost", sql: s`COALESCE(SUM(ROUND((e->>'qty')::int * pl."cost", 2)), 0)::float8`, kind: "cost" },
    { key: "receipts", label: "Receipts", sql: s`COUNT(DISTINCT rr."id")::int`, kind: "count" },
    { key: "pos", label: "POs", sql: s`COUNT(DISTINCT po."poNumber")::int`, kind: "count" },
  ],
  detail: [
    { key: "receivedAt", label: "Received", sql: s`to_char(rr."receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')`, kind: "datetime" },
    { key: "poNumber", label: "PO #", sql: s`po."poNumber"`, kind: "text", dimension: "poNumber" },
    { key: "vendor", label: "Vendor", sql: s`COALESCE(v."name", po."vendorName")`, kind: "text", dimension: "vendor" },
    { key: "item", label: "Item", sql: s`pl."itemNumber"`, kind: "text", dimension: "item" },
    { key: "description", label: "Description", sql: s`pl."description"`, kind: "text" },
    { key: "units", label: "Units", sql: s`(e->>'qty')::int::float8`, kind: "qty", sum: true },
    { key: "unitCost", label: "Unit Cost", sql: s`pl."cost"::float8`, kind: "cost" },
    { key: "cost", label: "Cost", sql: s`ROUND((e->>'qty')::int * pl."cost", 2)::float8`, kind: "cost", sum: true },
  ],
  detailOrder: s`rr."receivedAt", rr."id", pl."id"`,
  link: (r) => `/purchase-orders/${r.poNumber}`,
};

const stockMovements: SourceDef = {
  key: "stock-movements",
  label: "Stock Movements",
  viewPages: INVENTORY_PAGES,
  from: s`"StockMovement" sm
    LEFT JOIN "Item" i ON i."id" = sm."itemId"`,
  dateField: { label: "Date", sql: s`sm."createdAt"`, type: "timestamp" },
  dimensions: [
    { key: "item", label: "Item", sql: s`sm."itemNumber"` },
    { key: "reason", label: "Reason", sql: s`sm."reason"`, options: MOVEMENT_REASON },
    { key: "actor", label: "By", sql: s`sm."actorUsername"` },
    { key: "refType", label: "Reference Type", sql: s`COALESCE(sm."refType", '')` },
  ],
  measures: [
    { key: "unitsIn", label: "Units In", sql: s`COALESCE(SUM(sm."delta") FILTER (WHERE sm."delta" > 0), 0)::float8`, kind: "qty" },
    { key: "unitsOut", label: "Units Out", sql: s`COALESCE(SUM(-sm."delta") FILTER (WHERE sm."delta" < 0), 0)::float8`, kind: "qty" },
    { key: "net", label: "Net Change", sql: s`COALESCE(SUM(sm."delta"), 0)::float8`, kind: "qty" },
    { key: "movements", label: "Movements", sql: s`COUNT(*)::int`, kind: "count" },
  ],
  detail: [
    { key: "at", label: "Date", sql: s`to_char(sm."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')`, kind: "datetime" },
    { key: "item", label: "Item", sql: s`sm."itemNumber"`, kind: "text", dimension: "item" },
    { key: "description", label: "Description", sql: s`COALESCE(i."description", '')`, kind: "text" },
    { key: "reason", label: "Reason", sql: s`sm."reason"`, kind: "text", dimension: "reason" },
    { key: "reference", label: "Reference", sql: s`COALESCE(sm."refId", '')`, kind: "text" },
    { key: "delta", label: "Change", sql: s`sm."delta"::float8`, kind: "qty", sum: true },
    { key: "qtyAfter", label: "On Hand After", sql: s`sm."qtyAfter"::float8`, kind: "qty" },
    { key: "actor", label: "By", sql: s`sm."actorUsername"`, kind: "text", dimension: "actor" },
    { key: "_refType", label: "", sql: s`COALESCE(sm."refType", '')`, kind: "text", hidden: true },
    { key: "_itemId", label: "", sql: s`sm."itemId"`, kind: "text", hidden: true },
  ],
  detailOrder: s`sm."createdAt", sm."id"`,
  link: (r) => {
    const ref = String(r.reference ?? "");
    switch (r._refType) {
      case "sales-order":
        return `/storage/${ref}`;
      case "vendor-po":
        return `/purchase-orders/${ref}`;
      case "return":
        return `/returns/${ref}`;
      default:
        return `/items/${r._itemId}`;
    }
  },
};

// Units still owed on open orders, per item (QuickBooks' "On Sales Order").
const ON_SALES_ORDER = s`(SELECT l."itemId", SUM(GREATEST(l."ordered" - COALESCE(sh."qty", 0), 0)) AS "qty"
  FROM "SalesOrderLine" l
  JOIN "SalesOrder" so ON so."soNumber" = l."soNumber"
  LEFT JOIN ${SHIPPED_BY_LINE} sh ON sh."lineItemId" = l."id"
  WHERE so."status"::text NOT IN ('SHIPPED', 'CANCELLED')
  GROUP BY 1)`;

const inventory: SourceDef = {
  key: "inventory",
  label: "Inventory",
  viewPages: INVENTORY_PAGES,
  from: s`"Item" i
    LEFT JOIN "Vendor" v ON v."id" = i."preferredVendorId"
    LEFT JOIN ${ON_SALES_ORDER} oso ON oso."itemId" = i."id"`,
  dateField: null,
  dimensions: [
    { key: "item", label: "Item", sql: s`i."itemNumber"` },
    { key: "vendor", label: "Preferred Vendor", sql: s`COALESCE(v."name", '')` },
    { key: "um", label: "U/M", sql: s`i."um"` },
    { key: "countryOfOrigin", label: "Country of Origin", sql: s`COALESCE(i."countryOfOrigin", '')` },
    { key: "stocked", label: "In Stock", sql: s`(i."qtyOnHand" > 0)::text`, options: YES_NO },
  ],
  measures: [
    { key: "onHand", label: "On Hand", sql: s`COALESCE(SUM(i."qtyOnHand"), 0)::float8`, kind: "qty" },
    { key: "onSalesOrder", label: "On Sales Order", sql: s`COALESCE(SUM(COALESCE(oso."qty", 0)), 0)::float8`, kind: "qty" },
    { key: "reserved", label: "Allocated", sql: s`COALESCE(SUM(i."qtyReserved"), 0)::float8`, kind: "qty" },
    { key: "available", label: "Available", sql: s`COALESCE(SUM(i."qtyOnHand" - i."qtyReserved"), 0)::float8`, kind: "qty" },
    { key: "onPurchaseOrder", label: "On Purchase Order", sql: s`COALESCE(SUM(i."qtyOnPurchaseOrder"), 0)::float8`, kind: "qty" },
    { key: "valueAtRate", label: "On Hand at Rate", sql: s`COALESCE(SUM(ROUND(i."qtyOnHand" * i."rate", 2)), 0)::float8`, kind: "money" },
    { key: "valueAtCost", label: "On Hand at Cost", sql: s`COALESCE(SUM(ROUND(GREATEST(i."qtyOnHand", 0) * COALESCE(i."cost", 0), 2)), 0)::float8`, kind: "cost" },
    { key: "items", label: "Items", sql: s`COUNT(*)::int`, kind: "count" },
  ],
  detail: [
    { key: "item", label: "Item", sql: s`i."itemNumber"`, kind: "text", dimension: "item" },
    { key: "description", label: "Description", sql: s`i."description"`, kind: "text" },
    { key: "um", label: "U/M", sql: s`i."um"`, kind: "text", dimension: "um" },
    { key: "vendor", label: "Preferred Vendor", sql: s`COALESCE(v."name", '')`, kind: "text", dimension: "vendor" },
    { key: "onHand", label: "On Hand", sql: s`i."qtyOnHand"::float8`, kind: "qty", sum: true },
    { key: "onSalesOrder", label: "On Sales Order", sql: s`COALESCE(oso."qty", 0)::float8`, kind: "qty", sum: true },
    { key: "reserved", label: "Allocated", sql: s`i."qtyReserved"::float8`, kind: "qty", sum: true },
    { key: "available", label: "Available", sql: s`(i."qtyOnHand" - i."qtyReserved")::float8`, kind: "qty", sum: true },
    { key: "onPurchaseOrder", label: "On Purchase Order", sql: s`i."qtyOnPurchaseOrder"::float8`, kind: "qty", sum: true },
    { key: "reorderPoint", label: "Reorder Point", sql: s`i."reorderPoint"::float8`, kind: "qty" },
    { key: "rate", label: "Rate", sql: s`i."rate"::float8`, kind: "rate" },
    { key: "valueAtRate", label: "On Hand at Rate", sql: s`ROUND(i."qtyOnHand" * i."rate", 2)::float8`, kind: "money", sum: true },
    { key: "unitCost", label: "Unit Cost", sql: s`i."cost"::float8`, kind: "cost" },
    { key: "valueAtCost", label: "On Hand at Cost", sql: s`ROUND(GREATEST(i."qtyOnHand", 0) * COALESCE(i."cost", 0), 2)::float8`, kind: "cost", sum: true },
    { key: "_id", label: "", sql: s`i."id"`, kind: "text", hidden: true },
  ],
  detailOrder: s`i."itemNumber"`,
  link: (r) => `/items/${r._id}`,
};

const returns: SourceDef = {
  key: "returns",
  label: "Returns",
  viewPages: ["returns", "receiving"],
  from: s`"ReturnLine" rl
    JOIN "ReturnAuthorization" ra ON ra."raNumber" = rl."raNumber"
    LEFT JOIN "Customer" c ON c."id" = ra."customerId"
    LEFT JOIN "Item" i ON i."id" = rl."itemId"`,
  dateField: { label: "Request Date", sql: s`ra."requestDate"`, type: "date" },
  dimensions: [
    { key: "customer", label: "Customer", sql: s`COALESCE(c."name", ra."billTo"->>'name')` },
    { key: "item", label: "Item", sql: s`rl."itemNumber"` },
    { key: "status", label: "Status", sql: s`ra."status"::text`, options: RETURN_STATUS },
    { key: "reason", label: "Reason", sql: s`COALESCE(NULLIF(rl."reason", ''), ra."reason")` },
    { key: "raNumber", label: "RA #", sql: s`ra."raNumber"` },
    { key: "soNumber", label: "S.O. #", sql: s`COALESCE(ra."soNumber", '')` },
    { key: "restock", label: "Restocked", sql: s`rl."restock"::text`, options: YES_NO },
  ],
  measures: [
    { key: "qty", label: "Qty", sql: s`COALESCE(SUM(rl."qty"), 0)::float8`, kind: "qty" },
    { key: "qtyRestocked", label: "Qty Restocked", sql: s`COALESCE(SUM(rl."qty") FILTER (WHERE rl."restock"), 0)::float8`, kind: "qty" },
    { key: "amount", label: "Amount", sql: s`COALESCE(SUM(ROUND(rl."qty" * rl."rate", 2)), 0)::float8`, kind: "money" },
    { key: "returns", label: "Returns", sql: s`COUNT(DISTINCT ra."raNumber")::int`, kind: "count" },
  ],
  detail: [
    { key: "raNumber", label: "RA #", sql: s`ra."raNumber"`, kind: "text", dimension: "raNumber" },
    { key: "requestDate", label: "Request Date", sql: s`to_char(ra."requestDate", 'YYYY-MM-DD')`, kind: "date" },
    { key: "customer", label: "Customer", sql: s`COALESCE(c."name", ra."billTo"->>'name')`, kind: "text", dimension: "customer" },
    { key: "soNumber", label: "S.O. #", sql: s`COALESCE(ra."soNumber", '')`, kind: "text", dimension: "soNumber" },
    { key: "status", label: "Status", sql: s`ra."status"::text`, kind: "text", dimension: "status" },
    { key: "receivedAt", label: "Received", sql: s`COALESCE(to_char(ra."receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD'), '')`, kind: "date" },
    { key: "item", label: "Item", sql: s`rl."itemNumber"`, kind: "text", dimension: "item" },
    { key: "description", label: "Description", sql: s`rl."description"`, kind: "text" },
    { key: "reason", label: "Reason", sql: s`COALESCE(NULLIF(rl."reason", ''), ra."reason")`, kind: "text", dimension: "reason" },
    { key: "restock", label: "Restock", sql: s`rl."restock"::text`, kind: "text", dimension: "restock" },
    { key: "qty", label: "Qty", sql: s`rl."qty"::float8`, kind: "qty", sum: true },
    { key: "rate", label: "Rate", sql: s`rl."rate"::float8`, kind: "rate" },
    { key: "amount", label: "Amount", sql: s`ROUND(rl."qty" * rl."rate", 2)::float8`, kind: "money", sum: true },
  ],
  detailOrder: s`ra."requestDate", ra."raNumber", rl."id"`,
  link: (r) => `/returns/${r.raNumber}`,
};

const customers: SourceDef = {
  key: "customers",
  label: "Customers",
  viewPages: ["customers", "order-entry", "customer-pricing", "routing-guide"],
  from: s`"Customer" c`,
  dateField: { label: "Created", sql: s`c."createdAt"`, type: "timestamp" },
  dimensions: [
    { key: "rep", label: "Rep", sql: s`c."rep"` },
    { key: "terms", label: "Terms", sql: s`c."terms"` },
    { key: "shipVia", label: "Ship Via", sql: s`c."shipVia"` },
    { key: "state", label: "State", sql: s`COALESCE(c."billTo"->>'state', '')` },
    { key: "active", label: "Active", sql: s`c."active"::text`, options: YES_NO },
  ],
  measures: [{ key: "customers", label: "Customers", sql: s`COUNT(*)::int`, kind: "count" }],
  detail: [
    { key: "name", label: "Customer", sql: s`c."name"`, kind: "text" },
    { key: "accountNumber", label: "Account #", sql: s`c."accountNumber"`, kind: "text" },
    { key: "address", label: "Address", sql: s`COALESCE(c."billTo"->>'addressLine1', '')`, kind: "text" },
    { key: "city", label: "City", sql: s`COALESCE(c."billTo"->>'city', '')`, kind: "text" },
    { key: "state", label: "State", sql: s`COALESCE(c."billTo"->>'state', '')`, kind: "text", dimension: "state" },
    { key: "zip", label: "Zip", sql: s`COALESCE(c."billTo"->>'zip', '')`, kind: "text" },
    { key: "terms", label: "Terms", sql: s`c."terms"`, kind: "text", dimension: "terms" },
    { key: "shipVia", label: "Ship Via", sql: s`c."shipVia"`, kind: "text", dimension: "shipVia" },
    { key: "rep", label: "Rep", sql: s`c."rep"`, kind: "text", dimension: "rep" },
    { key: "active", label: "Active", sql: s`c."active"::text`, kind: "text", dimension: "active" },
    { key: "_id", label: "", sql: s`c."id"`, kind: "text", hidden: true },
  ],
  detailOrder: s`c."name", c."id"`,
  link: (r) => `/customers/all/${r._id}`,
};

const vendors: SourceDef = {
  key: "vendors",
  label: "Vendors",
  viewPages: ["vendors", "purchase-orders"],
  from: s`"Vendor" v`,
  dateField: { label: "Created", sql: s`v."createdAt"`, type: "timestamp" },
  dimensions: [
    { key: "terms", label: "Terms", sql: s`COALESCE(v."terms", '')` },
    { key: "active", label: "Active", sql: s`v."active"::text`, options: YES_NO },
  ],
  measures: [{ key: "vendors", label: "Vendors", sql: s`COUNT(*)::int`, kind: "count" }],
  detail: [
    { key: "name", label: "Vendor", sql: s`v."name"`, kind: "text" },
    { key: "contactName", label: "Contact", sql: s`COALESCE(v."contactName", '')`, kind: "text" },
    { key: "phone", label: "Phone", sql: s`COALESCE(v."phone", '')`, kind: "text" },
    { key: "email", label: "Email", sql: s`COALESCE(v."email", '')`, kind: "text" },
    { key: "accountNumber", label: "Account #", sql: s`COALESCE(v."accountNumber", '')`, kind: "text" },
    { key: "terms", label: "Terms", sql: s`COALESCE(v."terms", '')`, kind: "text", dimension: "terms" },
    { key: "leadTimeDays", label: "Lead Time (days)", sql: s`v."leadTimeDays"::float8`, kind: "qty" },
    { key: "active", label: "Active", sql: s`v."active"::text`, kind: "text", dimension: "active" },
    { key: "_id", label: "", sql: s`v."id"`, kind: "text", hidden: true },
  ],
  detailOrder: s`v."name", v."id"`,
  link: (r) => `/vendors/${r._id}`,
};

export const SOURCES: Record<ReportSource, SourceDef> = {
  "sales-order-lines": salesOrderLines,
  shipments,
  "invoice-lines": documentLines("invoice"),
  "credit-memo-lines": documentLines("credit-memo"),
  "purchase-order-lines": purchaseOrderLines,
  receipts,
  "stock-movements": stockMovements,
  inventory,
  returns,
  customers,
  vendors,
};
