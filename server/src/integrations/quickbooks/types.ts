// The slice of QuickBooks Online this system talks to. Kept as an interface
// so the worker can run against the in-memory fake (tests, local development
// without an Intuit app) exactly as it runs against the real API.

export interface QboRef {
  id: string;
  syncToken: string;
}

export interface QboAddress {
  line1?: string;
  line2?: string;
  line3?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

export interface QboCustomerInput {
  displayName: string;
  companyName?: string;
  email?: string;
  billAddr?: QboAddress;
  shipAddr?: QboAddress;
  taxable: boolean;
  notes?: string;
}

export interface QboItemInput {
  name: string;
  sku?: string;
  description?: string;
  unitPrice: number;
}

export interface QboDocLine {
  itemRefId: string;
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface QboInvoiceInput {
  docNumber: string;
  customerRefId: string;
  txnDate: string;
  dueDate: string;
  poNumber?: string;
  privateNote?: string;
  customerMemo?: string;
  billAddr?: QboAddress;
  shipAddr?: QboAddress;
  lines: QboDocLine[];
  totalTax: number;
  total: number;
}

export interface QboCreditMemoInput {
  docNumber: string;
  customerRefId: string;
  txnDate: string;
  privateNote?: string;
  customerMemo?: string;
  billAddr?: QboAddress;
  lines: QboDocLine[];
  totalTax: number;
  total: number;
}

export interface QboInvoiceSummary {
  id: string;
  docNumber: string;
  txnDate: string;
  total: number;
  balance: number;
  customerName: string;
  voided: boolean;
}

export interface QuickBooksApi {
  companyInfo(): Promise<{ companyName: string; realmId: string }>;
  // `existingId` is the id we already hold for the record; null means look
  // it up by display name / name first, then create.
  upsertCustomer(existingId: string | null, input: QboCustomerInput): Promise<QboRef>;
  upsertItem(existingId: string | null, input: QboItemInput): Promise<QboRef>;
  // Idempotent on DocNumber: a retry after a half-finished attempt finds the
  // invoice QuickBooks already has instead of creating a second one.
  createInvoice(input: QboInvoiceInput): Promise<QboRef>;
  voidInvoice(id: string): Promise<QboRef>;
  createCreditMemo(input: QboCreditMemoInput): Promise<QboRef>;
  voidCreditMemo(id: string): Promise<QboRef>;
  // Invoices by transaction date, inclusive, for the reconciliation report.
  listInvoices(from: string, to: string): Promise<QboInvoiceSummary[]>;
}

export class QuickBooksError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown,
    // A configuration or permission problem the retry loop can't fix.
    public permanent = false
  ) {
    super(message);
    this.name = "QuickBooksError";
  }
}
