// Human-facing names for the page keys stored in Account.permissions, so a
// permission error can say "needs edit access to Validation" rather than
// "to validation" (open bug N-04). Mirrors PAGE_DEFS in src/lib/permissions.ts;
// moving both into one shared package is a later step of the redesign plan.
export const PAGE_LABELS: Record<string, string> = {
  "order-entry": "Order Entry",
  validation: "Validation",
  allocation: "Allocation",
  "back-orders": "Back Order Queue",
  labels: "Create Labels",
  "open-orders": "Open Orders",
  "closed-orders": "Closed Orders",
  "order-detail": "Sales Order View",
  returns: "Returns",
  "pick-pack": "Release Orders (print pick lists)",
  "pick-release": "Release Orders (release to warehouse)",
  "open-picks": "Open Picks",
  "warehouse-capacity": "Warehouse Capacity",
  schedule: "Schedule Shipments",
  bol: "Generate BOL",
  "shipment-history": "Shipment History",
  customers: "Customer List",
  "customer-pricing": "Customer Pricing",
  "routing-guide": "Routing Guide",
  catalog: "Item Catalog",
  inventory: "Inventory",
  import: "Import Data",
  analytics: "Analytics",
  reports: "Reports",
  "purchase-orders": "Purchase Orders",
  receiving: "Receiving",
  vendors: "Vendors",
  accounts: "Accounts",
  settings: "Settings",
  "audit-log": "Activity Log",
  invoices: "Invoices",
};

export function pageLabel(key: string): string {
  return PAGE_LABELS[key] ?? key;
}

export function pageLabels(keys: string[]): string {
  return keys.map(pageLabel).join(" or ");
}
