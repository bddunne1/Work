import { listCustomers } from "../customerStore";
import { listItems } from "../itemStore";
import { listOpenOrders, OPEN_ORDER_STATUSES, searchOrders } from "../orderStore";
import type { OrderSearchParams } from "../orderStore";
import { listReturns } from "../returnStore";
import { listVendorPos } from "../vendorPoStore";
import { listVendors } from "../vendorStore";
import type { OrderStatus, PurchaseOrder, ReturnStatus, VendorPoStatus } from "../../types";
import {
  allocatedQtyFor,
  availableQty,
  lineAmount,
  orderTotal,
  qtyOnOpenSalesOrders,
  remainingToShip,
  returnTotal,
  shippedQtyFor,
  vendorPoCostTotal,
  vendorPoLineOutstanding,
  vendorPoOutstandingTotal,
} from "../../types";
import type { ReportDataSource, ReportFilterValues, ReportRow, ReportRowsResult } from "./types";

const ORDER_STATUSES: OrderStatus[] = ["Entered", "Checked", "Allocated", "Backordered", "Pick & Packed", "Shipped"];
const VENDOR_PO_STATUSES: VendorPoStatus[] = ["Open", "Partially Received", "Received", "Closed"];
const RETURN_STATUSES: ReturnStatus[] = ["Issued", "Received", "Closed"];

function withinDateRange(date: string, from: string, to: string): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function includesText(haystack: string, needle: string): boolean {
  if (!needle.trim()) return true;
  return haystack.toLowerCase().includes(needle.trim().toLowerCase());
}

// Order-based reports fetch through the paged search endpoint with their
// filters applied on the server, instead of downloading every order ever
// entered - most recent orders first, until they yield this many rows.
export const REPORT_ROW_CAP = 5000;
// An item # filter is a substring match; the server matches one exact
// item # per query, so a filter matching up to this many catalog items is
// sent as one query per item. Anything broader is filtered in the browser.
const MAX_ITEM_QUERIES = 10;
const REPORT_PAGE_SIZE = 500;

const ROW_CAP_NOTICE = `Showing the first ${REPORT_ROW_CAP.toLocaleString()} rows (most recent orders first) - more orders matched. Narrow the date range or filters to see the rest.`;

// "Open" in a status filter means every status that still needs work; the
// three "Open ..." presets use it (H-10), so their totals no longer count
// shipped, closed or cancelled records.
export const OPEN_FILTER = "open";
const OPEN_ORDER_SET = new Set<string>(OPEN_ORDER_STATUSES);
const OPEN_VENDOR_PO_SET = new Set<string>(["Open", "Partially Received"]);
const OPEN_RETURN_SET = new Set<string>(["Issued", "Received"]);
function statusMatches(filter: string | undefined, status: string, openSet: Set<string>): boolean {
  if (!filter) return true;
  if (filter === OPEN_FILTER) return openSet.has(status);
  return status === filter;
}
function statusOptions(all: string[], openLabel: string) {
  return [{ value: OPEN_FILTER, label: openLabel }, ...all.map((s) => ({ value: s, label: s }))];
}

// An order report with no date range reads the whole history (163 MB at a
// year of data - PF-01), so one is always applied: the last 90 days unless
// the filters say otherwise.
const DEFAULT_ORDER_DAYS = 90;
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
const DEFAULT_RANGE_NOTICE = `Showing orders from the last ${DEFAULT_ORDER_DAYS} days - set an order date range to see more.`;

