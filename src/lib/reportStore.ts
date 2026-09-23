import { api } from "./apiClient";
import type { SavedReport } from "./reports/types";

export async function listSavedReports(): Promise<SavedReport[]> {
  return api.get<SavedReport[]>("/api/saved-reports");
}

export async function getSavedReport(id: string): Promise<SavedReport | undefined> {
  const reports = await listSavedReports();
  return reports.find((r) => r.id === id);
}

// "Memorizing" a report (QuickBooks' term) saves its data source, filters,
// and chosen columns - never the result rows themselves, so re-opening it
// always re-runs against current data.
export async function memorizeReport(
  name: string,
  dataSourceKey: string,
  filters: Record<string, string>,
  columns: string[]
): Promise<SavedReport> {
  return api.post<SavedReport>("/api/saved-reports", { name, dataSourceKey, filters, columns });
}

export async function deleteSavedReport(id: string): Promise<void> {
  await api.del(`/api/saved-reports/${id}`);
}
