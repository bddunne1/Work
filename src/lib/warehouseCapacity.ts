import { api } from "./apiClient";

export interface DailyThroughputPoint {
  date: string;
  weight: number;
}

export interface AgingPick {
  soNumber: string;
  poNumber: string;
  customer: string;
  pickedAt: string;
  daysInWarehouse: number;
  weight: number;
}

export interface CapacityMetrics {
  lookbackDays: number;
  currentLoadWeight: number;
  currentLoadOrders: number;
  // Little's Law inputs/output: avg WIP = throughput rate x avg time in
  // system. Here that's "how much weight can comfortably sit in the
  // warehouse pipeline at once, given how fast it actually ships and how
  // long it typically dwells" - a number derived from real history rather
  // than a guess.
  avgDwellDays: number | null;
  avgDailyThroughputWeight: number | null;
  estimatedCapacityWeight: number | null;
  utilizationPct: number | null;
  dailyThroughput: DailyThroughputPoint[];
  agingPicks: AgingPick[];
  // Catalog items with no weight - their picks count as 0 lb.
  itemsMissingWeight: number;
}

// Computed on the server from the staged picks and the window's shipments
// (GET /api/analytics/capacity, D-02); days are the browser's local days.
export async function getCapacityMetrics(lookbackDays: number): Promise<CapacityMetrics> {
  const qs = new URLSearchParams({ days: String(lookbackDays), tzOffset: String(new Date().getTimezoneOffset()) });
  return api.get<CapacityMetrics>(`/api/analytics/capacity?${qs.toString()}`);
}

export type UtilizationLevel = "unknown" | "low" | "healthy" | "near" | "over";

export function utilizationLevel(pct: number | null): UtilizationLevel {
  if (pct === null) return "unknown";
  if (pct < 50) return "low";
  if (pct < 85) return "healthy";
  if (pct <= 100) return "near";
  return "over";
}

export const UTILIZATION_MESSAGES: Record<UtilizationLevel, string> = {
  unknown: "Not enough ship history yet to estimate capacity - ship a few more orders (with item weights set) to see a recommendation.",
  low: "Well under capacity - safe to release more picks to the warehouse.",
  healthy: "Comfortably within capacity - fine to keep releasing picks at the normal pace.",
  near: "Near estimated capacity - release more picks cautiously.",
  over: "Over estimated capacity - hold new releases until the floor clears.",
};