// Pages through one search until the orders fetched so far produce `cap`
// report rows (or run out). `truncated` means more orders were left unread.
async function collectOrders(
  params: Omit<OrderSearchParams, "page" | "pageSize">,
  toRows: (orders: PurchaseOrder[]) => ReportRow[],
  cap: number
): Promise<{ orders: PurchaseOrder[]; truncated: boolean }> {
  const orders: PurchaseOrder[] = [];
  const seen = new Set<string>();
  let rowCount = 0;
  for (let page = 1; ; page++) {
    const result = await searchOrders({ ...params, page, pageSize: REPORT_PAGE_SIZE });
    for (const [i, o] of result.rows.entries()) {
      if (seen.has(o.soNumber)) continue;
      seen.add(o.soNumber);
      orders.push(o);
      rowCount += toRows([o]).length;
      if (rowCount >= cap) {
        const moreLeft = i < result.rows.length - 1 || page * REPORT_PAGE_SIZE < result.total;
        return { orders, truncated: rowCount > cap || moreLeft };
      }
    }
    if (result.rows.length < REPORT_PAGE_SIZE || page * REPORT_PAGE_SIZE >= result.total) {
      return { orders, truncated: false };
    }
  }
}

// Rows for an order-based report: date range, status and customer go to
// the server (the customer text rides along as `q`, a superset of a
// bill-to name match - `toRows` still applies every filter exactly).
async function buildOrderReport(
  filters: ReportFilterValues,
  toRows: (orders: PurchaseOrder[]) => ReportRow[]
): Promise<ReportRowsResult> {
  const defaultedRange = !filters.orderDateFrom && !filters.orderDateTo;
  const base: Omit<OrderSearchParams, "page" | "pageSize"> = {
    orderFrom: filters.orderDateFrom || (defaultedRange ? isoDaysAgo(DEFAULT_ORDER_DAYS) : undefined),
    orderTo: filters.orderDateTo || undefined,
    status: filters.status ? (filters.status === OPEN_FILTER ? [...OPEN_ORDER_STATUSES] : [filters.status]) : undefined,
    q: filters.customer?.trim() || undefined,
    sort: "soNumber",
    dir: "desc",
  };

  const itemText = filters.item?.trim() ?? "";
  let queries = [base];
  if (itemText) {
    const matches = (await listItems()).map((i) => i.itemNumber).filter((n) => includesText(n, itemText));
    // No catalog item matches: there is nothing to fetch. This used to fall
    // through to a query for every order ever entered, to show nothing.
    if (matches.length === 0) return { rows: [], notice: `No item number contains "${itemText}".` };
    if (matches.length <= MAX_ITEM_QUERIES) queries = matches.map((item) => ({ ...base, item }));
  }

  const results = await Promise.all(queries.map((q) => collectOrders(q, toRows, REPORT_ROW_CAP)));
  const bySo = new Map<string, PurchaseOrder>();
  for (const r of results) for (const o of r.orders) bySo.set(o.soNumber, o);
  const orders = [...bySo.values()].sort((x, y) => Number(y.soNumber) - Number(x.soNumber));
  const rows = toRows(orders);
  const truncated = results.some((r) => r.truncated) || rows.length > REPORT_ROW_CAP;
  const notice = truncated ? ROW_CAP_NOTICE : defaultedRange ? DEFAULT_RANGE_NOTICE : undefined;
  return { rows: rows.slice(0, REPORT_ROW_CAP), notice };
}

