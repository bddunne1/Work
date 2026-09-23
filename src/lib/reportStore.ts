import type { ReportFilterValues, SavedReport } from "./reports/types";

const SAVED_REPORTS_KEY = "erp_saved_reports";

function readSavedReports(): SavedReport[] {
  try {
    const raw = localStorage.getItem(SAVED_REPORTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedReport[];
  } catch {
    return [];
  }
}

function writeSavedReports(reports: SavedReport[]): void {
  try {
    localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(reports));
  } catch {
    // storage unavailable (private mode, blocked site data, etc.) - no-op
  }
}

export function listSavedReports(): SavedReport[] {
  return readSavedReports().sort((a, b) => a.name.localeCompare(b.name));
}

export function getSavedReport(id: string): SavedReport | undefined {
  return readSavedReports().find((r) => r.id === id);
}

// "Memorizing" a report (QuickBooks' term) saves its data source, filters,
// and chosen columns - never the result rows themselves, so re-opening it
// always re-runs against current data.
export function memorizeReport(name: string, dataSourceKey: string, filters: ReportFilterValues, columns: string[]): SavedReport {
  const report: SavedReport = {
    id: crypto.randomUUID(),
    name,
    dataSourceKey,
    filters,
    columns,
    createdAt: new Date().toISOString(),
  };
  writeSavedReports([...readSavedReports(), report]);
  return report;
}

export function deleteSavedReport(id: string): void {
  writeSavedReports(readSavedReports().filter((r) => r.id !== id));
}
