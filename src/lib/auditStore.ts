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

export interface AuditLogFilters {
  targetType?: string;
  targetId?: string;
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  // ISO timestamp: only entries older than this (for "Load older").
  before?: string;
  limit?: number;
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function listAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
  return api.get<AuditLogEntry[]>(`/api/audit-log${query({ limit: 200, ...filters })}`);
}

// One row of the stock ledger - every change to an item's on-hand quantity.
export interface StockMovement {
  id: string;
  itemId: string;
  itemNumber: string;
  delta: number;
  qtyAfter: number;
  // SHIP | UNDO_SHIP | RECEIVE_PO | RETURN | ADJUST | ITEM_EDIT
  reason: string;
  refType: string | null;
  refId: string | null;
  actorUsername: string;
  createdAt: string;
}

export interface StockMovementFilters {
  item?: string;
  reason?: string;
  from?: string;
  to?: string;
  actor?: string;
  limit?: number;
}

export async function listStockMovements(filters: StockMovementFilters = {}): Promise<StockMovement[]> {
  return api.get<StockMovement[]>(`/api/stock-movements${query({ limit: 300, ...filters })}`);
}

export async function listItemMovements(itemId: string, limit = 100): Promise<StockMovement[]> {
  return api.get<StockMovement[]>(`/api/items/${encodeURIComponent(itemId)}/movements?limit=${limit}`);
}

export const MOVEMENT_REASON_LABEL: Record<string, string> = {
  SHIP: "Shipped",
  UNDO_SHIP: "Shipment undone",
  RECEIVE_PO: "Received (PO)",
  RETURN: "Returned to stock",
  ADJUST: "Count adjustment",
  ITEM_EDIT: "Edited on item",
};

// Where a movement came from, as an in-app link (HashRouter paths).
export function movementRefLink(m: Pick<StockMovement, "refType" | "refId">): { label: string; to: string } | null {
  if (!m.refId) return null;
  if (m.refType === "sales-order") return { label: `S.O. #${m.refId}`, to: `/storage/${m.refId}` };
  if (m.refType === "vendor-po") return { label: m.refId, to: `/purchase-orders/${m.refId}` };
  if (m.refType === "return") return { label: m.refId, to: `/returns/${m.refId}` };
  return null;
}