const salesOrders: ReportDataSource = {
  key: "sales-orders",
  viewPaths: ["/open-orders", "/closed-orders", "/storage", "/order-entry", "/validation", "/allocation", "/back-orders", "/pick-pack", "/open-picks", "/schedule", "/bol", "/shipment-history"],
  label: "Sales Orders",
  description: "One row per sales order.",
  columns: [
    { key: "soNumber", label: "S.O. #", linkTo: (row) => `/storage/${row.soNumber}` },
    { key: "poNumber", label: "P.O. #" },
    { key: "customer", label: "Customer" },
    { key: "orderDate", label: "Order Date" },
    { key: "dueDate", label: "Due Date" },
    { key: "status", label: "Status" },
    { key: "shipVia", label: "Ship Via" },
    { key: "rep", label: "Rep" },
    { key: "total", label: "Total", align: "right" },
  ],
  defaultColumns: ["soNumber", "poNumber", "customer", "orderDate", "status", "total"],
  filterFields: [
    { key: "orderDate", label: "Order Date", type: "dateRange" },
    { key: "status", label: "Status", type: "select", options: statusOptions(ORDER_STATUSES, "Open (not shipped or cancelled)") },
    { key: "customer", label: "Customer", type: "text", placeholder: "Search customer name..." },
  ],
  async buildRows(filters): Promise<ReportRowsResult> {
    return buildOrderReport(filters, (orders) =>
      orders
        .filter((o) => withinDateRange(o.orderDate, filters.orderDateFrom ?? "", filters.orderDateTo ?? ""))
        .filter((o) => statusMatches(filters.status, o.status, OPEN_ORDER_SET))
        .filter((o) => includesText(o.billTo.name, filters.customer ?? ""))
        .map((o) => ({
          soNumber: o.soNumber,
          poNumber: o.poNumber,
          customer: o.billTo.name,
          orderDate: o.orderDate,
          dueDate: o.dueDate,
          status: o.status,
          shipVia: o.shipVia,
          rep: o.rep,
          total: orderTotal(o),
        }))
    );
  },
};

// `exactItem` matches the item # exactly (case-insensitive) instead of the
// report filter's substring match - for the one-item quick report.
// `costs` (item # -> last purchase cost) adds cost and margin columns for a
// login that may see cost (E-02); the server leaves cost off the items for
// everyone else, so the map is empty and the columns stay blank.
function salesOrderLineRows(orders: PurchaseOrder[], filters: ReportFilterValues, exactItem?: string, costs: Map<string, number> = new Map()): ReportRow[] {
  const exact = exactItem?.trim().toLowerCase();
  const rows: ReportRow[] = [];
  for (const o of orders) {
    if (!withinDateRange(o.orderDate, filters.orderDateFrom ?? "", filters.orderDateTo ?? "")) continue;
    if (!statusMatches(filters.status, o.status, OPEN_ORDER_SET)) continue;
    if (!includesText(o.billTo.name, filters.customer ?? "")) continue;
    for (const li of o.lineItems) {
      if (exact !== undefined ? li.item.trim().toLowerCase() !== exact : !includesText(li.item, filters.item ?? "")) {
        continue;
      }
      rows.push({
        soNumber: o.soNumber,
        customer: o.billTo.name,
        orderDate: o.orderDate,
        status: o.status,
        item: li.item,
        description: li.description,
        um: li.um,
        ordered: li.ordered,
        shipped: shippedQtyFor(o, li.id),
        remaining: remainingToShip(o, li),
        allocated: allocatedQtyFor(o, li.id),
        rate: li.rate,
        amount: lineAmount(li),
        ...costColumns(costs.get(li.item.trim().toLowerCase()), li),
      });
    }
  }
  return rows;
}

function costColumns(cost: number | undefined, li: { rate: number; ordered: number }): ReportRow {
  return cost === undefined ? {} : { cost, margin: Math.round((li.rate - cost) * li.ordered * 100) / 100 };
}

// Item # -> last purchase cost, for the items whose cost this login may see.
function costIndex(items: { itemNumber: string; cost?: number | null }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const i of items) if (typeof i.cost === "number") map.set(i.itemNumber.trim().toLowerCase(), i.cost);
  return map;
}

