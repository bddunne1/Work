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
  status?: "DRAFT" | "ISSUED" | "VOID" | "";
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

// `ref` is the invoice number once issued, or the id while a draft.
export async function getInvoice(ref: string): Promise<Invoice | undefined> {
  try {
    return mapInvoice(await api.get<Invoice>(`/api/invoices/${encodeURIComponent(ref)}`));
  } catch {
    return undefined;
  }
}

// Where a document lives in the app: by number once issued, by id before.
export const invoicePath = (inv: Pick<Invoice, "id" | "invoiceNumber">) => `/invoices/${encodeURIComponent(inv.invoiceNumber ?? inv.id)}`;
export const creditMemoPath = (m: Pick<CreditMemo, "id" | "creditMemoNumber">) => `/invoices/credit-memos/${encodeURIComponent(m.creditMemoNumber ?? m.id)}`;
export const docLabel = (n: string | null, kind: "Invoice" | "Credit memo") => n ?? `${kind} draft`;

// What a reviewer sends back for a draft: the lines as they should be
// (shipped lines repriced, charge lines added or removed) and the note.
export interface DraftLineInput {
  id?: string;
  kind: "ITEM" | "CHARGE";
  item: string;
  description: string;
  um?: string;
  qty: number;
  rate: number;
  taxable: boolean;
}

export async function saveInvoiceDraft(id: string, version: number, lines: DraftLineInput[], notes: string): Promise<Invoice> {
  return mapInvoice(await api.put<Invoice>(`/api/invoices/${encodeURIComponent(id)}`, { version, lines, notes }));
}

export async function issueInvoice(id: string, version: number): Promise<Invoice> {
  return mapInvoice(await api.post<Invoice>(`/api/invoices/${encodeURIComponent(id)}/issue`, { version }));
}

export async function saveCreditMemoDraft(id: string, version: number, lines: DraftLineInput[]): Promise<CreditMemo> {
  return mapMemo(await api.put<CreditMemo>(`/api/invoices/credit-memos/${encodeURIComponent(id)}`, { version, lines }));
}

export async function issueCreditMemo(id: string, version: number): Promise<CreditMemo> {
  return mapMemo(await api.post<CreditMemo>(`/api/invoices/credit-memos/${encodeURIComponent(id)}/issue`, { version }));
}

export interface ReviewQueueCounts {
  invoices: number;
  creditMemos: number;
  oldestDraftAt: string | null;
}

// Empty counts when the account cannot see invoices.
export async function reviewQueueCounts(): Promise<ReviewQueueCounts> {
  try {
    return await api.get<ReviewQueueCounts>("/api/invoices/queue");
  } catch {
    return { invoices: 0, creditMemos: 0, oldestDraftAt: null };
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

export async function voidInvoice(ref: string, reason: string): Promise<Invoice> {
  return mapInvoice(await api.post<Invoice>(`/api/invoices/${encodeURIComponent(ref)}/void`, { reason }));
}

export async function searchCreditMemos(params: DocSearchParams = {}): Promise<Paged<CreditMemo>> {
  const res = await api.get<Paged<CreditMemo>>(`/api/invoices/credit-memos${qs(params)}`);
  return { ...res, rows: res.rows.map(mapMemo) };
}

export async function getCreditMemo(ref: string): Promise<CreditMemo | undefined> {
  try {
    return mapMemo(await api.get<CreditMemo>(`/api/invoices/credit-memos/${encodeURIComponent(ref)}`));
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

export async function voidCreditMemo(ref: string, reason: string): Promise<CreditMemo> {
  return mapMemo(await api.post<CreditMemo>(`/api/invoices/credit-memos/${encodeURIComponent(ref)}/void`, { reason }));
}

export const money = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
