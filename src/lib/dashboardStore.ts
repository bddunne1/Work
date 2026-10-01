import { api } from "./apiClient";

// The Dashboard's counts, from GET /api/dashboard/summary: how many orders
// wait in each queue (and how many of those are late), and today's totals.
// Computed on the server so a login that may not read the order list, or
// its prices, still sees the state of the day (B-10).
export interface QueueSummary {
  count: number;
  late: number;
  // When the oldest order entered this queue, if known.
  oldest: string | null;
}

export interface DashboardSummary {
  today: string;
  queues: Record<"validate" | "allocate" | "backorder" | "release" | "print" | "ship" | "pull", QueueSummary>;
  todayStats: {
    due: number;
    late: number;
    shippedOrders: number;
    shippedUnits: number;
    shippedWeight: number;
    floor: number;
    floorWeight: number;
  };
}

// `today` and `midnight` are the browser's local day, so "ship by today"
// and "shipped today" follow the person's clock.
export function dashboardSummary(today: string, midnight: Date): Promise<DashboardSummary> {
  const qs = new URLSearchParams({ today, midnight: midnight.toISOString() });
  return api.get(`/api/dashboard/summary?${qs.toString()}`);
}
