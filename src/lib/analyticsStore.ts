import { api } from "./apiClient";

// Server-computed Analytics page figures (GET /api/analytics/...) - the
// totals used to be worked out in the browser from every order, customer
// and item, which meant downloading the entire order history.

export interface MonthlyRevenuePoint {
  month: string; // YYYY-MM
  revenue: number;
}

export interface AnalyticsSummary {
  sales: { totalOrders: number; totalRevenue: number; openOrders: number; ordersThisMonth: number };
  // App-facing status name -> order count (statuses with no orders omitted).
  ordersByStatus: Record<string, number>;
  monthlyRevenue: MonthlyRevenuePoint[];
  topCustomers: { customerId: string; name: string; revenue: number }[];
  inventory: { totalItems: number; totalOnHand: number; totalOnPO: number; outOfStock: number; totalValue: number };
  topInventoryValue: { itemNumber: string; description: string; value: number }[];
  outOfStockItems: { id: string; itemNumber: string; description: string; qtyOnPurchaseOrder: number }[];
}

export interface CustomerAnalytics {
  totalOrders: number;
  lifetimeRevenue: number;
  avgOrderValue: number;
  lastOrderDate: string | null;
  itemsPurchased: { item: string; qty: number; revenue: number }[];
  monthlyRevenue: MonthlyRevenuePoint[];
}

// `endMonth` ends the monthly-revenue window (YYYY-MM, `months` long);
// `thisMonth` is the month "Orders This Month" counts. Both default to the
// server's current UTC month.
export interface AnalyticsWindow {
  endMonth?: string;
  thisMonth?: string;
  months?: number;
}

function windowQuery(w: AnalyticsWindow): string {
  const qs = new URLSearchParams();
  if (w.endMonth) qs.set("endMonth", w.endMonth);
  if (w.thisMonth) qs.set("thisMonth", w.thisMonth);
  if (w.months) qs.set("months", String(w.months));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export async function getAnalyticsSummary(w: AnalyticsWindow = {}): Promise<AnalyticsSummary> {
  return api.get<AnalyticsSummary>(`/api/analytics/summary${windowQuery(w)}`);
}

export async function getCustomerAnalytics(customerId: string, w: AnalyticsWindow = {}): Promise<CustomerAnalytics> {
  return api.get<CustomerAnalytics>(`/api/analytics/customer/${encodeURIComponent(customerId)}${windowQuery(w)}`);
}
