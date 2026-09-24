import type { Customer, Item, LineItem, PurchaseOrder } from "../types";
import { emptyAddress, emptyShippingLocation } from "../types";
import { field, type ParsedCsv } from "./csv";
import { listCustomers } from "./customerStore";
import { addBusinessDays, localIsoDate, normalizeDateInput } from "./dateUtils";
import { itemsIndex, listItems } from "./itemStore";
import { getLeadTimeDays } from "./settingsStore";

export interface RowResult<T> {
  rowNumber: number;
  errors: string[];
  data?: T;
}

function truthy(v: string): boolean {
  return ["yes", "y", "true", "1"].includes(v.trim().toLowerCase());
}

export function parseCustomers(csv: ParsedCsv): RowResult<Customer>[] {
  return csv.rows.map((row, idx) => {
    const rowNumber = idx + 2; // header is row 1
    const name = field(row, "Customer Name", "Name", "Company");
    if (!name) return { rowNumber, errors: ["Missing Customer Name"] };

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
      accountNumber: field(row, "Account Number", "Account #", "Account"),
      billTo,
      shipToLocations: [location],
      terms: field(row, "Terms"),
      shipVia: field(row, "Ship Via", "Shipping Method"),
      fob: field(row, "FOB"),
      rep: field(row, "Rep", "Sales Rep"),
      shipCompleteOnly: truthy(field(row, "Ship Complete Only", "Ship Complete")),
      notes: [],
      createdAt: new Date().toISOString(),
    };
    return { rowNumber, errors: [], data: customer };
  });
}

export function parseItems(csv: ParsedCsv): RowResult<Item>[] {
  return csv.rows.map((row, idx) => {
    const rowNumber = idx + 2;
    const itemNumber = field(row, "Item Number", "Item #", "SKU", "Item");
    if (!itemNumber) return { rowNumber, errors: ["Missing Item Number"] };

    const rateStr = field(row, "Rate", "Price", "Unit Price");
    const rate = rateStr ? Number(rateStr) : 0;
    const onHandStr = field(row, "On Hand", "Qty On Hand", "Quantity On Hand");
    const onHand = onHandStr ? Number(onHandStr) : 0;
    const onPoStr = field(row, "On Purchase Order", "Qty On PO", "On Order");
    const onPo = onPoStr ? Number(onPoStr) : 0;
    const weightStr = field(row, "Weight", "Weight (lbs)", "Unit Weight");
    const weight = weightStr ? Number(weightStr) : undefined;

    const item: Item = {
      id: crypto.randomUUID(),
      itemNumber,
      description: field(row, "Description"),
      um: field(row, "U/M", "UOM", "Unit", "Unit of Measure") || "EA",
      rate: Number.isFinite(rate) ? rate : 0,
      qtyOnHand: Number.isFinite(onHand) ? onHand : 0,
      qtyOnPurchaseOrder: Number.isFinite(onPo) ? onPo : 0,
      weight: weight !== undefined && Number.isFinite(weight) ? weight : undefined,
      createdAt: new Date().toISOString(),
    };
    return { rowNumber, errors: [], data: item };
  });
}

