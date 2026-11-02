import { api } from "../apiClient";
import type { ReportResult, ReportSource, ReportSourceInfo, ReportSpec } from "./spec";

// The browser's side of the report engine (server/src/lib/reports): every
// report runs on the server from a spec; nothing is totaled here.

export type ReportArea = "Sales" | "Orders" | "Purchasing" | "Inventory" | "Accounting" | "Lists";
export const REPORT_AREAS: ReportArea[] = ["Sales", "Orders", "Purchasing", "Inventory", "Accounting", "Lists"];

export interface StandardReport {
  key: string;
  name: string;
  area: ReportArea;
  description: string;
  defaultPreset: ReportSpec["dateRange"]["preset"];
  spec: ReportSpec;
}

// Minutes the browser's clock is behind UTC (300 for Chicago in summer): the
// server resolves "Today", "This Month" and the day buckets on this day.
export const tzOffset = () => new Date().getTimezoneOffset();

export interface RunOptions {
  page?: number;
  pageSize?: number;
}

export function runReport(spec: ReportSpec, opts: RunOptions = {}): Promise<ReportResult> {
  return api.post<ReportResult>("/api/reports/run", { spec, tzOffset: tzOffset(), page: opts.page ?? 1, pageSize: opts.pageSize ?? 200 });
}

export function listCatalog(): Promise<StandardReport[]> {
  return api.get<StandardReport[]>("/api/reports/catalog");
}

let sourcesPromise: Promise<ReportSourceInfo[]> | null = null;
export function listSources(): Promise<ReportSourceInfo[]> {
  sourcesPromise ??= api.get<ReportSourceInfo[]>(`/api/reports/sources?tzOffset=${tzOffset()}`).catch((err) => {
    sourcesPromise = null;
    throw err;
  });
  return sourcesPromise;
}

export async function sourceInfo(key: ReportSource): Promise<ReportSourceInfo | undefined> {
  return (await listSources()).find((s) => s.key === key);
}