const salesOrderLines: ReportDataSource = {
  key: "sales-order-lines",
  viewPaths: ["/open-orders", "/closed-orders", "/storage", "/order-entry", "/validation", "/allocation", "/back-orders", "/pick-pack", "/open-picks", "/schedule", "/bol", "/shipment-history"],
  label: "Sales Order Lines",
  description: "One row per item line across every sales order - which orders an item is on, and how much of it.",
  columns: [
    { key: "soNumber", label: "S.O. #", linkTo: (row) => `/storage/${row.soNumber}` },
    { key: "customer", label: "Customer" },
    { key: "orderDate", label: "Order Date" },
    { key: "status", label: "Status" },
    { key: "item", label: "Item" },
    { key: "description", label: "Description" },
    { key: "um", label: "U/M" },
    { key: "ordered", label: "Ordered", align: "right" },
    { key: "shipped", label: "Shipped", align: "right" },
    { key: "remaining", label: "Remaining", align: "right" },
    { key: "allocated", label: "Allocated", align: "right" },
    { key: "rate", label: "Rate", align: "right" },
    { key: "amount", label: "Amount", align: "right" },
    { key: "cost", label: "Cost / unit", align: "right" },
    { key: "margin", label: "Line Margin", align: "right" },
  ],
  defaultColumns: ["soNumber", "customer", "orderDate", "status", "item", "ordered", "allocated", "amount"],
  filterFields: [
    { key: "orderDate", label: "Order Date", type: "dateRange" },
    { key: "status", label: "Status", type: "select", options: statusOptions(ORDER_STATUSES, "Open (not shipped or cancelled)") },
    { key: "customer", label: "Customer", type: "text", placeholder: "Search customer name..." },
    { key: "item", label: "Item #", type: "text", placeholder: "Search item #..." },
  ],
  async buildRows(filters): Promise<ReportRowsResult> {
    const costs = costIndex(await listItems());
    return buildOrderReport(filters, (orders) => salesOrderLineRows(orders, filters, undefined, costs));
  },
};

const purchaseOrders: ReportDataSource = {
  key: "purchase-orders",
  viewPaths: ["/purchase-orders", "/receiving"],
  label: "Purchase Orders",
  description: "One row per outbound purchase order to a vendor.",
  columns: [
    { key: "poNumber", label: "PO #", linkTo: (row) => `/purchase-orders/${row.poNumber}` },
    { key: "vendor", label: "Vendor" },
    { key: "orderDate", label: "Order Date" },
    { key: "expectedDate", label: "Expected Date" },
    { key: "status", label: "Status" },
    { key: "outstandingQty", label: "Outstanding Qty", align: "right" },
    { key: "totalCost", label: "Total Cost", align: "right" },
  ],
  defaultColumns: ["poNumber", "vendor", "orderDate", "status", "outstandingQty", "totalCost"],
  filterFields: [
    { key: "orderDate", label: "Order Date", type: "dateRange" },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: statusOptions(VENDOR_PO_STATUSES, "Open (not fully received or closed)"),
    },
    { key: "vendor", label: "Vendor", type: "text", placeholder: "Search vendor name..." },
  ],
  async buildRows(filters) {
    const pos = await listVendorPos();
    return pos
      .filter((p) => withinDateRange(p.orderDate, filters.orderDateFrom ?? "", filters.orderDateTo ?? ""))
      .filter((p) => statusMatches(filters.status, p.status, OPEN_VENDOR_PO_SET))
      .filter((p) => includesText(p.vendorName, filters.vendor ?? ""))
      .map((p) => ({
        poNumber: p.poNumber,
        vendor: p.vendorName,
        orderDate: p.orderDate,
        expectedDate: p.expectedDate ?? "",
        status: p.status,
        outstandingQty: vendorPoOutstandingTotal(p),
        totalCost: vendorPoCostTotal(p),
      }));
  },
};

