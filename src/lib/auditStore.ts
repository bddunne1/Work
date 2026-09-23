import { api } from "./apiClient";

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorUsername: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  detail: unknown;
  createdAt: string;
}

export async function listAuditLog(limit = 200): Promise<AuditLogEntry[]> {
  return api.get<AuditLogEntry[]>(`/api/audit-log?limit=${limit}`);
}
