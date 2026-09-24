import type { Customer, Item, LineItem, PurchaseOrder } from "../types";
import { emptyAddress, emptyShippingLocation } from "../types";
import { api, ApiError } from "./apiClient";
import { field, type ParsedCsv } from "./csv";
import { addBusinessDays } from "./dateUtils";
import { itemsIndex, listItems } from "./itemStore";
import { getLeadTimeDays } from "./settingsStore";

// One record the import would create or update - a customer, item or
// inventory row is one spreadsheet row; a sales order can span several rows
// (one per line item).
export interface RowResult<T> {
  // First spreadsheet row of the record (header = row 1).
  rowNumber: number;
  // Every spreadsheet row that fed this record.
  rowNumbers: number[];
  // Short human label for the preview/results table.
  label: string;
  // Problems that stop this record being imported. Checked against the same
  // rules the server enforces, so a row that previews clean shouldn't be
  // rejected on save.
  errors: string[];
  // Set when the record already exists (in the system or earlier in this
  // file) - it's skipped on save instead of creating a duplicate.
  duplicateReason?: string;
  // Present only when `errors` is empty.
  data?: T;
  // The raw rows this record came from, for the failed-rows download.
  sourceRows: Record<string, string>[];
}

export type RowStatus = "ready" | "duplicate" | "error";

export function rowStatus(r: RowResult<unknown>): RowStatus {
  if (r.errors.length > 0 || !r.data) return "error";
  if (r.duplicateReason) return "duplicate";
  return "ready";
}

// ---------------------------------------------------------------------------
// Value parsing

const YES = ["yes", "y", "true", "1"];
const NO = ["no", "n", "false", "0"];

function key(v: string): string {
  return v.trim().toLowerCase();
}

// A plain or thousands-grouped decimal: "1234.5", "1,234.50", ".5".
const DECIMAL = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+`;
const MONEY_RE = new RegExp(`^(-)?\\$?(-)?(${DECIMAL})$`);
const NUMBER_RE = new RegExp(`^(-)?(${DECIMAL})$`);

// Money as spreadsheets and accounting exports write it: "42.5", "$1,234.50",
// "-$5.00". Anything else (text, "12,34", "1.2.3") is null - never a silent 0.
export function parseMoney(raw: string): number | null {
  const m = MONEY_RE.exec(raw.replace(/\s+/g, ""));
  if (!m || (m[1] && m[2])) return null;
  const n = Number(m[3].replace(/,/g, ""));
  return Number.isFinite(n) ? (m[1] || m[2] ? -n : n) : null;
}

// A plain number, thousands separators allowed ("1,200", "24.5").
export function parseNumber(raw: string): number | null {
  const m = NUMBER_RE.exec(raw.replace(/\s+/g, ""));
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ""));
  return Number.isFinite(n) ? (m[1] ? -n : n) : null;
}

// A parsed cell: its value, or why it was rejected.
type Check = { value?: number; error?: string };

function money(label: string, raw: string, opts: { allowNegative?: boolean } = {}): Check {
  const n = parseMoney(raw);
  if (n === null) return { error: `${label} "${raw}" isn't a number` };
  if (n < 0 && !opts.allowNegative) return { error: `${label} can't be negative` };
  return { value: n };
}

function decimal(label: string, raw: string): Check {
  const n = parseNumber(raw);
  if (n === null) return { error: `${label} "${raw}" isn't a number` };
  if (n < 0) return { error: `${label} can't be negative` };
  return { value: n };
}

function wholeNumber(label: string, raw: string, min: number): Check {
  const n = parseNumber(raw);
  if (n === null) return { error: `${label} "${raw}" isn't a number` };
  if (!Number.isInteger(n)) return { error: `${label} "${raw}" must be a whole number` };
  if (n < min) return { error: `${label} must be ${min} or more` };
  return { value: n };
}