const purchaseOrderLines: ReportDataSource = {
  key: "purchase-order-lines",
  viewPaths: ["/purchase-orders", "/receiving"],
  label: "Purchase Order Lines",
  description: "One row per item line across every purchase order - which POs an item is on, and how much is outstanding.",
  columns: [
    { key: "poNumber", label: "PO #", linkTo: (row) => `/purchase-orders/${row.poNumber}` },
    { key: "vendor", label: "Vendor" },
    { key: "orderDate", label: "Order Date" },
    { key: "status", label: "Status" },
    { key: "item", label: "Item" },
    { key: "description", label: "Description" },
    { key: "orderedQty", label: "Ordered", align: "right" },
    { key: "receivedQty", label: "Received", align: "right" },
    { key: "outstanding", label: "Outstanding", align: "right" },
    { key: "cost", label: "Cost", align: "right" },
  ],
  defaultColumns: ["poNumber", "vendor", "orderDate", "status", "item", "orderedQty", "outstanding"],
  filterFields: [
    { key: "orderDate", label: "Order Date", type: "dateRange" },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: statusOptions(VENDOR_PO_STATUSES, "Open (not fully received or closed)"),
    },
    { key: "vendor", label: "Vendor", type: "text", placeholder: "Search vendor name..." },
    { key: "item", label: "Item #", type: "text", placeholder: "Search item #..." },
  ],
  async buildRows(filters) {
    const pos = await listVendorPos();
    const rows: ReportRow[] = [];
    for (const p of pos) {
      if (!withinDateRange(p.orderDate, filters.orderDateFrom ?? "", filters.orderDateTo ?? "")) continue;
      if (!statusMatches(filters.status, p.status, OPEN_VENDOR_PO_SET)) continue;
      if (!includesText(p.vendorName, filters.vendor ?? "")) continue;
      for (const l of p.lines) {
        if (!includesText(l.itemNumber, filters.item ?? "")) continue;
        rows.push({
          poNumber: p.poNumber,
          vendor: p.vendorName,
          orderDate: p.orderDate,
          status: p.status,
          item: l.itemNumber,
          description: l.description,
          orderedQty: l.orderedQty,
          receivedQty: l.receivedQty,
          outstanding: vendorPoLineOutstanding(l),
          cost: l.cost,
        });
      }
    }
    return rows;
  },
};

const inventory: ReportDataSource = {
  key: "inventory",
  viewPaths: ["/inventory", "/items", "/open-orders", "/allocation"],
  label: "Inventory Stock Status",
  description: "Every catalog item with on hand, on sales order, allocated, on purchase order, and available.",
  columns: [
    { key: "item", label: "Item" },
    { key: "description", label: "Description" },
    { key: "um", label: "U/M" },
    { key: "onHand", label: "On Hand", align: "right" },
    { key: "onSalesOrder", label: "On Sales Order", align: "right" },
    { key: "allocated", label: "Allocated", align: "right" },
    { key: "onPurchaseOrder", label: "On Purchase Order", align: "right" },
    { key: "available", label: "Available", align: "right" },
    { key: "rate", label: "Rate", align: "right" },
    { key: "cost", label: "Cost", align: "right" },
    { key: "valueAtCost", label: "On Hand at Cost", align: "right" },
    { key: "marginPct", label: "Margin %", align: "right" },
  ],
  defaultColumns: ["item", "description", "onHand", "onSalesOrder", "allocated", "onPurchaseOrder", "available"],
  filterFields: [{ key: "item", label: "Item #", type: "text", placeholder: "Search item # or description..." }],
  async buildRows(filters) {
    const items = await listItems();
    // On-sales-order and allocated only count unshipped orders - a fully
    // shipped order contributes 0 to both.
    const orders = await listOpenOrders();
    return items
      .filter((i) => includesText(`${i.itemNumber} ${i.description}`, filters.item ?? ""))
      .map((i) => {
        const allocated = i.qtyReserved;
        return {
          item: i.itemNumber,
          description: i.description,
          um: i.um,
          onHand: i.qtyOnHand,
          onSalesOrder: qtyOnOpenSalesOrders(i.itemNumber, orders),
          allocated,
          onPurchaseOrder: i.qtyOnPurchaseOrder,
          available: availableQty(i, allocated),
          rate: i.rate,
          ...(typeof i.cost === "number"
            ? { cost: i.cost, valueAtCost: Math.round(i.qtyOnHand * i.cost * 100) / 100, marginPct: i.rate > 0 ? Math.round(((i.rate - i.cost) / i.rate) * 1000) / 10 : "" }
            : {}),
        };
      });
  },
};

