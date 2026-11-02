import type { AuthedAccount } from "../../middleware/auth.js";
import { canReadSource } from "./engine.js";
import { SOURCES } from "./sources.js";
import type { DatePreset, ReportSpec } from "./spec.js";

// The standard report catalog - the reports QuickBooks users reach for,
// named and shaped the same way, each one a spec the engine runs as-is.
// Sales figures come from issued invoices (what was billed), orders from
// the sales order lines, purchases from vendor purchase orders.

export type ReportArea = "Sales" | "Orders" | "Purchasing" | "Inventory" | "Accounting" | "Lists";
export const REPORT_AREAS: ReportArea[] = ["Sales", "Orders", "Purchasing", "Inventory", "Accounting", "Lists"];

export interface StandardReport {
  key: string;
  name: string;
  area: ReportArea;
  description: string;
  defaultPreset: DatePreset;
  spec: ReportSpec;
}

const presentation = {};
const OPEN_ORDER_STATUSES = ["ENTERED", "CHECKED", "ALLOCATED", "BACKORDERED", "PICK_PACKED"];
const OPEN_PO_STATUSES = ["OPEN", "PARTIALLY_RECEIVED"];
const ISSUED = [{ field: "status", op: "equals" as const, value: "ISSUED" }];

function spec(partial: Partial<ReportSpec> & Pick<ReportSpec, "source">, preset: DatePreset): ReportSpec {
  return {
    kind: "summary",
    measures: [],
    rows: [],
    columns: null,
    filters: [],
    sort: null,
    subColumns: [],
    presentation,
    ...partial,
    dateRange: { preset },
  };
}

function report(key: string, name: string, area: ReportArea, description: string, defaultPreset: DatePreset, partial: Partial<ReportSpec> & Pick<ReportSpec, "source">): StandardReport {
  return { key, name, area, description, defaultPreset, spec: spec(partial, defaultPreset) };
}

const SALES_DETAIL_FIELDS = ["number", "date", "customer", "soNumber", "poNumber", "item", "description", "qty", "rate", "amount"];
const OPEN_ORDER_FIELDS = ["soNumber", "orderDate", "customer", "poNumber", "status", "item", "description", "qtyOrdered", "qtyShipped", "qtyRemaining", "rate", "amount"];
const PO_DETAIL_FIELDS = ["poNumber", "orderDate", "expectedDate", "vendor", "status", "item", "description", "qtyOrdered", "qtyReceived", "qtyOutstanding", "unitCost", "cost"];