// Today's date as "YYYY-MM-DD" in the user's own timezone (not UTC, which is
// already tomorrow for US users in the evening).
function localIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// "YYYY-MM-DD", or null if `raw` isn't a real calendar date. Accepts ISO
// (2026-09-22) and US-style (9/22/2026, 09/22/26), which is what Excel
// exports by default. Mirrors dateUtils.normalizeDateInput.
export function normalizeImportDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function rowNumberOf(csv: ParsedCsv, idx: number): number {
  // header is row 1
  return csv.rowNumbers?.[idx] ?? idx + 2;
}

// ---------------------------------------------------------------------------
// What each import type needs to know about existing records

export interface ImportContext {
  customers: Customer[];
  items: Item[];
  leadTimeDays: number;
}

// Names/addresses/terms/ship-to only - the full customer list carries every
// key account's price sheet and is megabytes (same call as
// customerStore.listCustomerSummaries).
async function listCustomerSummaries(): Promise<Customer[]> {
  return api.get<Customer[]>("/api/customers?summary=1");
}

export async function loadImportContext(type: "customers" | "items" | "orders" | "inventory"): Promise<ImportContext> {
  const needsCustomers = type === "customers" || type === "orders";
  const needsItems = type !== "customers";
  const [customers, items] = await Promise.all([
    needsCustomers ? listCustomerSummaries() : Promise.resolve([]),
    needsItems ? listItems() : Promise.resolve([]),
  ]);
  return { customers, items, leadTimeDays: type === "orders" ? getLeadTimeDays() : 0 };
}

// ---------------------------------------------------------------------------
// Customers

export function parseCustomers(csv: ParsedCsv, existing: Customer[]): RowResult<Customer>[] {
  const byName = new Map(existing.map((c) => [key(c.name), c]));
  const byAccount = new Map(existing.filter((c) => c.accountNumber?.trim()).map((c) => [key(c.accountNumber), c]));
  const seenName = new Map<string, number>();
  const seenAccount = new Map<string, number>();

  return csv.rows.map((row, idx) => {
    const rowNumber = rowNumberOf(csv, idx);
    const base = { rowNumber, rowNumbers: [rowNumber], sourceRows: [row] };
    const name = field(row, "Customer Name", "Name", "Company");
    const accountNumber = field(row, "Account Number", "Account #", "Account");
    const label = name ? (accountNumber ? `${name} (${accountNumber})` : name) : "(no name)";
    const errors: string[] = [];
    if (!name) errors.push("Missing Customer Name");

    const shipCompleteRaw = field(row, "Ship Complete Only", "Ship Complete");
    let shipCompleteOnly = false;
    if (YES.includes(key(shipCompleteRaw))) shipCompleteOnly = true;
    else if (shipCompleteRaw && !NO.includes(key(shipCompleteRaw))) {
      errors.push(`Ship Complete Only "${shipCompleteRaw}" should be Yes or No`);
    }
    if (errors.length > 0) return { ...base, label, errors };

    let duplicateReason: string | undefined;
    const nameMatch = byName.get(key(name));
    const accountMatch = accountNumber ? byAccount.get(key(accountNumber)) : undefined;
    if (nameMatch) duplicateReason = `Customer "${nameMatch.name}" already exists`;
    else if (accountMatch) duplicateReason = `Account # ${accountNumber} already belongs to "${accountMatch.name}"`;
    else if (seenName.has(key(name))) duplicateReason = `Same customer as row ${seenName.get(key(name))}`;
    else if (accountNumber && seenAccount.has(key(accountNumber))) {
      duplicateReason = `Same Account # as row ${seenAccount.get(key(accountNumber))}`;
    }
    if (!duplicateReason) {
      seenName.set(key(name), rowNumber);
      if (accountNumber) seenAccount.set(key(accountNumber), rowNumber);
    }

    const billTo = {
      ...emptyAddress(),
      name,
      addressLine1: field(row, "Address", "Address Line 1", "Bill To Address", "Street"),
      addressLine2: field(row, "Address Line 2", "Address 2"),
      city: field(row, "City", "Bill To City"),
      state: field(row, "State", "Bill To State"),
      zip: field(row, "Zip", "Zip Code", "Postal Code", "Bill To Zip"),
    };
    const location = emptyShippingLocation();
    location.label = "Primary";
    location.address = { ...billTo };

    const customer: Customer = {
      id: crypto.randomUUID(),
      name,
      accountNumber,
      billTo,
      shipToLocations: [location],
      terms: field(row, "Terms"),
      shipVia: field(row, "Ship Via", "Shipping Method"),
      fob: field(row, "FOB"),
      rep: field(row, "Rep", "Sales Rep"),
      shipCompleteOnly,
      notes: [],
      createdAt: new Date().toISOString(),
    };
    return { ...base, label, errors: [], duplicateReason, data: customer };
  });
}

