import { api } from "./apiClient";
import type { Address } from "../types";

// One row per shipment, from GET /api/shipments - what Shipment History
// and the end-of-day shipped report show (R4-20).
export interface ShipmentRow {
  id: string;
  soNumber: number;
  shippedAt: string;
  poNumber: string;
  customer: string;
  shipTo: Address;
  orderStatus: string;
  orderVersion: number;
  lines: { lineItemId: string; item: string; description: string; um: string; qty: number }[];
  units: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceTotal: string | null;
  invoiceStatus: "DRAFT" | "ISSUED" | "VOID" | null;
  // True when this is the order's most recent shipment - the only one
  // Undo Last Shipment can take back.
  isLatest: boolean;
}

export interface ShipmentTotals {
  shipments: number;
  units: number;
  // Null for a login that may not see prices (B-10).
  amount: string | null;
  // False when the range held more shipments than the totals were summed over.
  complete: boolean;
}

export interface ShipmentSearch {
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export async function listShipments(params: ShipmentSearch): Promise<{ rows: ShipmentRow[]; total: number; totals: ShipmentTotals }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  return api.get(`/api/shipments?${qs.toString()}`);
}
