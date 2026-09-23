import type { ReportPreset } from "./types";

// Built-in reports, named and scoped after QuickBooks' own canned reports
// (Open Sales Orders by Item, Open Purchase Orders Detail, Inventory Stock
// Status by Item) so the shape is familiar to anyone who's used QuickBooks.
export const REPORT_PRESETS: ReportPreset[] = [
  {
    key: "open-sales-orders",
    label: "Open Sales Orders",
    description: "Every sales order that hasn't shipped complete yet.",
    dataSourceKey: "sales-orders",
  },
  {
    key: "sales-order-lines-by-item",
    label: "Sales Order Lines by Item",
    description: "Every item line across every sales order, for tracing an item to its orders.",
    dataSourceKey: "sales-order-lines",
  },
  {
    key: "open-purchase-orders",
    label: "Open Purchase Orders",
    description: "Every outbound purchase order that isn't fully received or closed.",
    dataSourceKey: "purchase-orders",
    defaultFilters: {},
  },
  {
    key: "purchase-order-lines-by-item",
    label: "Purchase Order Lines by Item",
    description: "Every item line across every purchase order, for tracing an item to its POs.",
    dataSourceKey: "purchase-order-lines",
  },
  {
    key: "inventory-stock-status",
    label: "Inventory Stock Status",
    description: "On hand, on sales order, allocated, on purchase order, and available for every item.",
    dataSourceKey: "inventory",
  },
  {
    key: "open-returns",
    label: "Open Returns",
    description: "Return Authorizations that haven't been closed out yet.",
    dataSourceKey: "returns",
  },
];

export function getPreset(key: string): ReportPreset | undefined {
  return REPORT_PRESETS.find((p) => p.key === key);
}