// ---------------------------------------------------------------------------
// Items

export function parseItems(csv: ParsedCsv, existing: Item[]): RowResult<Item>[] {
  const existingByNumber = itemsIndex(existing);
  const seen = new Map<string, number>();

  return csv.rows.map((row, idx) => {
    const rowNumber = rowNumberOf(csv, idx);
    const base = { rowNumber, rowNumbers: [rowNumber], sourceRows: [row] };
    const itemNumber = field(row, "Item Number", "Item #", "SKU", "Item");
    const description = field(row, "Description");
    const label = itemNumber ? (description ? `${itemNumber} - ${description}` : itemNumber) : "(no item #)";
    const errors: string[] = [];
    if (!itemNumber) errors.push("Missing Item Number");
    if (!description) errors.push("Missing Description");

    const rateStr = field(row, "Rate", "Price", "Unit Price");
    const onHandStr = field(row, "On Hand", "Qty On Hand", "Quantity On Hand");
    const onPoStr = field(row, "On Purchase Order", "Qty On PO", "On Order");
    const weightStr = field(row, "Weight", "Weight (lbs)", "Unit Weight");
    const rate = rateStr ? money("Rate", rateStr) : { value: 0 };
    const onHand = onHandStr ? wholeNumber("On Hand", onHandStr, 0) : { value: 0 };
    const onPo = onPoStr ? wholeNumber("On Purchase Order", onPoStr, 0) : { value: 0 };
    const weight = weightStr ? decimal("Weight", weightStr) : { value: undefined };
    for (const c of [rate, onHand, onPo, weight]) if (c.error) errors.push(c.error);
    if (errors.length > 0) return { ...base, label, errors };

    let duplicateReason: string | undefined;
    const existingItem = existingByNumber.get(key(itemNumber));
    if (existingItem) duplicateReason = `Item # ${existingItem.itemNumber} already exists`;
    else if (seen.has(key(itemNumber))) duplicateReason = `Same Item # as row ${seen.get(key(itemNumber))}`;
    else seen.set(key(itemNumber), rowNumber);

    const item: Item = {
      id: crypto.randomUUID(),
      itemNumber,
      description,
      um: field(row, "U/M", "UOM", "Unit", "Unit of Measure") || "EA",
      rate: rate.value ?? 0,
      qtyOnHand: onHand.value ?? 0,
      qtyOnPurchaseOrder: onPo.value ?? 0,
      weight: weight.value,
      createdAt: new Date().toISOString(),
    };
    return { ...base, label, errors: [], duplicateReason, data: item };
  });
}

// ---------------------------------------------------------------------------
// Sales orders

const PO_ALIASES = ["PO Number", "P.O. Number", "PO #", "PO"];
const CUSTOMER_ALIASES = ["Customer Name", "Customer", "Bill To Name"];

