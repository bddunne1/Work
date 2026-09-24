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

  // Pick & Pack is split in two: the list page (print released pick lists
  // and packing slips) and the per-order review that releases a pick to the
  // floor (/pick-pack/<S.O. #>) - so order entry can print picks without
  // being able to release them.
  { key: "pick-pack", label: "Pick & Pack (print picks)", group: "Fulfillment", rules: simplePage("/pick-pack") },
  { key: "pick-release", label: "Release Picks", group: "Fulfillment", rules: simplePage("/pick-pack/") },
  { key: "open-picks", label: "Open Picks", group: "Fulfillment", rules: simplePage("/open-picks") },
  {
    key: "warehouse-capacity",
    label: "Warehouse Capacity",
    group: "Fulfillment",
    rules: simplePage("/warehouse-capacity"),
  },

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
  { key: "reports", label: "Reports", group: "Data", rules: simplePage("/reports") },

  {
    key: "purchase-orders",
    label: "Purchase Orders",
    group: "Purchasing",
    rules: pageWithEditGatedSubpaths("/purchase-orders", ["/purchase-orders/new"]),
  },
  { key: "receiving", label: "Receiving", group: "Purchasing", rules: simplePage("/receiving") },
  { key: "vendors", label: "Vendors", group: "Purchasing", rules: simplePage("/vendors") },

  { key: "accounts", label: "Accounts", group: "Administration", rules: simplePage("/accounts") },
  { key: "settings", label: "Settings", group: "Administration", rules: simplePage("/settings") },
  { key: "audit-log", label: "Activity Log", group: "Administration", rules: simplePage("/audit-log") },
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

// Role presets - a starting point for each job; every page stays editable
// per account afterwards. Matches the server's per-endpoint checks (see
// server/src/routes/*.ts): each preset can complete its own workflow.
export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    key: "purchasing",
    label: "Purchasing",
    description:
      "Everything coming into the building: vendor POs, receiving shipments and returned goods, vendors, stock counts and the item catalog.",
    permissions: {
      "purchase-orders": "edit",
      receiving: "edit",
      vendors: "edit",
      inventory: "edit",
      catalog: "edit",
      returns: "view",
      import: "edit",
      "back-orders": "view",
      "open-orders": "view",
      "order-detail": "view",
      "warehouse-capacity": "view",
      reports: "view",
      analytics: "view",
    },
  },
  {
    key: "customer-service",
    label: "Customer Service",
    description:
      "Take orders, answer order-status calls, quote pricing and availability, issue returns and cancel orders at the customer's request.",
    permissions: {
      "order-entry": "edit",
      "open-orders": "view",
      "closed-orders": "view",
      "order-detail": "edit",
      "back-orders": "view",
      schedule: "view",
      "shipment-history": "view",
      customers: "edit",
      "customer-pricing": "view",
      "routing-guide": "view",
      catalog: "view",
      inventory: "view",
      returns: "edit",
      reports: "view",
    },
  },
  {
    key: "order-entry",
    label: "Order Entry",
    description:
      "Key in customer purchase orders and print pick lists / packing slips for picks that have been released. Cannot validate or release.",
    permissions: {
      "order-entry": "edit",
      import: "edit",
      "pick-pack": "edit",
      "open-orders": "view",
      "order-detail": "view",
      customers: "view",
      catalog: "view",
      inventory: "view",
    },
  },
  {
    key: "analyst",
    label: "Analyst",
    description:
      "Validate and allocate orders, work the back order queue, release picks, and coordinate stock and ship dates with purchasing and logistics.",
    permissions: {
      validation: "edit",
      allocation: "edit",
      "back-orders": "edit",
      "pick-release": "edit",
      "pick-pack": "view",
      schedule: "edit",
      "open-orders": "view",
      "closed-orders": "view",
      "order-detail": "edit",
      "shipment-history": "view",
      "warehouse-capacity": "view",
      inventory: "view",
      catalog: "view",
      customers: "view",
      "purchase-orders": "view",
      receiving: "view",
      reports: "edit",
      analytics: "view",
    },
  },
  {
    key: "logistics",
    label: "Logistics",
    description:
      "Schedule pickups with truck lines, generate BOLs and labels, confirm what shipped, and report the day's shipments.",
    permissions: {
      schedule: "edit",
      bol: "edit",
      "open-picks": "edit",
      "shipment-history": "edit",
      labels: "edit",
      "routing-guide": "view",
      "warehouse-capacity": "view",
      "pick-pack": "view",
      "open-orders": "view",
      "order-detail": "view",
      "back-orders": "view",
      customers: "view",
      inventory: "view",
      reports: "view",
    },
  },
  {
    key: "sales-manager",
    label: "Sales Manager",
    description:
      "Win and manage accounts: add new customers, maintain customer records, pricing and routing guides, and follow their orders and analytics.",
    permissions: {
      customers: "edit",
      "customer-pricing": "edit",
      "routing-guide": "edit",
      "open-orders": "view",
      "closed-orders": "view",
      "order-detail": "view",
      "back-orders": "view",
      "shipment-history": "view",
      schedule: "view",
      catalog: "view",
      inventory: "view",
      analytics: "edit",
      reports: "edit",
    },
  },
  {
    key: "director",
    label: "Director",
    description:
      "Every page at full access. For account management too (Accounts page), give the account the Admin role instead.",
    permissions: Object.fromEntries(
      [
        "order-entry", "validation", "allocation", "back-orders", "labels", "open-orders", "closed-orders",
        "order-detail", "returns", "pick-pack", "pick-release", "open-picks", "warehouse-capacity", "schedule",
        "bol", "shipment-history", "customers", "customer-pricing", "routing-guide", "catalog", "inventory",
        "import", "analytics", "reports", "purchase-orders", "receiving", "vendors", "settings", "audit-log",
      ].map((k) => [k, "edit" as AccessLevel])
    ),
  },
];
