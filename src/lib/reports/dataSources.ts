import { listCustomers } from "../customerStore";
import { getItemByNumber, listItems } from "../itemStore";
import { listOrders } from "../orderStore";
import { listReturns } from "../returnStore";
import { listVendorPos } from "../vendorPoStore";
import { listVendors } from "../vendorStore";
import type { OrderStatus, PurchaseOrder, ReturnStatus, VendorPoStatus } from "../../types";
import {
  allocatedQtyFor,
  availableQty,
  lineAmount,
  orderTotal,
  qtyAllocatedOnOrders,
  qtyOnOpenSalesOrders,
  remainingToShip,
  returnTotal,
  shippedQtyFor,
  vendorPoCostTotal,
  vendorPoLineOutstanding,
  vendorPoOutstandingTotal,
} from "../../types";
import type { ReportDataSource, ReportFilterValues, ReportRow } from "./types";

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

const salesOrders: ReportDataSource = {
  key: "sales-orders",
  label: "Sales Orders",
  description: "One row per sales order.",
  columns: [
    { key: "soNumber", label: "S.O. #" },
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
    { key: "status", label: "Status", type: "select", options: ORDER_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: "customer", label: "Customer", type: "text", placeholder: "Search customer name..." },
  ],
  async buildRows(filters) {
    const orders = listOrders();
    return orders
      .filter((o) => withinDateRange(o.orderDate, filters.orderDateFrom ?? "", filters.orderDateTo ?? ""))
      .filter((o) => !filters.status || o.status === filters.status)
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
      }));
  },
};

function salesOrderLineRows(orders: PurchaseOrder[], filters: ReportFilterValues): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const o of orders) {
    if (!withinDateRange(o.orderDate, filters.orderDateFrom ?? "", filters.orderDateTo ?? "")) continue;
    if (filters.status && o.status !== filters.status) continue;
    if (!includesText(o.billTo.name, filters.customer ?? "")) continue;
    for (const li of o.lineItems) {
      if (!includesText(li.item, filters.item ?? "")) continue;
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
      });
    }
  }
  return rows;
}

const salesOrderLines: ReportDataSource = {
  key: "sales-order-lines",
  label: "Sales Order Lines",
  description: "One row per item line across every sales order - which orders an item is on, and how much of it.",
  columns: [
    { key: "soNumber", label: "S.O. #" },
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
  ],
  defaultColumns: ["soNumber", "customer", "orderDate", "status", "item", "ordered", "allocated", "amount"],
  filterFields: [
    { key: "orderDate", label: "Order Date", type: "dateRange" },
    { key: "status", label: "Status", type: "select", options: ORDER_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: "customer", label: "Customer", type: "text", placeholder: "Search customer name..." },
    { key: "item", label: "Item #", type: "text", placeholder: "Search item #..." },
  ],
  async buildRows(filters) {
    return salesOrderLineRows(listOrders(), filters);
  },
};

const purchaseOrders: ReportDataSource = {
  key: "purchase-orders",
  label: "Purchase Orders",
  description: "One row per outbound purchase order to a vendor.",
  columns: [
    { key: "poNumber", label: "PO #" },
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
      options: VENDOR_PO_STATUSES.map((s) => ({ value: s, label: s })),
    },
    { key: "vendor", label: "Vendor", type: "text", placeholder: "Search vendor name..." },
  ],
  async buildRows(filters) {
    const pos = await listVendorPos();
    return pos
      .filter((p) => withinDateRange(p.orderDate, filters.orderDateFrom ?? "", filters.orderDateTo ?? ""))
      .filter((p) => !filters.status || p.status === filters.status)
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
  label: "Purchase Order Lines",
  description: "One row per item line across every purchase order - which POs an item is on, and how much is outstanding.",
  columns: [
    { key: "poNumber", label: "PO #" },
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
      options: VENDOR_PO_STATUSES.map((s) => ({ value: s, label: s })),
    },
    { key: "vendor", label: "Vendor", type: "text", placeholder: "Search vendor name..." },
    { key: "item", label: "Item #", type: "text", placeholder: "Search item #..." },
  ],
  async buildRows(filters) {
    const pos = await listVendorPos();
    const rows: ReportRow[] = [];
    for (const p of pos) {
      if (!withinDateRange(p.orderDate, filters.orderDateFrom ?? "", filters.orderDateTo ?? "")) continue;
      if (filters.status && p.status !== filters.status) continue;
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
  ],
  defaultColumns: ["item", "description", "onHand", "onSalesOrder", "allocated", "onPurchaseOrder", "available"],
  filterFields: [{ key: "item", label: "Item #", type: "text", placeholder: "Search item # or description..." }],
  async buildRows(filters) {
    const items = await listItems();
    const orders = listOrders();
    return items
      .filter((i) => includesText(`${i.itemNumber} ${i.description}`, filters.item ?? ""))
      .map((i) => {
        const allocated = qtyAllocatedOnOrders(i.itemNumber, orders);
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
        };
      });
  },
};

const customers: ReportDataSource = {
  key: "customers",
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
  label: "Returns",
  description: "One row per Return Authorization.",
  columns: [
    { key: "raNumber", label: "RA #" },
    { key: "customer", label: "Customer" },
    { key: "requestDate", label: "Request Date" },
    { key: "status", label: "Status" },
    { key: "soNumber", label: "Original S.O. #" },
    { key: "totalCredit", label: "Total Credit", align: "right" },
  ],
  defaultColumns: ["raNumber", "customer", "requestDate", "status", "totalCredit"],
  filterFields: [
    { key: "requestDate", label: "Request Date", type: "dateRange" },
    { key: "status", label: "Status", type: "select", options: RETURN_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: "customer", label: "Customer", type: "text", placeholder: "Search customer name..." },
  ],
  async buildRows(filters) {
    const rs = listReturns();
    return rs
      .filter((r) => withinDateRange(r.requestDate, filters.requestDateFrom ?? "", filters.requestDateTo ?? ""))
      .filter((r) => !filters.status || r.status === filters.status)
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

// The Item Quick Report (see ItemQuickReport.tsx) reuses the sales-order-line
// and purchase-order-line builders directly, scoped to one item number,
// rather than going through the generic filter UI.
export async function itemQuickReportData(itemNumber: string) {
  const orders = listOrders();
  const pos = await listVendorPos();
  const catalogItem = await getItemByNumber(itemNumber);
  const allocated = qtyAllocatedOnOrders(itemNumber, orders);

  const soLines = salesOrderLineRows(orders, { item: itemNumber });
  const poLines: ReportRow[] = [];
  for (const p of pos) {
    for (const l of p.lines) {
      if (l.itemNumber.trim().toLowerCase() !== itemNumber.trim().toLowerCase()) continue;
      poLines.push({
        poNumber: p.poNumber,
        vendor: p.vendorName,
        orderDate: p.orderDate,
        status: p.status,
        orderedQty: l.orderedQty,
        receivedQty: l.receivedQty,
        outstanding: vendorPoLineOutstanding(l),
        cost: l.cost,
      });
    }
  }

  return {
    item: catalogItem,
    summary: catalogItem
      ? {
          onHand: catalogItem.qtyOnHand,
          onSalesOrder: qtyOnOpenSalesOrders(itemNumber, orders),
          allocated,
          onPurchaseOrder: catalogItem.qtyOnPurchaseOrder,
          available: availableQty(catalogItem, allocated),
        }
      : null,
    soLines,
    poLines,
  };
}
