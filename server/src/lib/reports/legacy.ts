import type { ReportFilter, ReportSpec } from "./spec.js";

// Memorized reports from the previous Reports page saved a data source key,
// filter values and column keys. They open on the engine through this
// translation, and the phase 5 migration writes the result into each row.

interface LegacySaved {
  dataSourceKey: string;
  filters: Record<string, string>;
  columns: string[];
}

const OPEN_ORDER = ["ENTERED", "CHECKED", "ALLOCATED", "BACKORDERED", "PICK_PACKED"];
const ORDER_LABELS: Record<string, string> = { Entered: "ENTERED", Checked: "CHECKED", Allocated: "ALLOCATED", Backordered: "BACKORDERED", "Pick & Packed": "PICK_PACKED", Released: "PICK_PACKED", Shipped: "SHIPPED", Cancelled: "CANCELLED" };
const OPEN_PO = ["OPEN", "PARTIALLY_RECEIVED"];
const PO_LABELS: Record<string, string> = { Open: "OPEN", "Partially Received": "PARTIALLY_RECEIVED", Received: "RECEIVED", Closed: "CLOSED" };
const OPEN_RETURN = ["ISSUED", "RECEIVED"];
const RETURN_LABELS: Record<string, string> = { Issued: "ISSUED", Received: "RECEIVED", Closed: "CLOSED" };

function statusFilter(value: string | undefined, open: string[], labels: Record<string, string>): ReportFilter[] {
  if (!value) return [];
  if (value === "open") return [{ field: "status", op: "in", values: open }];
  return [{ field: "status", op: "equals", value: labels[value] ?? value }];
}
function contains(field: string, value: string | undefined): ReportFilter[] {
  return value?.trim() ? [{ field, op: "contains", value: value.trim() }] : [];
}
function range(from: string | undefined, to: string | undefined): ReportSpec["dateRange"] {
  if (!from && !to) return { preset: "all" };
  return { preset: "custom", from: from || undefined, to: to || undefined };
}
function pick(columns: string[], map: Record<string, string>, fallback: string[]): string[] {
  const out = columns.map((c) => map[c]).filter((c): c is string => Boolean(c));
  return out.length ? [...new Set(out)] : fallback;
}

export function legacyToSpec(saved: LegacySaved): ReportSpec {
  const f = saved.filters ?? {};
  const base: Omit<ReportSpec, "source"> = { kind: "detail", measures: [], rows: [], columns: null, filters: [], sort: null, dateRange: { preset: "all" }, subColumns: [], presentation: {} };
  switch (saved.dataSourceKey) {
    case "sales-orders":
      return {
        ...base,
        source: "sales-order-lines",
        rows: ["soNumber"],
        filters: [...statusFilter(f.status, OPEN_ORDER, ORDER_LABELS), ...contains("customer", f.customer)],
        dateRange: range(f.orderDateFrom, f.orderDateTo),
        fields: pick(saved.columns, { soNumber: "soNumber", poNumber: "poNumber", customer: "customer", orderDate: "orderDate", status: "status", shipVia: "shipVia", rep: "rep", total: "amount" }, ["soNumber", "poNumber", "customer", "orderDate", "status", "amount"]).concat(["item", "qtyOrdered"]),
      };
    case "sales-order-lines":
      return {
        ...base,
        source: "sales-order-lines",
        filters: [...statusFilter(f.status, OPEN_ORDER, ORDER_LABELS), ...contains("customer", f.customer), ...contains("item", f.item)],
        dateRange: range(f.orderDateFrom, f.orderDateTo),
        fields: pick(saved.columns, { soNumber: "soNumber", customer: "customer", orderDate: "orderDate", status: "status", item: "item", description: "description", um: "um", ordered: "qtyOrdered", shipped: "qtyShipped", remaining: "qtyRemaining", rate: "rate", amount: "amount", cost: "cost", margin: "margin" }, ["soNumber", "customer", "orderDate", "status", "item", "qtyOrdered", "amount"]),
      };
    case "purchase-orders":
      return {
        ...base,
        source: "purchase-order-lines",
        rows: ["poNumber"],
        filters: [...statusFilter(f.status, OPEN_PO, PO_LABELS), ...contains("vendor", f.vendor)],
        dateRange: range(f.orderDateFrom, f.orderDateTo),
        fields: ["poNumber", "vendor", "orderDate", "expectedDate", "status", "item", "qtyOutstanding", "cost"],
      };
    case "purchase-order-lines":
      return {
        ...base,
        source: "purchase-order-lines",
        filters: [...statusFilter(f.status, OPEN_PO, PO_LABELS), ...contains("vendor", f.vendor), ...contains("item", f.item)],
        dateRange: range(f.orderDateFrom, f.orderDateTo),
        fields: pick(saved.columns, { poNumber: "poNumber", vendor: "vendor", orderDate: "orderDate", status: "status", item: "item", description: "description", orderedQty: "qtyOrdered", receivedQty: "qtyReceived", outstanding: "qtyOutstanding", cost: "unitCost" }, ["poNumber", "vendor", "orderDate", "status", "item", "qtyOrdered", "qtyOutstanding"]),
      };
    case "inventory":
      return {
        ...base,
        source: "inventory",
        filters: contains("item", f.item),
        fields: pick(saved.columns, { item: "item", description: "description", um: "um", onHand: "onHand", onSalesOrder: "onSalesOrder", allocated: "reserved", onPurchaseOrder: "onPurchaseOrder", available: "available", rate: "rate", cost: "unitCost", valueAtCost: "valueAtCost" }, ["item", "description", "onHand", "onSalesOrder", "reserved", "onPurchaseOrder", "available"]),
      };
    case "customers":
      return {
        ...base,
        source: "customers",
        filters: contains("name", f.name),
        sort: { by: "name", dir: "asc" },
        fields: pick(saved.columns, { name: "name", accountNumber: "accountNumber", terms: "terms", shipVia: "shipVia", rep: "rep", city: "city", state: "state" }, ["name", "accountNumber", "terms", "rep", "city", "state"]),
      };
    case "vendors":
      return {
        ...base,
        source: "vendors",
        filters: contains("name", f.name),
        sort: { by: "name", dir: "asc" },
        fields: pick(saved.columns, { name: "name", contactName: "contactName", phone: "phone", email: "email" }, ["name", "contactName", "phone", "email"]),
      };
    case "returns":
      return {
        ...base,
        source: "returns",
        rows: ["raNumber"],
        filters: [...statusFilter(f.status, OPEN_RETURN, RETURN_LABELS), ...contains("customer", f.customer)],
        dateRange: range(f.requestDateFrom, f.requestDateTo),
        fields: pick(saved.columns, { raNumber: "raNumber", customer: "customer", requestDate: "requestDate", status: "status", soNumber: "soNumber", totalCredit: "amount" }, ["raNumber", "customer", "requestDate", "status", "amount"]).concat(["item", "qty"]),
      };
    default:
      return { ...base, source: "sales-order-lines" };
  }
}