// Each spreadsheet row is one line item; rows sharing a PO Number and
// Customer Name are combined into a single multi-line sales order. SO
// numbers are always system-assigned at save time (never taken from the
// file), matching how Order Entry works.
export function parseSalesOrders(
  csv: ParsedCsv,
  customers: Customer[],
  items: Item[],
  leadTimeDays: number
): RowResult<PurchaseOrder>[] {
  const customersByName = new Map(customers.map((c) => [key(c.name), c]));
  const itemsByNumber = itemsIndex(items);

  // Rows are grouped by PO #, and additionally by customer only when two
  // customers share a PO # - so a file that names the customer just on an
  // order's first row still groups its lines together.
  const customersPerPo = new Map<string, Set<string>>();
  for (const row of csv.rows) {
    const po = key(field(row, ...PO_ALIASES));
    const cust = key(field(row, ...CUSTOMER_ALIASES));
    if (!po || !cust) continue;
    const set = customersPerPo.get(po) ?? new Set<string>();
    set.add(cust);
    customersPerPo.set(po, set);
  }

  const groups = new Map<string, { rowNumbers: number[]; rows: Record<string, string>[] }>();
  csv.rows.forEach((row, idx) => {
    const rowNumber = rowNumberOf(csv, idx);
    const po = key(field(row, ...PO_ALIASES));
    const sharedPo = (customersPerPo.get(po)?.size ?? 0) > 1;
    const groupKey = !po
      ? `__row_${rowNumber}`
      : sharedPo
        ? `${po}\u0000${key(field(row, ...CUSTOMER_ALIASES))}`
        : po;
    const g = groups.get(groupKey) ?? { rowNumbers: [], rows: [] };
    g.rowNumbers.push(rowNumber);
    g.rows.push(row);
    groups.set(groupKey, g);
  });

  const results: RowResult<PurchaseOrder>[] = [];
  for (const group of groups.values()) {
    const errors: string[] = [];
    const first = group.rows[0];
    const rowNumber = group.rowNumbers[0];
    const base = { rowNumber, rowNumbers: group.rowNumbers, sourceRows: group.rows };

    const poNumber = field(first, ...PO_ALIASES);
    if (!poNumber) errors.push("Missing PO Number");
    const customerName = group.rows.map((r) => field(r, ...CUSTOMER_ALIASES)).find(Boolean) ?? "";
    if (!customerName) errors.push("Missing Customer Name");
    const lineCount = group.rows.length;
    const label = `PO ${poNumber || "(none)"} - ${customerName || "(no customer)"} - ${lineCount} line${lineCount === 1 ? "" : "s"}`;

    const matchedCustomer = customerName ? customersByName.get(key(customerName)) : undefined;

    const multi = group.rows.length > 1;
    const at = (i: number) => (multi ? `Row ${group.rowNumbers[i]}: ` : "");
    const seenLines = new Map<string, number>();
    const lineItems: LineItem[] = [];
    group.rows.forEach((row, i) => {
      // The same line pasted twice would silently double the order.
      const fingerprint = JSON.stringify(Object.values(row));
      const copyOf = seenLines.get(fingerprint);
      if (copyOf !== undefined) {
        errors.push(`Row ${group.rowNumbers[i]} repeats row ${copyOf} exactly - remove the copy or combine the quantities`);
        return;
      }
      seenLines.set(fingerprint, group.rowNumbers[i]);

      const itemNumber = field(row, "Item Number", "Item #", "SKU", "Item");
      const qtyStr = field(row, "Ordered Qty", "Quantity", "Qty", "Ordered");
      if (!itemNumber) {
        errors.push(`${at(i)}Missing Item Number`);
        return;
      }
      if (!qtyStr) {
        errors.push(`${at(i)}Missing Ordered Qty`);
        return;
      }
      const qty = wholeNumber("Ordered Qty", qtyStr, 1);
      if (qty.error) {
        errors.push(`${at(i)}${qty.error}`);
        return;
      }
      const catalogItem = itemsByNumber.get(key(itemNumber));
      const rateStr = field(row, "Rate", "Price", "Unit Price");
      const rate = rateStr ? money("Rate", rateStr, { allowNegative: true }) : { value: catalogItem?.rate ?? 0 };
      if (rate.error) {
        errors.push(`${at(i)}${rate.error}`);
        return;
      }
      lineItems.push({
        id: crypto.randomUUID(),
        item: catalogItem?.itemNumber ?? itemNumber,
        description: field(row, "Description") || catalogItem?.description || "",
        um: field(row, "U/M", "UOM", "Unit") || catalogItem?.um || "EA",
        ordered: qty.value!,
        rate: rate.value!,
      });
    });
    if (lineItems.length === 0 && errors.length === 0) errors.push("No line items");

    const orderDateRaw = field(first, "Order Date");
    const dueDateRaw = field(first, "Due Date");
    const orderDate = orderDateRaw ? normalizeImportDate(orderDateRaw) : localIsoDate();
    const dueDate = dueDateRaw ? normalizeImportDate(dueDateRaw) : orderDate;
    if (!orderDate) errors.push(`Invalid Order Date "${orderDateRaw}" - use YYYY-MM-DD or M/D/YYYY`);
    if (!dueDate && dueDateRaw) errors.push(`Invalid Due Date "${dueDateRaw}" - use YYYY-MM-DD or M/D/YYYY`);

    const taxRateRaw = field(first, "Tax Rate");
    const taxRate = taxRateRaw ? decimal("Tax Rate", taxRateRaw) : { value: 0 };
    if (taxRate.error) errors.push(taxRate.error);

    if (errors.length > 0 || !orderDate || !dueDate) {
      results.push({ ...base, label, errors });
      continue;
    }
    const defaultShipTo = matchedCustomer?.shipToLocations?.[0]?.address;

    const billTo = matchedCustomer
      ? { ...emptyAddress(), ...matchedCustomer.billTo }
      : {
          ...emptyAddress(),
          name: customerName,
          addressLine1: field(first, "Bill To Address", "Address"),
          city: field(first, "Bill To City", "City"),
          state: field(first, "Bill To State", "State"),
          zip: field(first, "Bill To Zip", "Zip"),
        };

    const shipTo = {
      ...emptyAddress(),
      name: field(first, "Ship To Name") || defaultShipTo?.name || billTo.name,
      addressLine1: field(first, "Ship To Address") || defaultShipTo?.addressLine1 || billTo.addressLine1,
      city: field(first, "Ship To City") || defaultShipTo?.city || billTo.city,
      state: field(first, "Ship To State") || defaultShipTo?.state || billTo.state,
      zip: field(first, "Ship To Zip") || defaultShipTo?.zip || billTo.zip,
    };

    const order: PurchaseOrder = {
      soNumber: "",
      poNumber,
      orderDate,
      dueDate,
      customerId: matchedCustomer?.id,
      shipToLocationId: matchedCustomer?.shipToLocations?.[0]?.id,
      billTo,
      shipTo,
      fob: field(first, "FOB") || matchedCustomer?.fob || "",
      shipVia: field(first, "Ship Via") || matchedCustomer?.shipVia || "",
      terms: field(first, "Terms") || matchedCustomer?.terms || "",
      rep: field(first, "Rep") || matchedCustomer?.rep || "",
      taxRate: taxRate.value ?? 0,
      notes: field(first, "Notes"),
      lineItems,
      status: "Entered",
      estimatedShipDate: addBusinessDays(orderDate, leadTimeDays),
      createdAt: new Date().toISOString(),
    };
    results.push({ ...base, label, errors: [], data: order });
  }
  return results;
}

