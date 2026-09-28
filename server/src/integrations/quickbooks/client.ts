import { prisma } from "../../prisma.js";
import { open, seal } from "../secrets.js";
import type { QboAddress, QboCreditMemoInput, QboCustomerInput, QboInvoiceInput, QboInvoiceSummary, QboItemInput, QboRef, QuickBooksApi } from "./types.js";
import { QuickBooksError } from "./types.js";

// QuickBooks Online REST client (Accounting API v3) with OAuth 2 refresh.
//
// Configuration (environment):
//   QBO_CLIENT_ID / QBO_CLIENT_SECRET   from the Intuit developer app
//   QBO_REDIRECT_URI                    e.g. http://localhost:4000/api/integrations/quickbooks/callback
//   QBO_ENVIRONMENT                     sandbox (default) | production
//   QBO_INCOME_ACCOUNT                  name of the income account new items post to
//                                       (default: the first active Income account)
//   QBO_MINOR_VERSION                   API minor version (default 73)
//
// Notes for whoever maintains this:
// - Items are created as NonInventory. QuickBooks must NOT track inventory
//   for them: this system is the stock record.
// - Tax: the invoice carries TxnTaxDetail.TotalTax computed here. A company
//   with Automated Sales Tax turned on may recompute it; reconcile totals
//   after the first live invoices and decide whether to let QuickBooks own
//   the tax figure (send lines only) or to keep sending ours.
// - Every create is preceded by a DocNumber lookup, so a retry after a
//   timeout never makes a duplicate.

export const SYSTEM = "quickbooks";
const MINOR_VERSION = process.env.QBO_MINOR_VERSION ?? "73";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";

export function qboEnvironment(): "sandbox" | "production" {
  return process.env.QBO_ENVIRONMENT === "production" ? "production" : "sandbox";
}

export function qboConfigured(): boolean {
  return Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET && process.env.QBO_REDIRECT_URI);
}

function apiBase(env: string): string {
  return env === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
}

function basicAuth(): string {
  return "Basic " + Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
}

// ---- OAuth ------------------------------------------------------------------

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID ?? "",
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: process.env.QBO_REDIRECT_URI ?? "",
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(), Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new QuickBooksError(`OAuth token request failed: ${String(json.error_description ?? json.error ?? res.status)}`, res.status, json, res.status === 400);
  }
  return json as unknown as TokenResponse;
}

export async function exchangeCode(code: string, realmId: string, connectedBy: string | null): Promise<void> {
  const tokens = await tokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: process.env.QBO_REDIRECT_URI ?? "" })
  );
  await saveTokens(realmId, tokens, connectedBy);
}

async function saveTokens(realmId: string, tokens: TokenResponse, connectedBy: string | null): Promise<void> {
  const now = Date.now();
  const data = {
    realmId,
    environment: qboEnvironment(),
    accessToken: seal(tokens.access_token),
    refreshToken: seal(tokens.refresh_token),
    accessExpiresAt: new Date(now + tokens.expires_in * 1000),
    refreshExpiresAt: new Date(now + tokens.x_refresh_token_expires_in * 1000),
  };
  await prisma.integrationConnection.upsert({
    where: { system: SYSTEM },
    create: { system: SYSTEM, ...data, connectedBy },
    update: { ...data, ...(connectedBy ? { connectedBy, connectedAt: new Date() } : {}) },
  });
}

export async function disconnect(): Promise<void> {
  const conn = await prisma.integrationConnection.findUnique({ where: { system: SYSTEM } });
  if (!conn) return;
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { Authorization: basicAuth(), Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: open(conn.refreshToken) }),
    });
  } catch {
    // Revocation is best effort - the row goes either way.
  }
  await prisma.integrationConnection.delete({ where: { system: SYSTEM } });
}

// ---- API client ---------------------------------------------------------------

function addr(a?: QboAddress) {
  if (!a) return undefined;
  return { Line1: a.line1, Line2: a.line2, Line3: a.line3, City: a.city, CountrySubDivisionCode: a.state, PostalCode: a.postalCode };
}

function faultMessage(body: unknown, status: number): string {
  const fault = (body as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } })?.Fault;
  const first = fault?.Error?.[0];
  if (first) return [first.Message, first.Detail].filter(Boolean).join(" - ") || `QuickBooks error ${first.code ?? status}`;
  return `QuickBooks returned ${status}`;
}

export class QboHttpClient implements QuickBooksApi {
  private incomeAccountId: string | null = null;
  private refreshing: Promise<void> | null = null;

  private async connection() {
    const conn = await prisma.integrationConnection.findUnique({ where: { system: SYSTEM } });
    if (!conn) throw new QuickBooksError("QuickBooks is not connected.", 401, undefined, true);
    return conn;
  }