const customers: ReportDataSource = {
  key: "customers",
  viewPaths: ["/customers/all", "/order-entry", "/customers/pricing", "/customers/routing-guide"],
  label: "Customers",
  description: "One row per customer.",
  columns: [
    { key: "name", label: "Name" },
    { key: "accountNumber", label: "Account #" },
    { key: "terms", label: "Terms" },
    { key: "shipVia", label: "Ship Via" },
    { key: "rep", label: "Rep" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
  ],
  defaultColumns: ["name", "accountNumber", "terms", "rep", "city", "state"],
  filterFields: [{ key: "name", label: "Name", type: "text", placeholder: "Search customer name..." }],
  async buildRows(filters) {
    const cs = await listCustomers();
    return cs
      .filter((c) => includesText(c.name, filters.name ?? ""))
      .map((c) => ({
        name: c.name,
        accountNumber: c.accountNumber,
        terms: c.terms,
        shipVia: c.shipVia,
        rep: c.rep,
        city: c.billTo.city,
        state: c.billTo.state,
      }));
  },
};

const vendors: ReportDataSource = {
  key: "vendors",
  viewPaths: ["/vendors", "/purchase-orders"],
  label: "Vendors",
  description: "One row per vendor.",
  columns: [
    { key: "name", label: "Name" },
    { key: "contactName", label: "Contact" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
  ],
  defaultColumns: ["name", "contactName", "phone", "email"],
  filterFields: [{ key: "name", label: "Name", type: "text", placeholder: "Search vendor name..." }],
  async buildRows(filters) {
    const vs = await listVendors();
    return vs
      .filter((v) => includesText(v.name, filters.name ?? ""))
      .map((v) => ({
        name: v.name,
        contactName: v.contactName ?? "",
        phone: v.phone ?? "",
        email: v.email ?? "",
      }));
  },
};

const returns: ReportDataSource = {
  key: "returns",
  viewPaths: ["/returns"],
  label: "Returns",
  description: "One row per Return Authorization.",
  columns: [
    { key: "raNumber", label: "RA #", linkTo: (row) => `/returns/${row.raNumber}` },
    { key: "customer", label: "Customer" },
    { key: "requestDate", label: "Request Date" },
    { key: "status", label: "Status" },
    { key: "soNumber", label: "Original S.O. #", linkTo: (row) => `/storage/${row.soNumber}` },
    { key: "totalCredit", label: "Total Credit", align: "right" },
  ],
  defaultColumns: ["raNumber", "customer", "requestDate", "status", "totalCredit"],
  filterFields: [
    { key: "requestDate", label: "Request Date", type: "dateRange" },
    { key: "status", label: "Status", type: "select", options: statusOptions(RETURN_STATUSES, "Open (issued or received, not closed)") },
    { key: "customer", label: "Customer", type: "text", placeholder: "Search customer name..." },
  ],
  async buildRows(filters) {
    const rs = await listReturns();
    return rs
      .filter((r) => withinDateRange(r.requestDate, filters.requestDateFrom ?? "", filters.requestDateTo ?? ""))
      .filter((r) => statusMatches(filters.status, r.status, OPEN_RETURN_SET))
      .filter((r) => includesText(r.billTo.name, filters.customer ?? ""))
      .map((r) => ({
        raNumber: r.raNumber,
        customer: r.billTo.name,
        requestDate: r.requestDate,
        status: r.status,
        soNumber: r.soNumber ?? "",
        totalCredit: returnTotal(r),
      }));
  },
};

export const DATA_SOURCES: ReportDataSource[] = [
  salesOrders,
  salesOrderLines,
  purchaseOrders,
  purchaseOrderLines,
  inventory,
  customers,
  vendors,
  returns,
];

export function getDataSource(key: string): ReportDataSource | undefined {
  return DATA_SOURCES.find((d) => d.key === key);
}

