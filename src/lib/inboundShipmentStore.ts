import { api } from "./apiClient";
import type { InboundShipment, InboundShipmentLine, InboundStatus } from "../types";

// Inbound shipments (sprint 4): GET/POST/PUT/DELETE /api/inbound-shipments,
// plus POST /:id/status. The server owns the status names and resolves the
// vendor from the PO lines when none is given.

export interface InboundShipmentInput {
  reference: string;
  carrier: string;
  vendorId: string | null;
  status?: InboundStatus;
  etd: string | null;
  eta: string | null;
  notes: string;
  lines: Pick<InboundShipmentLine, "vendorPoLineId" | "qty">[];
}

export interface InboundListParams {
  open?: boolean;
  q?: string;
  page: number;
  pageSize: number;
}

// One page, sorted by ETA (soonest first, no ETA last) on the server.
export async function searchInboundShipments(params: InboundListParams): Promise<{ rows: InboundShipment[]; total: number }> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  if (params.open) qs.set("open", "1");
  if (params.q) qs.set("q", params.q);
  return api.get(`/api/inbound-shipments?${qs.toString()}`);
}

// Every shipment carrying a line of `poNumber`, for the PO page.
export function listInboundForPo(poNumber: string): Promise<InboundShipment[]> {
  return api.get(`/api/inbound-shipments?poNumber=${encodeURIComponent(poNumber)}`);
}

export async function getInboundShipment(id: string): Promise<InboundShipment | undefined> {
  try {
    return await api.get<InboundShipment>(`/api/inbound-shipments/${encodeURIComponent(id)}`);
  } catch {
    return undefined;
  }
}

export function createInboundShipment(input: InboundShipmentInput, idempotencyKey?: string): Promise<InboundShipment> {
  return api.post("/api/inbound-shipments", input, { idempotencyKey });
}

// Version-checked; keep the returned copy for the next save.
export function updateInboundShipment(id: string, version: number, input: InboundShipmentInput): Promise<InboundShipment> {
  return api.put(`/api/inbound-shipments/${encodeURIComponent(id)}`, { ...input, version });
}

export function setInboundStatus(shipment: Pick<InboundShipment, "id" | "version">, status: InboundStatus): Promise<InboundShipment> {
  return api.post(`/api/inbound-shipments/${encodeURIComponent(shipment.id)}/status`, { version: shipment.version, status });
}

export function deleteInboundShipment(id: string): Promise<void> {
  return api.del(`/api/inbound-shipments/${encodeURIComponent(id)}`);
}