  private async accessToken(): Promise<{ token: string; realmId: string; base: string }> {
    let conn = await this.connection();
    if (conn.accessExpiresAt.getTime() - Date.now() < 120_000) {
      await this.refresh();
      conn = await this.connection();
    }
    return { token: open(conn.accessToken), realmId: conn.realmId, base: apiBase(conn.environment) };
  }

  private refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const conn = await this.connection();
        if (conn.refreshExpiresAt.getTime() < Date.now()) {
          throw new QuickBooksError("The QuickBooks connection has expired - reconnect it under Settings.", 401, undefined, true);
        }
        const tokens = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: open(conn.refreshToken) }));
        await saveTokens(conn.realmId, tokens, null);
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, query: Record<string, string> = {}, retried = false): Promise<T> {
    const { token, realmId, base } = await this.accessToken();
    const qs = new URLSearchParams({ minorversion: MINOR_VERSION, ...query });
    const res = await fetch(`${base}/v3/company/${realmId}${path}?${qs}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && !retried) {
      await this.refresh();
      return this.request(method, path, body, query, true);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // 4xx other than throttling is a data/config problem a retry won't fix.
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      throw new QuickBooksError(faultMessage(json, res.status), res.status, json, permanent);
    }
    return json as T;
  }

  private async query<T>(sql: string): Promise<T[]> {
    const res = await this.request<{ QueryResponse: Record<string, T[]> }>("GET", "/query", undefined, { query: sql });
    const entity = Object.keys(res.QueryResponse ?? {}).find((k) => Array.isArray((res.QueryResponse as Record<string, unknown>)[k]));
    return entity ? res.QueryResponse[entity] : [];
  }

  private escape(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  async companyInfo() {
    const conn = await this.connection();
    const res = await this.request<{ CompanyInfo: { CompanyName: string } }>("GET", `/companyinfo/${conn.realmId}`);
    return { companyName: res.CompanyInfo.CompanyName, realmId: conn.realmId };
  }

  private async incomeAccount(): Promise<string> {
    if (this.incomeAccountId) return this.incomeAccountId;
    const accounts = await this.query<{ Id: string; Name: string; AccountType: string; Active: boolean }>(
      "SELECT Id, Name, AccountType, Active FROM Account WHERE AccountType = 'Income' MAXRESULTS 100"
    );
    const wanted = process.env.QBO_INCOME_ACCOUNT?.toLowerCase();
    const pick = accounts.find((a) => a.Active !== false && (!wanted || a.Name.toLowerCase() === wanted)) ?? accounts.find((a) => a.Active !== false);
    if (!pick) throw new QuickBooksError(`No income account found in QuickBooks${wanted ? ` named "${process.env.QBO_INCOME_ACCOUNT}"` : ""}.`, 400, undefined, true);
    this.incomeAccountId = pick.Id;
    return pick.Id;
  }

  async upsertCustomer(existingId: string | null, input: QboCustomerInput): Promise<QboRef> {
    type C = { Id: string; SyncToken: string };
    let current: C | undefined;
    if (existingId) {
      const res = await this.request<{ Customer: C }>("GET", `/customer/${existingId}`).catch(() => null);
      current = res?.Customer;
    }
    if (!current) {
      const found = await this.query<C>(`SELECT Id, SyncToken FROM Customer WHERE DisplayName = '${this.escape(input.displayName)}'`);
      current = found[0];
    }
    const payload = {
      DisplayName: input.displayName,
      CompanyName: input.companyName,
      PrimaryEmailAddr: input.email ? { Address: input.email } : undefined,
      BillAddr: addr(input.billAddr),
      ShipAddr: addr(input.shipAddr),
      Taxable: input.taxable,
      Notes: input.notes,
    };
    const res = await this.request<{ Customer: C }>(
      "POST",
      "/customer",
      current ? { ...payload, Id: current.Id, SyncToken: current.SyncToken, sparse: true } : payload
    );
    return { id: res.Customer.Id, syncToken: res.Customer.SyncToken };
  }

  async upsertItem(existingId: string | null, input: QboItemInput): Promise<QboRef> {
    type I = { Id: string; SyncToken: string };
    let current: I | undefined;
    if (existingId) {
      const res = await this.request<{ Item: I }>("GET", `/item/${existingId}`).catch(() => null);
      current = res?.Item;
    }
    if (!current) {
      const found = await this.query<I>(`SELECT Id, SyncToken FROM Item WHERE Name = '${this.escape(input.name)}'`);
      current = found[0];
    }
    const payload = current
      ? { Id: current.Id, SyncToken: current.SyncToken, sparse: true, Name: input.name, Sku: input.sku, Description: input.description, UnitPrice: input.unitPrice }
      : {
          Name: input.name,
          Sku: input.sku,
          Description: input.description,
          UnitPrice: input.unitPrice,
          Type: "NonInventory",
          IncomeAccountRef: { value: await this.incomeAccount() },
        };
    const res = await this.request<{ Item: I }>("POST", "/item", payload);
    return { id: res.Item.Id, syncToken: res.Item.SyncToken };
  }

  private docLines(lines: QboInvoiceInput["lines"]) {
    return lines.map((l) => ({
      DetailType: "SalesItemLineDetail",
      Amount: l.amount,
      Description: l.description,
      SalesItemLineDetail: { ItemRef: { value: l.itemRefId }, Qty: l.qty, UnitPrice: l.unitPrice },
    }));
  }

  async createInvoice(input: QboInvoiceInput): Promise<QboRef> {
    type Inv = { Id: string; SyncToken: string };
    const existing = await this.query<Inv>(`SELECT Id, SyncToken FROM Invoice WHERE DocNumber = '${this.escape(input.docNumber)}'`);
    if (existing[0]) return { id: existing[0].Id, syncToken: existing[0].SyncToken };
    const res = await this.request<{ Invoice: Inv }>("POST", "/invoice", {
      DocNumber: input.docNumber,
      CustomerRef: { value: input.customerRefId },
      TxnDate: input.txnDate,
      DueDate: input.dueDate,
      Line: this.docLines(input.lines),
      TxnTaxDetail: input.totalTax > 0 ? { TotalTax: input.totalTax } : undefined,
      BillAddr: addr(input.billAddr),
      ShipAddr: addr(input.shipAddr),
      CustomerMemo: input.customerMemo ? { value: input.customerMemo } : undefined,
      PrivateNote: input.privateNote,
    });
    return { id: res.Invoice.Id, syncToken: res.Invoice.SyncToken };
  }

  async voidInvoice(id: string): Promise<QboRef> {
    type Inv = { Id: string; SyncToken: string };
    const current = await this.request<{ Invoice: Inv }>("GET", `/invoice/${id}`);
    const res = await this.request<{ Invoice: Inv }>("POST", "/invoice", { Id: id, SyncToken: current.Invoice.SyncToken }, { operation: "void" });
    return { id: res.Invoice.Id, syncToken: res.Invoice.SyncToken };
  }

  async createCreditMemo(input: QboCreditMemoInput): Promise<QboRef> {
    type CM = { Id: string; SyncToken: string };
    const existing = await this.query<CM>(`SELECT Id, SyncToken FROM CreditMemo WHERE DocNumber = '${this.escape(input.docNumber)}'`);
    if (existing[0]) return { id: existing[0].Id, syncToken: existing[0].SyncToken };
    const res = await this.request<{ CreditMemo: CM }>("POST", "/creditmemo", {
      DocNumber: input.docNumber,
      CustomerRef: { value: input.customerRefId },
      TxnDate: input.txnDate,
      Line: this.docLines(input.lines),
      TxnTaxDetail: input.totalTax > 0 ? { TotalTax: input.totalTax } : undefined,
      BillAddr: addr(input.billAddr),
      CustomerMemo: input.customerMemo ? { value: input.customerMemo } : undefined,
      PrivateNote: input.privateNote,
    });
    return { id: res.CreditMemo.Id, syncToken: res.CreditMemo.SyncToken };
  }

  async voidCreditMemo(id: string): Promise<QboRef> {
    type CM = { Id: string; SyncToken: string };
    const current = await this.request<{ CreditMemo: CM }>("GET", `/creditmemo/${id}`);
    const res = await this.request<{ CreditMemo: CM }>("POST", "/creditmemo", { Id: id, SyncToken: current.CreditMemo.SyncToken }, { operation: "void" });
    return { id: res.CreditMemo.Id, syncToken: res.CreditMemo.SyncToken };
  }

  async listInvoices(from: string, to: string): Promise<QboInvoiceSummary[]> {
    type Inv = { Id: string; DocNumber: string; TxnDate: string; TotalAmt: number; Balance: number; CustomerRef: { name?: string }; PrivateNote?: string };
    const out: QboInvoiceSummary[] = [];
    for (let start = 1; ; start += 1000) {
      const page = await this.query<Inv>(
        `SELECT * FROM Invoice WHERE TxnDate >= '${from}' AND TxnDate <= '${to}' ORDERBY TxnDate STARTPOSITION ${start} MAXRESULTS 1000`
      );
      for (const inv of page) {
        out.push({
          id: inv.Id,
          docNumber: inv.DocNumber,
          txnDate: inv.TxnDate,
          total: inv.TotalAmt,
          balance: inv.Balance,
          customerName: inv.CustomerRef?.name ?? "",
          voided: /Voided/i.test(inv.PrivateNote ?? "") && inv.TotalAmt === 0,
        });
      }
      if (page.length < 1000) break;
    }
    return out;
  }
}
