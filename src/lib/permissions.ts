import type { Account } from "./authStore";

export type AccessLevel = "edit" | "view" | "none";

interface RouteRule {
  prefix: string;
  access: AccessLevel;
}

export interface PageDef {
  key: string;
  label: string;
  group: string;
  // Expands a chosen access level for this page into the underlying route
  // rules. Most pages are a flat 1:1 mapping; a few have create/edit
  // sub-paths that must stay "none" unless the page itself is "edit".
  rules: (access: AccessLevel) => RouteRule[];
}

function simplePage(prefix: string): (access: AccessLevel) => RouteRule[] {
  return (access) => [{ prefix, access }];
}

function pageWithEditGatedSubpaths(
  basePrefix: string,
  subPrefixes: string[]
): (access: AccessLevel) => RouteRule[] {
  return (access) => [
    ...subPrefixes.map((prefix) => ({ prefix, access: access === "edit" ? ("edit" as AccessLevel) : ("none" as AccessLevel) })),
    { prefix: basePrefix, access },
  ];
}

// Every accessible page in the app, grouped roughly the way the Dashboard
// groups its module cards. `key` is what's stored in an account's
// `permissions` map (see authStore.ts).
export const PAGE_DEFS: PageDef[] = [
  { key: "order-entry", label: "Order Entry", group: "Order Prep", rules: simplePage("/order-entry") },
  { key: "validation", label: "Validation", group: "Order Prep", rules: simplePage("/validation") },
  { key: "allocation", label: "Allocation", group: "Order Prep", rules: simplePage("/allocation") },
  { key: "back-orders", label: "Back Order Queue", group: "Order Prep", rules: simplePage("/back-orders") },
  { key: "labels", label: "Create Labels", group: "Order Prep", rules: simplePage("/labels") },

  { key: "open-orders", label: "Open Orders", group: "Orders", rules: simplePage("/open-orders") },
  { key: "closed-orders", label: "Closed Orders", group: "Orders", rules: simplePage("/closed-orders") },
  { key: "order-detail", label: "Sales Order View", group: "Orders", rules: simplePage("/storage") },

  {
    key: "returns",
    label: "Returns",
    group: "Orders",
    rules: pageWithEditGatedSubpaths("/returns", ["/returns/new"]),
  },

  { key: "pick-pack", label: "Pick & Pack", group: "Fulfillment", rules: simplePage("/pick-pack") },
  { key: "open-picks", label: "Open Picks", group: "Fulfillment", rules: simplePage("/open-picks") },

  { key: "schedule", label: "Schedule Shipments", group: "Logistics", rules: simplePage("/schedule") },
  { key: "bol", label: "Generate BOL", group: "Logistics", rules: simplePage("/bol") },
  {
    key: "shipment-history",
    label: "Shipment History",
    group: "Logistics",
    rules: simplePage("/shipment-history"),
  },

  {
    key: "customers",
    label: "Customer List",
    group: "Data",
    rules: pageWithEditGatedSubpaths("/customers/all", ["/customers/new"]),
  },
  { key: "customer-pricing", label: "Customer Pricing", group: "Data", rules: simplePage("/customers/pricing") },
  { key: "routing-guide", label: "Routing Guide", group: "Data", rules: simplePage("/customers/routing-guide") },
  {
    key: "catalog",
    label: "Item Catalog",
    group: "Data",
    rules: pageWithEditGatedSubpaths("/items", ["/items/new"]),
  },
  {
    key: "inventory",
    label: "Inventory",
    group: "Data",
    rules: pageWithEditGatedSubpaths("/inventory", ["/inventory/adjust"]),
  },
  { key: "import", label: "Import Data", group: "Data", rules: simplePage("/import") },
  { key: "analytics", label: "Analytics", group: "Data", rules: simplePage("/analytics") },

  {
    key: "purchase-orders",
    label: "Purchase Orders",
    group: "Purchasing",
    rules: pageWithEditGatedSubpaths("/purchase-orders", ["/purchase-orders/new"]),
  },
  { key: "receiving", label: "Receiving", group: "Purchasing", rules: simplePage("/receiving") },
  { key: "vendors", label: "Vendors", group: "Purchasing", rules: simplePage("/vendors") },

  { key: "accounts", label: "Accounts", group: "Administration", rules: simplePage("/accounts") },
];