export const STANDARD_REPORTS: StandardReport[] = [
  // ---- Sales (what was invoiced) ----
  report("sales-by-customer-summary", "Sales by Customer Summary", "Sales", "Invoiced sales totaled by customer.", "this-month-to-date", {
    source: "invoice-lines",
    measures: ["qty", "amount"],
    rows: ["customer"],
    filters: ISSUED,
    sort: { by: "amount", dir: "desc" },
  }),
  report("sales-by-customer-detail", "Sales by Customer Detail", "Sales", "Every invoiced line, grouped by customer.", "this-month-to-date", {
    source: "invoice-lines",
    kind: "detail",
    rows: ["customer"],
    filters: ISSUED,
    fields: SALES_DETAIL_FIELDS,
  }),
  report("sales-by-item-summary", "Sales by Item Summary", "Sales", "Invoiced quantity, amount and margin totaled by item.", "this-month-to-date", {
    source: "invoice-lines",
    measures: ["qty", "amount", "cost", "margin"],
    rows: ["item"],
    filters: [...ISSUED, { field: "kind", op: "equals", value: "ITEM" }],
    sort: { by: "amount", dir: "desc" },
  }),
  report("sales-by-item-detail", "Sales by Item Detail", "Sales", "Every invoiced item line, grouped by item.", "this-month-to-date", {
    source: "invoice-lines",
    kind: "detail",
    rows: ["item"],
    filters: [...ISSUED, { field: "kind", op: "equals", value: "ITEM" }],
    fields: ["item", "number", "date", "customer", "soNumber", "qty", "rate", "amount"],
  }),
  report("sales-by-rep-summary", "Sales by Rep Summary", "Sales", "Invoiced sales totaled by sales rep.", "this-month-to-date", {
    source: "invoice-lines",
    measures: ["documents", "amount"],
    rows: ["rep"],
    filters: ISSUED,
    sort: { by: "amount", dir: "desc" },
  }),
  // ---- Orders ----
  report("open-sales-orders-by-customer", "Open Sales Orders by Customer", "Orders", "Every line still owed on an order that hasn't shipped complete, grouped by customer.", "all", {
    source: "sales-order-lines",
    kind: "detail",
    rows: ["customer"],
    filters: [{ field: "status", op: "in", values: OPEN_ORDER_STATUSES }],
    fields: OPEN_ORDER_FIELDS,
  }),
  report("open-sales-orders-by-item", "Open Sales Orders by Item", "Orders", "Every line still owed on an open order, grouped by item.", "all", {
    source: "sales-order-lines",
    kind: "detail",
    rows: ["item"],
    filters: [{ field: "status", op: "in", values: OPEN_ORDER_STATUSES }],
    fields: ["item", "soNumber", "orderDate", "customer", "status", "qtyOrdered", "qtyShipped", "qtyRemaining", "amount"],
  }),
  report("backorders-by-item", "Backorders by Item", "Orders", "Lines on back-ordered orders and the quantity each item is short, grouped by item.", "all", {
    source: "sales-order-lines",
    kind: "detail",
    rows: ["item"],
    filters: [{ field: "status", op: "equals", value: "BACKORDERED" }],
    fields: ["item", "soNumber", "orderDate", "customer", "qtyOrdered", "qtyShipped", "qtyRemaining"],
  }),
  report("shipments-by-day", "Shipments by Day", "Orders", "Shipments, orders, units and value shipped each day.", "this-month-to-date", {
    source: "shipments",
    measures: ["shipments", "orders", "units", "amount"],
    rows: ["day"],
  }),
  // ---- Accounting ----
  report("invoice-register", "Invoice Register", "Accounting", "Every invoice in the period with its lines, drafts and voids included.", "this-month", {
    source: "invoice-lines",
    kind: "detail",
    rows: ["number"],
    fields: ["number", "date", "dueDate", "customer", "soNumber", "status", "item", "description", "qty", "amount"],
  }),
  report("credit-memo-register", "Credit Memo Register", "Accounting", "Every credit memo in the period with its lines.", "this-month", {
    source: "credit-memo-lines",
    kind: "detail",
    rows: ["number"],
    fields: ["number", "date", "customer", "raNumber", "soNumber", "status", "item", "description", "qty", "amount"],
  }),
  // ---- Purchasing ----
  report("purchases-by-vendor-summary", "Purchases by Vendor Summary", "Purchasing", "Quantity ordered, received and cost on purchase orders, totaled by vendor.", "this-year-to-date", {
    source: "purchase-order-lines",
    measures: ["pos", "qtyOrdered", "qtyReceived", "cost"],
    rows: ["vendor"],
    sort: { by: "cost", dir: "desc" },
  }),
  report("purchases-by-vendor-detail", "Purchases by Vendor Detail", "Purchasing", "Every purchase order line, grouped by vendor.", "this-year-to-date", {
    source: "purchase-order-lines",
    kind: "detail",
    rows: ["vendor"],
    fields: PO_DETAIL_FIELDS,
  }),
  report("open-purchase-orders-by-vendor", "Open Purchase Orders by Vendor", "Purchasing", "Lines still outstanding on open purchase orders, grouped by vendor.", "all", {
    source: "purchase-order-lines",
    kind: "detail",
    rows: ["vendor"],
    filters: [{ field: "status", op: "in", values: OPEN_PO_STATUSES }],
    fields: PO_DETAIL_FIELDS,
  }),
  report("open-purchase-orders-by-item", "Open Purchase Orders by Item", "Purchasing", "Lines still outstanding on open purchase orders, grouped by item.", "all", {
    source: "purchase-order-lines",
    kind: "detail",
    rows: ["item"],
    filters: [{ field: "status", op: "in", values: OPEN_PO_STATUSES }],
    fields: ["item", "poNumber", "orderDate", "expectedDate", "vendor", "qtyOrdered", "qtyReceived", "qtyOutstanding", "cost"],
  }),
  report("receipts-by-vendor", "Receipts by Vendor", "Purchasing", "Units and cost received, totaled by vendor.", "this-month-to-date", {
    source: "receipts",
    measures: ["receipts", "units", "cost"],
    rows: ["vendor"],
  }),
  // ---- Inventory ----
  report("inventory-stock-status-by-item", "Inventory Stock Status by Item", "Inventory", "On hand, on sales order, allocated, available and on purchase order for every item.", "all", {
    source: "inventory",
    kind: "detail",
    fields: ["item", "description", "um", "onHand", "onSalesOrder", "reserved", "available", "onPurchaseOrder", "reorderPoint"],
  }),
  report("inventory-valuation-summary", "Inventory Valuation Summary", "Inventory", "On hand at cost and at rate, totaled by item.", "all", {
    source: "inventory",
    measures: ["onHand", "valueAtCost", "valueAtRate"],
    rows: ["item"],
  }),
  report("item-stock-movement", "Item Stock Movement (QuickReport)", "Inventory", "Every movement of stock in the period - shipments, receipts, returns and adjustments - grouped by item.", "this-month", {
    source: "stock-movements",
    kind: "detail",
    rows: ["item"],
    fields: ["item", "at", "reason", "reference", "delta", "qtyAfter", "actor"],
  }),
  // ---- Lists ----
  report("customer-contact-list", "Customer Contact List", "Lists", "Every customer with address, terms and rep.", "all", {
    source: "customers",
    kind: "detail",
    fields: ["name", "accountNumber", "address", "city", "state", "zip", "terms", "shipVia", "rep"],
    filters: [{ field: "active", op: "equals", value: "true" }],
    sort: { by: "name", dir: "asc" },
  }),
  report("vendor-contact-list", "Vendor Contact List", "Lists", "Every vendor with contact, phone, email and terms.", "all", {
    source: "vendors",
    kind: "detail",
    fields: ["name", "contactName", "phone", "email", "accountNumber", "terms", "leadTimeDays"],
    filters: [{ field: "active", op: "equals", value: "true" }],
    sort: { by: "name", dir: "asc" },
  }),
];

export function standardReport(key: string): StandardReport | undefined {
  return STANDARD_REPORTS.find((r) => r.key === key);
}

// The catalog this account may read: a report is offered when its source is.
export function catalogFor(account: AuthedAccount): StandardReport[] {
  return STANDARD_REPORTS.filter((r) => canReadSource(account, SOURCES[r.spec.source]));
}
