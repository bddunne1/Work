import { api } from "./apiClient";
import type { CreditMemo, Invoice } from "../types";

// Decimal columns arrive as strings; dates as ISO timestamps at midnight.
function mapInvoice(i: Invoice): Invoice {
  return {
    ...i,
    invoiceDate: String(i.invoiceDate).slice(0, 10),
    dueDate: String(i.dueDate).slice(0, 10),
    subtotal: Number(i.subtotal),
    taxRate: Number(i.taxRate),
    tax: Number(i.tax),
    total: Number(i.total),
    lines: i.lines.map((l) => ({ ...l, rate: Number(l.rate), amount: Number(l.amount) })),
  };
}

function mapMemo(m: CreditMemo): CreditMemo {
  return {
    ...m,
    memoDate: String(m.memoDate).slice(0, 10),
    subtotal: Number(m.subtotal),
    taxRate: Number(m.taxRate),
    tax: Number(m.tax),
    total: Number(m.total),
    lines: m.lines.map((l) => ({ ...l, rate: Number(l.rate), amount: Number(l.amount) })),
  };
}

export interface DocSearchParams {
  q?: string;
  status?: "ISSUED" | "VOID" | "";
  customerId?: string;
  soNumber?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

function qs(params: DocSearchParams): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function searchInvoices(params: DocSearchParams = {}): Promise<Paged<Invoice>> {
  const res = await api.get<Paged<Invoice>>(`/api/invoices${qs(params)}`);
  return { ...res, rows: res.rows.map(mapInvoice) };
}

export async function getInvoice(invoiceNumber: string): Promise<Invoice | undefined> {
  try {
    return mapInvoice(await api.get<Invoice>(`/api/invoices/${encodeURIComponent(invoiceNumber)}`));
  } catch {
    return undefined;
  }
}

// Invoices for one order - empty when the account can't see invoices.
export async function invoicesForOrder(soNumber: string): Promise<Invoice[]> {
  try {
    return (await searchInvoices({ soNumber, pageSize: 100 })).rows;
  } catch {
    return [];
  }
}

export async function voidInvoice(invoiceNumber: string, reason: string): Promise<Invoice> {
  return mapInvoice(await api.post<Invoice>(`/api/invoices/${encodeURIComponent(invoiceNumber)}/void`, { reason }));
}

export async function searchCreditMemos(params: DocSearchParams = {}): Promise<Paged<CreditMemo>> {
  const res = await api.get<Paged<CreditMemo>>(`/api/invoices/credit-memos${qs(params)}`);
  return { ...res, rows: res.rows.map(mapMemo) };
}

export async function getCreditMemo(number: string): Promise<CreditMemo | undefined> {
  try {
    return mapMemo(await api.get<CreditMemo>(`/api/invoices/credit-memos/${encodeURIComponent(number)}`));
  } catch {
    return undefined;
  }
}

export async function creditMemoForReturn(raNumber: string): Promise<CreditMemo | undefined> {
  try {
    const res = await searchCreditMemos({ q: raNumber, pageSize: 10 });
    return res.rows.find((m) => m.raNumber === raNumber);
  } catch {
    return undefined;
  }
}

export async function voidCreditMemo(number: string, reason: string): Promise<CreditMemo> {
  return mapMemo(await api.post<CreditMemo>(`/api/invoices/credit-memos/${encodeURIComponent(number)}/void`, { reason }));
}

export const money = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
