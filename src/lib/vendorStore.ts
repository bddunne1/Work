import type { Vendor } from "../types";

const VENDORS_KEY = "erp_vendors";

function readVendors(): Vendor[] {
  try {
    const raw = localStorage.getItem(VENDORS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Vendor[];
  } catch {
    return [];
  }
}

function writeVendors(vendors: Vendor[]): void {
  try {
    localStorage.setItem(VENDORS_KEY, JSON.stringify(vendors));
  } catch {
    // storage unavailable (private mode, blocked site data, etc.) - no-op
  }
}

export function listVendors(): Vendor[] {
  return readVendors().sort((a, b) => a.name.localeCompare(b.name));
}

export function getVendor(id: string): Vendor | undefined {
  return readVendors().find((v) => v.id === id);
}

export function saveVendor(vendor: Vendor): void {
  const vendors = readVendors();
  vendors.push(vendor);
  writeVendors(vendors);
}

export function updateVendor(vendor: Vendor): void {
  const vendors = readVendors().map((v) => (v.id === vendor.id ? vendor : v));
  writeVendors(vendors);
}

export function deleteVendor(id: string): void {
  writeVendors(readVendors().filter((v) => v.id !== id));
}
