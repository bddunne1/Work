import { api } from "../apiClient";

// Favorites and recently run reports, per account, kept on the server so
// they follow the person between devices. A ref is a standard report's key
// or "saved:<id>" for a memorized report.

export interface ReportPreferences {
  favorites: string[];
  recent: { ref: string; at: string }[];
}

export const savedRef = (id: string) => `saved:${id}`;

export function getReportPreferences(): Promise<ReportPreferences> {
  return api.get<ReportPreferences>("/api/reports/preferences");
}

export function setFavorite(ref: string, on: boolean): Promise<ReportPreferences> {
  return api.post<ReportPreferences>("/api/reports/preferences/favorite", { ref, on });
}

export function recordRecent(ref: string): Promise<void> {
  return api.post<void>("/api/reports/preferences/recent", { ref }).catch(() => undefined);
}
