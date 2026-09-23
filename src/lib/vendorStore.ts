import { api } from "./apiClient";
import type { Vendor } from "../types";

export async function listVendors(): Promise<Vendor[]> {
  return api.get<Vendor[]>("/api/vendors");
}

// No dedicated lookup endpoint - the vendor list is small enough that
// fetching it and finding by id client-side is simpler than adding one.
export async function getVendor(id: string): Promise<Vendor | undefined> {
  const vendors = await listVendors();
  return vendors.find((v) => v.id === id);
}

export async function saveVendor(vendor: Vendor): Promise<Vendor> {
  return api.post<Vendor>("/api/vendors", vendor);
}

export async function updateVendor(vendor: Vendor): Promise<Vendor> {
  return api.put<Vendor>(`/api/vendors/${vendor.id}`, vendor);
}

export async function deleteVendor(id: string): Promise<void> {
  await api.del(`/api/vendors/${id}`);
}
