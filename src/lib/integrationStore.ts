import { api } from "./apiClient";

// Settings > QuickBooks: connection state and the sync queue.

export interface QuickBooksStatus {
  configured: boolean;
  fake: boolean;
  environment: "sandbox" | "production";
  connected: boolean;
  realmId: string | null;
  connectedBy: string | null;
  connectedAt: string | null;
  refreshExpiresAt: string | null;
  tokensEncrypted: boolean;
  company: { companyName: string; realmId: string } | null;
  companyError: string | null;
  queue: { pending: number; failed: number; dead: number };
  lastSuccess: { at: string; message: string | null } | null;
  lastFailure: { at: string; message: string | null; entity: string } | null;
  schedulerIntervalMs: number;
}

export interface SyncRunSummary {
  attempted: number;
  done: number;
  failed: number;
  dead: number;
  skipped: number;
  reason?: string;
}

export interface OutboxRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface SyncLogRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  ok: boolean;
  message: string | null;
  createdAt: string;
}

export interface ReconcileReport {
  from: string;
  to: string;
  ours: number;
  theirs: number;
  missingInQuickBooks: { invoiceNumber: string; total: string; customerName: string; invoiceDate: string; syncStatus: string }[];
  missingHere: { docNumber: string; total: number; customerName: string; txnDate: string }[];
  totalMismatch: { invoiceNumber: string; ours: string; theirs: number }[];
  voidMismatch: { invoiceNumber: string; oursVoid: boolean; theirsVoid: boolean }[];
}

const BASE = "/api/integrations/quickbooks";

export const getQuickBooksStatus = () => api.get<QuickBooksStatus>(`${BASE}/status`);
export const startQuickBooksConnect = () => api.post<{ url: string }>(`${BASE}/connect`);
export const disconnectQuickBooks = () => api.post<void>(`${BASE}/disconnect`);
export const syncQuickBooksNow = () => api.post<SyncRunSummary>(`${BASE}/sync-now`);
export const retryQuickBooks = (ids: string[]) => api.post<SyncRunSummary & { requeued: number }>(`${BASE}/retry`, { ids });
export const listOutbox = (status?: string) => api.get<OutboxRow[]>(`${BASE}/outbox${status ? `?status=${encodeURIComponent(status)}` : ""}`);
export const listSyncLog = (failedOnly = false) => api.get<SyncLogRow[]>(`${BASE}/log?limit=100${failedOnly ? "&ok=0" : ""}`);
export const reconcileQuickBooks = (from: string, to: string) => api.get<ReconcileReport>(`${BASE}/reconcile?from=${from}&to=${to}`);
