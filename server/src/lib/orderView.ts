import { hasPermission, type AuthedAccount } from "../middleware/auth.js";
import { HttpError } from "./conflictError.js";

// Who may read orders at all, and who may see what they are worth (B-10).
//
// Every page that works an order or lists them: anyone with one of these
// can read the order list and any single order. An account with none
// (a receiving-only login, say) gets the Dashboard counts and nothing else.
export const ORDER_READ_PAGES = [
  "order-entry", "validation", "allocation", "back-orders", "labels",
  "open-orders", "closed-orders", "order-detail", "returns",
  "pick-pack", "pick-release", "open-picks", "warehouse-capacity",
  "schedule", "bol", "shipment-history", "inventory", "reports", "analytics", "invoices",
];

// Prices are for the office: Order Entry, Sales Order View, Customer
// Pricing and the invoice reviewers (decided 29 Sep). Warehouse and
// receiving logins get the order without its rates or tax rate.
export const PRICE_VIEW_PAGES = ["order-entry", "order-detail", "customer-pricing", "invoices"];

export function canSeePrices(account: AuthedAccount): boolean {
  return account.role === "ADMIN" || PRICE_VIEW_PAGES.some((key) => hasPermission(account, key, "view"));
}

export function requireOrderRead(account: AuthedAccount): void {
  if (account.role === "ADMIN" || ORDER_READ_PAGES.some((key) => hasPermission(account, key, "view"))) return;
  throw new HttpError(403, "Viewing orders needs access to one of the order pages.");
}

type Priced = { taxRate: unknown; lineItems: { rate: unknown }[] };
export type PricesHidden<T extends Priced> = Omit<T, "taxRate" | "lineItems"> & { lineItems: Omit<T["lineItems"][number], "rate">[]; pricesHidden: true };

// The order as this account may see it: unchanged for an office login, or
// with every rate and the tax rate removed and `pricesHidden` set so the
// screen shows a dash instead of a total.
export function hidePrices<T extends Priced>(order: T, account: AuthedAccount): T | PricesHidden<T> {
  if (canSeePrices(account)) return order;
  const { taxRate: _taxRate, lineItems, ...rest } = order;
  const stripped = lineItems.map((li) => {
    const { rate: _rate, ...keep } = li;
    return keep as Omit<T["lineItems"][number], "rate">;
  });
  return { ...rest, lineItems: stripped, pricesHidden: true as const };
}
