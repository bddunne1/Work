import type { Item, PurchaseOrder } from "../types";
import { pendingShipmentWeight, shipmentRecordWeight, weightIndex } from "../types";

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
}

function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function computeCapacityMetrics(
  orders: PurchaseOrder[],
  items: Item[],
  lookbackDays: number
): CapacityMetrics {
  const weights = weightIndex(items);
  const now = new Date();
  const windowStartIso = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString();

  // Current load: staged for shipment (packed, released to the floor) but
  // not yet confirmed shipped - i.e. physically sitting in the warehouse.
  const inWarehouse = orders.filter(
    (o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0
  );
  const currentLoadWeight = inWarehouse.reduce((sum, o) => sum + pendingShipmentWeight(o, weights), 0);

  const agingPicks: AgingPick[] = inWarehouse
    .filter((o): o is PurchaseOrder & { pickedAt: string } => Boolean(o.pickedAt))
    .map((o) => ({
      soNumber: o.soNumber,
      poNumber: o.poNumber,
      customer: o.billTo.name,
      pickedAt: o.pickedAt,
      daysInWarehouse: daysBetween(o.pickedAt, now.toISOString()),
      weight: pendingShipmentWeight(o, weights),
    }))
    .sort((a, b) => b.daysInWarehouse - a.daysInWarehouse);

  // Every shipment within the lookback window, paired with the dwell time
  // from release-to-floor (pickedAt) to actual ship - the throughput and
  // cycle-time samples Little's Law needs.
  const dwellSamples: number[] = [];
  const throughputByDate = new Map<string, number>();
  for (const o of orders) {
    for (const rec of o.shipmentHistory ?? []) {
      if (rec.shippedAt < windowStartIso) continue;
      const weight = shipmentRecordWeight(o, rec, weights);
      const dateKey = rec.shippedAt.slice(0, 10);
      throughputByDate.set(dateKey, (throughputByDate.get(dateKey) ?? 0) + weight);
      if (o.pickedAt && o.pickedAt < rec.shippedAt) {
        dwellSamples.push(daysBetween(o.pickedAt, rec.shippedAt));
      }
    }
  }

  const dailyThroughput: DailyThroughputPoint[] = [];
  for (let i = lookbackDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const key = isoDate(d);
    dailyThroughput.push({ date: key, weight: throughputByDate.get(key) ?? 0 });
  }

  const totalThroughputWeight = dailyThroughput.reduce((s, p) => s + p.weight, 0);
  const avgDailyThroughputWeight = lookbackDays > 0 ? totalThroughputWeight / lookbackDays : null;
  const avgDwellDays =
    dwellSamples.length > 0 ? dwellSamples.reduce((s, d) => s + d, 0) / dwellSamples.length : null;

  const estimatedCapacityWeight =
    avgDailyThroughputWeight !== null &&
    avgDwellDays !== null &&
    avgDailyThroughputWeight > 0 &&
    avgDwellDays > 0
      ? avgDailyThroughputWeight * avgDwellDays
      : null;

  const utilizationPct =
    estimatedCapacityWeight && estimatedCapacityWeight > 0
      ? (currentLoadWeight / estimatedCapacityWeight) * 100
      : null;

  return {
    lookbackDays,
    currentLoadWeight,
    currentLoadOrders: inWarehouse.length,
    avgDwellDays,
    avgDailyThroughputWeight,
    estimatedCapacityWeight,
    utilizationPct,
    dailyThroughput,
    agingPicks,
  };
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
