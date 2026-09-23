// Maps a route to the color of the functional area it belongs in - the same
// groupings/colors the Dashboard's lanes already use - so every page picks
// up a consistent color identity (page title accent, table header tint)
// without each page having to set it itself.
interface AccentRule {
  prefix: string;
  color: string;
}

const RULES: AccentRule[] = [
  // Data
  { prefix: "/customers", color: "#f59f00" },
  { prefix: "/items", color: "#f59f00" },
  { prefix: "/inventory", color: "#f59f00" },
  { prefix: "/import", color: "#f59f00" },
  { prefix: "/analytics", color: "#f59f00" },
  { prefix: "/reports", color: "#f59f00" },
  // Order Prep
  { prefix: "/order-entry", color: "#12b886" },
  { prefix: "/validation", color: "#12b886" },
  { prefix: "/allocation", color: "#12b886" },
  { prefix: "/back-orders", color: "#12b886" },
  { prefix: "/labels", color: "#12b886" },
  { prefix: "/returns", color: "#12b886" },
  // Orders
  { prefix: "/open-orders", color: "#4c6ef5" },
  { prefix: "/closed-orders", color: "#4c6ef5" },
  { prefix: "/storage", color: "#4c6ef5" },
  // Fulfillment
  { prefix: "/pick-pack", color: "#7c6ff2" },
  { prefix: "/open-picks", color: "#7c6ff2" },
  { prefix: "/warehouse-capacity", color: "#7c6ff2" },
  // Logistics
  { prefix: "/schedule", color: "#f06595" },
  { prefix: "/bol", color: "#f06595" },
  { prefix: "/shipment-history", color: "#f06595" },
  // Purchasing
  { prefix: "/purchase-orders", color: "#0ca678" },
  { prefix: "/receiving", color: "#0ca678" },
  { prefix: "/vendors", color: "#0ca678" },
  // Administration
  { prefix: "/accounts", color: "#495057" },
  { prefix: "/settings", color: "#495057" },
  { prefix: "/audit-log", color: "#495057" },
];

const SORTED = [...RULES].sort((a, b) => b.prefix.length - a.prefix.length);

export function getPageAccent(pathname: string): string | undefined {
  return SORTED.find((r) => pathname.startsWith(r.prefix))?.color;
}
