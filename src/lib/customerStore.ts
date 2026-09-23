import { api } from "./apiClient";
import type { Customer } from "../types";

// Prisma serializes Decimal fields as strings over JSON (to avoid float
// precision loss when round-tripping) - convert priceOverrides[].price back
// to a number here so the rest of the app can keep treating it as one, same
// as it did when everything lived in localStorage.
function mapCustomer(c: Customer): Customer {
  return {
    ...c,
    priceOverrides: c.priceOverrides?.map((p) => ({ ...p, price: Number(p.price) })),
  };
}

export async function listCustomers(q?: string): Promise<Customer[]> {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  const customers = await api.get<Customer[]>(`/api/customers${query}`);
  return customers.map(mapCustomer);
}

export async function getCustomer(id: string): Promise<Customer | undefined> {
  try {
    const customer = await api.get<Customer>(`/api/customers/${id}`);
    return mapCustomer(customer);
  } catch {
    return undefined;
  }
}

export async function saveCustomer(customer: Customer): Promise<Customer> {
  const saved = await api.post<Customer>("/api/customers", customer);
  return mapCustomer(saved);
}

export async function updateCustomer(customer: Customer): Promise<Customer> {
  const updated = await api.put<Customer>(`/api/customers/${customer.id}`, customer);
  return mapCustomer(updated);
}

export async function deleteCustomer(id: string): Promise<void> {
  await api.del(`/api/customers/${id}`);
}
