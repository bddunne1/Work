import type { Customer } from "../types";

const CUSTOMERS_KEY = "erp_customers";

function readCustomers(): Customer[] {
  try {
    const raw = localStorage.getItem(CUSTOMERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Customer[];
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