// Routes always reachable once logged in, regardless of an account's
// per-page permissions - hub/index pages that only ever link onward to
// pages which are themselves gated.
const ALWAYS_VIEW_EXACT = new Set(["/", "/login", "/customers"]);

function buildRules(permissions: Record<string, AccessLevel>): RouteRule[] {
  const rules: RouteRule[] = [];
  for (const def of PAGE_DEFS) {
    rules.push(...def.rules(permissions[def.key] ?? "none"));
  }
  // Longer prefixes are always the more specific ones in this route table
  // (e.g. "/inventory/adjust" vs "/inventory"), so sorting by length gives
  // "most specific first" without having to hand-order the list.
  return rules.sort((a, b) => b.prefix.length - a.prefix.length);
}

export function getAccessLevel(pathname: string, account: Account): AccessLevel {
  if (account.role === "admin") return "edit";
  if (ALWAYS_VIEW_EXACT.has(pathname)) return "view";
  const rules = buildRules(account.permissions ?? {});
  const rule = rules.find((r) => pathname.startsWith(r.prefix));
  return rule?.access ?? "none";
}

export function canView(pathname: string, account: Account): boolean {
  return getAccessLevel(pathname, account) !== "none";
}

export function canEdit(pathname: string, account: Account): boolean {
  return getAccessLevel(pathname, account) === "edit";
}

export interface PermissionPreset {
  key: string;
  label: string;
  description: string;
  permissions: Record<string, AccessLevel>;
}

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    key: "order-entry",
    label: "Order Entry",
    description:
      "Enter and pick/pack orders, generate BOLs, with view-only access to customers, catalog, inventory, and schedule.",
    permissions: {
      "order-entry": "edit",
      "pick-pack": "edit",
      bol: "edit",
      customers: "view",
      catalog: "view",
      inventory: "view",
      schedule: "view",
      "order-detail": "view",
      "open-orders": "view",
      "closed-orders": "view",
      analytics: "view",
    },
  },
  {
    key: "warehouse",
    label: "Warehouse / Fulfillment",
    description:
      "Pick, pack, ship, and schedule - the physical fulfillment side of the building, no order entry or customer edits.",
    permissions: {
      "pick-pack": "edit",
      "open-picks": "edit",
      schedule: "edit",
      bol: "edit",
      labels: "edit",
      "shipment-history": "view",
      "back-orders": "view",
      inventory: "view",
      catalog: "view",
      "order-detail": "view",
      analytics: "view",
    },
  },
  {
    key: "customer-service",
    label: "Customer Service",
    description: "Manage customers and enter orders, with view access to check status on anything already entered.",
    permissions: {
      customers: "edit",
      "customer-pricing": "view",
      "routing-guide": "edit",
      "order-entry": "edit",
      "order-detail": "view",
      "open-orders": "view",
      "closed-orders": "view",
      schedule: "view",
      catalog: "view",
      analytics: "view",
    },
  },
  {
    key: "purchasing",
    label: "Purchasing / Inventory",
    description: "Manage stock, vendors, and outbound purchase orders, and receive against them.",
    permissions: {
      inventory: "edit",
      catalog: "edit",
      "purchase-orders": "edit",
      receiving: "edit",
      vendors: "edit",
      import: "edit",
      "order-detail": "view",
      analytics: "view",
    },
  },
  {
    key: "sales-manager",
    label: "Sales Manager",
    description: "Oversight across sales, customers, and pricing, with read access to the fulfillment pipeline.",
    permissions: {
      customers: "edit",
      "customer-pricing": "edit",
      "routing-guide": "edit",
      "order-detail": "view",
      "open-orders": "view",
      "closed-orders": "view",
      "back-orders": "view",
      schedule: "view",
      catalog: "view",
      analytics: "edit",
    },
  },
];
