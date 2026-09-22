import type { Address, Customer } from "../types";
import { emptyShippingLocation } from "../types";

const CUSTOMERS_KEY = "erp_customers";

// Older saved records may still have a single `shipTo` address instead of
// `shipToLocations`, or lack fields added later - normalize them on read so
// the app never sees an outdated shape.
function normalizeCustomer(raw: Customer & { shipTo?: Address }): Customer {
  let customer = raw;
  if (!Array.isArray(raw.shipToLocations) || raw.shipToLocations.length === 0) {
    const location = raw.shipTo
      ? { id: crypto.randomUUID(), label: "Primary", address: raw.shipTo }
      : emptyShippingLocation();
    customer = { ...customer, shipToLocations: [location] };
  }
  if (typeof customer.shipCompleteOnly !== "boolean") {
    customer = { ...customer, shipCompleteOnly: false };
  }
  if (!Array.isArray(customer.notes)) {
    customer = { ...customer, notes: [] };
  }
  return customer;
}

function readCustomers(): Customer[] {
  try {
    const raw = localStorage.getItem(CUSTOMERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Customer[];
    return parsed.map(normalizeCustomer);
  } catch {
    return [];
  }
}

function writeCustomers(customers: Customer[]): void {
  try {
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
  } catch {
    // storage unavailable (private mode, blocked site data, etc.) - no-op
  }
}

export function listCustomers(): Customer[] {
  return readCustomers().sort((a, b) => a.name.localeCompare(b.name));
}

export function getCustomer(id: string): Customer | undefined {
  return readCustomers().find((c) => c.id === id);
}

export function saveCustomer(customer: Customer): void {
  const customers = readCustomers();
  customers.push(customer);
  writeCustomers(customers);
}

export function updateCustomer(customer: Customer): void {
  const customers = readCustomers().map((c) => (c.id === customer.id ? customer : c));
  writeCustomers(customers);
}

export function deleteCustomer(id: string): void {
  writeCustomers(readCustomers().filter((c) => c.id !== id));
}
