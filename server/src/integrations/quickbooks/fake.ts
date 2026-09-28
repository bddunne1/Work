import type { QboCreditMemoInput, QboCustomerInput, QboInvoiceInput, QboInvoiceSummary, QboItemInput, QboRef, QuickBooksApi } from "./types.js";
import { QuickBooksError } from "./types.js";

// An in-memory QuickBooks: same contract, no network. The test suite runs
// the worker against this; so does local development when QBO_FAKE=1.
// `failNext` makes the next N calls throw, to exercise retry and backoff.

interface Row<T> {
  id: string;
  syncToken: number;
  data: T;
  voided?: boolean;
}

export class FakeQuickBooks implements QuickBooksApi {
  customers = new Map<string, Row<QboCustomerInput>>();
  items = new Map<string, Row<QboItemInput>>();
  invoices = new Map<string, Row<QboInvoiceInput>>();
  creditMemos = new Map<string, Row<QboCreditMemoInput>>();
  calls: string[] = [];
  private failuresLeft = 0;
  private failPermanently = false;
  private seq = 1;

  reset(): void {
    this.customers.clear();
    this.items.clear();
    this.invoices.clear();
    this.creditMemos.clear();
    this.calls = [];
    this.failuresLeft = 0;
    this.failPermanently = false;
    this.seq = 1;
  }

  // The next `n` calls throw: a transient 503 by default, or a permanent
  // 400 (bad data / configuration) the worker must not retry.
  failNext(n: number, permanent = false): void {
    this.failuresLeft = n;
    this.failPermanently = permanent;
  }

  private guard(call: string): void {
    this.calls.push(call);
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      if (this.failPermanently) throw new QuickBooksError("Business Validation Error: simulated bad reference", 400, undefined, true);
      throw new QuickBooksError("QuickBooks is unavailable (simulated)", 503);
    }
  }

  private nextId(): string {
    return String(this.seq++);
  }

  private ref<T>(row: Row<T>): QboRef {
    return { id: row.id, syncToken: String(row.syncToken) };
  }

  async companyInfo() {
    this.guard("companyInfo");
    return { companyName: "Fake Rope Co", realmId: "fake" };
  }

  async upsertCustomer(existingId: string | null, input: QboCustomerInput): Promise<QboRef> {
    this.guard(`upsertCustomer:${input.displayName}`);
    let row = existingId ? this.customers.get(existingId) : undefined;
    if (!row) row = [...this.customers.values()].find((r) => r.data.displayName.toLowerCase() === input.displayName.toLowerCase());
    if (row) {
      row.data = input;
      row.syncToken++;
      return this.ref(row);
    }
    row = { id: this.nextId(), syncToken: 0, data: input };
    this.customers.set(row.id, row);
    return this.ref(row);
  }

  async upsertItem(existingId: string | null, input: QboItemInput): Promise<QboRef> {
    this.guard(`upsertItem:${input.name}`);
    let row = existingId ? this.items.get(existingId) : undefined;
    if (!row) row = [...this.items.values()].find((r) => r.data.name.toLowerCase() === input.name.toLowerCase());
    if (row) {
      row.data = input;
      row.syncToken++;
      return this.ref(row);
    }
    row = { id: this.nextId(), syncToken: 0, data: input };
    this.items.set(row.id, row);
    return this.ref(row);
  }

  async createInvoice(input: QboInvoiceInput): Promise<QboRef> {
    this.guard(`createInvoice:${input.docNumber}`);
    const existing = [...this.invoices.values()].find((r) => r.data.docNumber === input.docNumber);
    if (existing) return this.ref(existing);
    if (!this.customers.has(input.customerRefId)) throw new QuickBooksError("Invalid Reference Id: Customer", 400, undefined, true);
    for (const l of input.lines) if (!this.items.has(l.itemRefId)) throw new QuickBooksError("Invalid Reference Id: Item", 400, undefined, true);
    const row = { id: this.nextId(), syncToken: 0, data: input };
    this.invoices.set(row.id, row);
    return this.ref(row);
  }

  async voidInvoice(id: string): Promise<QboRef> {
    this.guard(`voidInvoice:${id}`);
    const row = this.invoices.get(id);
    if (!row) throw new QuickBooksError("Object Not Found: Invoice", 400, undefined, true);
    row.voided = true;
    row.syncToken++;
    return this.ref(row);
  }

  async createCreditMemo(input: QboCreditMemoInput): Promise<QboRef> {
    this.guard(`createCreditMemo:${input.docNumber}`);
    const existing = [...this.creditMemos.values()].find((r) => r.data.docNumber === input.docNumber);
    if (existing) return this.ref(existing);
    if (!this.customers.has(input.customerRefId)) throw new QuickBooksError("Invalid Reference Id: Customer", 400, undefined, true);
    const row = { id: this.nextId(), syncToken: 0, data: input };
    this.creditMemos.set(row.id, row);
    return this.ref(row);
  }

  async voidCreditMemo(id: string): Promise<QboRef> {
    this.guard(`voidCreditMemo:${id}`);
    const row = this.creditMemos.get(id);
    if (!row) throw new QuickBooksError("Object Not Found: CreditMemo", 400, undefined, true);
    row.voided = true;
    row.syncToken++;
    return this.ref(row);
  }

  async listInvoices(from: string, to: string): Promise<QboInvoiceSummary[]> {
    this.guard(`listInvoices:${from}:${to}`);
    return [...this.invoices.values()]
      .filter((r) => r.data.txnDate >= from && r.data.txnDate <= to)
      .map((r) => ({
        id: r.id,
        docNumber: r.data.docNumber,
        txnDate: r.data.txnDate,
        total: r.voided ? 0 : r.data.total,
        balance: r.voided ? 0 : r.data.total,
        customerName: this.customers.get(r.data.customerRefId)?.data.displayName ?? "?",
        voided: Boolean(r.voided),
      }));
  }
}

export const fakeQuickBooks = new FakeQuickBooks();
