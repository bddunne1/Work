import type { ReportSpec } from "./spec";

// Rows of the one browser-built report left - the Item Quick Report
// (itemStore.getItemQuickReport); every other report runs on the engine.
export type ReportCellValue = string | number;
export type ReportRow = Record<string, ReportCellValue>;

export interface SavedReport {
  id: string;
  name: string;
  // The previous Reports page saved these three; the server translates
  // them into `spec` until the phase 5 migration writes it into the row.
  dataSourceKey: string;
  filters: Record<string, string>;
  columns: string[];
  spec: ReportSpec;
  createdAt: string;
}