interface OrderSearchResponse {
  rows: PurchaseOrder[];
  total: number;
  page: number;
  pageSize: number;
}

// Existing sales orders carrying this customer PO # (for this customer, when
// the order matched one on file).
export async function searchSalesOrdersByPo(poNumber: string, customerId?: string): Promise<PurchaseOrder[]> {
  const params = new URLSearchParams({ poNumber, pageSize: "5" });
  if (customerId) params.set("customerId", customerId);
  const res = await api.get<OrderSearchResponse>(`/api/sales-orders/search?${params}`);
  if (!res || !Array.isArray(res.rows)) throw new Error("Unexpected response from order search");
  return res.rows;
}

// Marks each importable order that already exists in the system (same
// customer PO # for the same customer) as a duplicate. `unchecked` counts
// orders that couldn't be checked - the search endpoint missing (404) or
// failing - which are left as new so the import still works, but the page
// warns about them.
export async function markExistingOrders(
  results: RowResult<PurchaseOrder>[],
  search: (poNumber: string, customerId?: string) => Promise<PurchaseOrder[]> = searchSalesOrdersByPo,
  concurrency = 4
): Promise<{ results: RowResult<PurchaseOrder>[]; unchecked: number }> {
  const out = results.map((r) => ({ ...r }));
  const todo = out.filter((r) => r.data && r.errors.length === 0 && !r.duplicateReason);
  let unchecked = 0;
  let endpointMissing = false;
  let next = 0;

  async function worker() {
    while (next < todo.length) {
      const r = todo[next++];
      const order = r.data!;
      if (endpointMissing) {
        unchecked++;
        continue;
      }
      try {
        const matches = await search(order.poNumber, order.customerId);
        const hit = matches.find(
          (o) =>
            key(o.poNumber ?? "") === key(order.poNumber) &&
            (order.customerId ? o.customerId === order.customerId : key(o.billTo?.name ?? "") === key(order.billTo.name))
        );
        if (hit) r.duplicateReason = `Already entered as S.O. #${hit.soNumber}`;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) endpointMissing = true;
        unchecked++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return { results: out, unchecked };
}

// ---------------------------------------------------------------------------
// Inventory

// Updates stock levels on EXISTING catalog items (matched by Item Number);
// it never creates new items, since inventory needs a catalog entry first.
// A blank On Hand or On Purchase Order cell leaves that field unchanged,
// so a feed reporting only one of the two doesn't zero out the other.
export function parseInventory(csv: ParsedCsv, items: Item[]): RowResult<Item>[] {
  const itemsByNumber = itemsIndex(items);
  const seen = new Map<string, number>();
  return csv.rows.map((row, idx) => {
    const rowNumber = rowNumberOf(csv, idx);
    const base = { rowNumber, rowNumbers: [rowNumber], sourceRows: [row] };
    const itemNumber = field(row, "Item Number", "Item #", "SKU", "Item");
    const label = itemNumber || "(no item #)";
    if (!itemNumber) return { ...base, label, errors: ["Missing Item Number"] };

    const existing = itemsByNumber.get(key(itemNumber));
    if (!existing) {
      return { ...base, label, errors: [`Unknown Item Number "${itemNumber}" - add it via Items first`] };
    }
    const earlier = seen.get(key(itemNumber));
    if (earlier !== undefined) {
      return { ...base, label, errors: [`Item # ${itemNumber} is also on row ${earlier} - list each item once`] };
    }
    seen.set(key(itemNumber), rowNumber);

    const onHandStr = field(row, "On Hand", "Qty On Hand", "Quantity On Hand", "On-Hand");
    const onPoStr = field(row, "On Purchase Order", "Qty On PO", "On Order", "On PO", "On-Order");
    if (!onHandStr && !onPoStr) return { ...base, label, errors: ["No On Hand or On Purchase Order value"] };
    const onHand = onHandStr ? wholeNumber("On Hand", onHandStr, 0) : { value: existing.qtyOnHand };
    const onPo = onPoStr ? wholeNumber("On Purchase Order", onPoStr, 0) : { value: existing.qtyOnPurchaseOrder };
    const errors = [onHand.error, onPo.error].filter((e): e is string => !!e);
    if (errors.length > 0) return { ...base, label, errors };

    return {
      ...base,
      label,
      errors: [],
      data: { ...existing, qtyOnHand: onHand.value!, qtyOnPurchaseOrder: onPo.value! },
    };
  });
}