// Each spreadsheet row is one line item; rows sharing a PO Number are
// combined into a single multi-line sales order. SO numbers are always
// system-assigned at save time (never taken from the file), matching how
// Order Entry works.
export async function parseSalesOrders(csv: ParsedCsv): Promise<RowResult<PurchaseOrder>[]> {
  const customers = await listCustomers();
  const itemsByNumber = itemsIndex(await listItems());
  const leadTime = getLeadTimeDays();

  const groups = new Map<string, { rowNumbers: number[]; rows: Record<string, string>[] }>();
  csv.rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const po = field(row, "PO Number", "P.O. Number", "PO #", "PO");
    const key = po || `__row_${rowNumber}`;
    const g = groups.get(key) ?? { rowNumbers: [], rows: [] };
    g.rowNumbers.push(rowNumber);
    g.rows.push(row);
    groups.set(key, g);
  });

  const results: RowResult<PurchaseOrder>[] = [];
  for (const group of groups.values()) {
    const errors: string[] = [];
    const first = group.rows[0];
    const rowNumber = group.rowNumbers[0];

    const poNumber = field(first, "PO Number", "P.O. Number", "PO #", "PO");
    if (!poNumber) errors.push("Missing PO Number");

    const customerName = field(first, "Customer Name", "Customer", "Bill To Name");
    if (!customerName) errors.push("Missing Customer Name");

    const matchedCustomer = customerName
      ? customers.find((c) => c.name.trim().toLowerCase() === customerName.trim().toLowerCase())
      : undefined;

    const lineItems: LineItem[] = [];
    group.rows.forEach((row, i) => {
      const itemNumber = field(row, "Item Number", "Item #", "SKU", "Item");
      const qtyStr = field(row, "Ordered Qty", "Quantity", "Qty", "Ordered");
      const qty = Number(qtyStr);
      if (!itemNumber) {
        errors.push(`Row ${group.rowNumbers[i]}: missing Item Number`);
        return;
      }
      if (!qtyStr || !Number.isInteger(qty) || qty <= 0) {
        errors.push(`Row ${group.rowNumbers[i]}: missing or invalid Ordered Qty (must be a whole number)`);
        return;
      }
      const catalogItem = itemsByNumber.get(itemNumber.trim().toLowerCase());
      const rateStr = field(row, "Rate", "Price", "Unit Price");
      const rate = rateStr ? Number(rateStr) : (catalogItem?.rate ?? 0);
      lineItems.push({
        id: crypto.randomUUID(),
        item: itemNumber,
        description: field(row, "Description") || catalogItem?.description || "",
        um: field(row, "U/M", "UOM", "Unit") || catalogItem?.um || "EA",
        ordered: qty,
        rate: Number.isFinite(rate) ? rate : 0,
      });
    });
    if (lineItems.length === 0) errors.push("No valid line items");

    const orderDateRaw = field(first, "Order Date");
    const dueDateRaw = field(first, "Due Date");
    const orderDate = orderDateRaw ? normalizeDateInput(orderDateRaw) : localIsoDate();
    const dueDate = dueDateRaw ? normalizeDateInput(dueDateRaw) : orderDate;
    if (!orderDate) errors.push(`Invalid Order Date "${orderDateRaw}" - use YYYY-MM-DD or M/D/YYYY`);
    if (!dueDate && dueDateRaw) errors.push(`Invalid Due Date "${dueDateRaw}" - use YYYY-MM-DD or M/D/YYYY`);

    if (errors.length > 0 || !orderDate || !dueDate) {
      results.push({ rowNumber, errors });
      continue;
    }
    const defaultShipTo = matchedCustomer?.shipToLocations[0]?.address;

    const billTo = matchedCustomer
      ? { ...matchedCustomer.billTo }
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
      shipToLocationId: matchedCustomer?.shipToLocations[0]?.id,
      billTo,
      shipTo,
      fob: field(first, "FOB") || matchedCustomer?.fob || "",
      shipVia: field(first, "Ship Via") || matchedCustomer?.shipVia || "",
      terms: field(first, "Terms") || matchedCustomer?.terms || "",
      rep: field(first, "Rep") || matchedCustomer?.rep || "",
      taxRate: Number(field(first, "Tax Rate")) || 0,
      notes: field(first, "Notes"),
      lineItems,
      status: "Entered",
      estimatedShipDate: addBusinessDays(orderDate, leadTime),
      createdAt: new Date().toISOString(),
    };
    results.push({ rowNumber, errors: [], data: order });
  }
  return results;
}

// Updates stock levels on EXISTING catalog items (matched by Item Number);
// it never creates new items, since inventory needs a catalog entry first.
// A blank On Hand or On Purchase Order cell leaves that field unchanged,
// so a feed reporting only one of the two doesn't zero out the other.
export async function parseInventory(csv: ParsedCsv): Promise<RowResult<Item>[]> {
  const itemsByNumber = itemsIndex(await listItems());
  return csv.rows.map((row, idx) => {
    const rowNumber = idx + 2;
    const itemNumber = field(row, "Item Number", "Item #", "SKU", "Item");
    if (!itemNumber) return { rowNumber, errors: ["Missing Item Number"] };

    const existing = itemsByNumber.get(itemNumber.trim().toLowerCase());
    if (!existing) {
      return { rowNumber, errors: [`Unknown Item Number "${itemNumber}" - add it via Items first`] };
    }

    const onHandStr = field(row, "On Hand", "Qty On Hand", "Quantity On Hand", "On-Hand");
    const onPoStr = field(row, "On Purchase Order", "Qty On PO", "On Order", "On PO", "On-Order");
    const onHand = onHandStr ? Number(onHandStr) : existing.qtyOnHand;
    const onPo = onPoStr ? Number(onPoStr) : existing.qtyOnPurchaseOrder;

    if (onHandStr && !Number.isFinite(onHand)) return { rowNumber, errors: ["Invalid On Hand quantity"] };
    if (onPoStr && !Number.isFinite(onPo)) {
      return { rowNumber, errors: ["Invalid On Purchase Order quantity"] };
    }

    return { rowNumber, errors: [], data: { ...existing, qtyOnHand: onHand, qtyOnPurchaseOrder: onPo } };
  });
}
