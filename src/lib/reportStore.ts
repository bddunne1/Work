import { api, ApiError, getToken } from "./apiClient";
import { tzOffset } from "./reports/engineClient";
import type { ReportResult, ReportSpec } from "./reports/spec";

// Memorized reports (QuickBooks' term): a spec saved under a name - never
// the result rows, so re-opening one always re-runs against current data.
// Groups print and are scheduled together; schedules mail a group.

export interface SavedReport {
  id: string;
  name: string;
  spec: ReportSpec;
  shared: boolean;
  groupName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  mine: boolean;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export function listSavedReports(): Promise<SavedReport[]> {
  return api.get<SavedReport[]>("/api/saved-reports");
}

export async function getSavedReport(id: string): Promise<SavedReport | undefined> {
  return (await listSavedReports()).find((r) => r.id === id);
}

export function memorizeReport(input: { name: string; spec: ReportSpec; shared: boolean; groupName?: string | null }): Promise<SavedReport> {
  return api.post<SavedReport>("/api/saved-reports", input);
}

export function updateSavedReport(id: string, patch: Partial<Pick<SavedReport, "name" | "spec" | "shared" | "groupName">>): Promise<SavedReport> {
  return api.put<SavedReport>(`/api/saved-reports/${id}`, patch);
}

export async function deleteSavedReport(id: string): Promise<void> {
  await api.del(`/api/saved-reports/${id}`);
}

export function listReportGroups(): Promise<string[]> {
  return api.get<string[]>("/api/saved-reports/groups");
}

export interface GroupRun {
  group: string;
  company?: string;
  generatedAt: string;
  reports: { id: string; name: string; spec: ReportSpec; result: ReportResult | null; error?: string }[];
}

export function runReportGroup(name: string): Promise<GroupRun> {
  return api.post<GroupRun>(`/api/reports/groups/${encodeURIComponent(name)}/run`, { tzOffset: tzOffset() });
}

// ---- export: the server renders the file --------------------------------

export type ExportFormat = "csv" | "xlsx" | "pdf";

export async function exportReport(spec: ReportSpec, format: ExportFormat, title: string): Promise<void> {
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  const res = await fetch(`${base}/api/reports/export`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${getToken() ?? ""}` },
    body: JSON.stringify({ spec, format, title, tzOffset: tzOffset() }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? `Export failed (${res.status})`, "POST", body as Record<string, unknown>);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `report.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- schedules ------------------------------------------------------------

export interface ReportSchedule {
  id: string;
  groupName: string;
  cron: string;
  format: ExportFormat;
  recipients: string[];
  active: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  createdBy: string | null;
}

export type ScheduleInput = Pick<ReportSchedule, "groupName" | "cron" | "format" | "recipients" | "active">;

export const listSchedules = () => api.get<ReportSchedule[]>("/api/reports/schedules");
export const createSchedule = (input: ScheduleInput) => api.post<ReportSchedule>("/api/reports/schedules", input);
export const updateSchedule = (id: string, patch: Partial<ScheduleInput>) => api.put<ReportSchedule>(`/api/reports/schedules/${id}`, patch);
export const deleteSchedule = (id: string) => api.del(`/api/reports/schedules/${id}`);
export const runScheduleNow = (id: string) => api.post<{ sent: boolean; detail: string; reports: number }>(`/api/reports/schedules/${id}/run`);
