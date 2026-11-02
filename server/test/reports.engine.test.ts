import { beforeAll, describe, expect, it } from "vitest";
import { fakeQuickBooks } from "../src/integrations/quickbooks/fake.js";
import { previousPeriod, resolveRange } from "../src/lib/reports/dates.js";
import { prisma } from "../src/prisma.js";
import { admin, as, issueInvoiceFor, makeCustomer, makeItem, makePo, makeVendor, ok, orderReadyToShip, receive, resetDb, ship, type Client } from "./helpers.js";

// The report engine over one seeded scene (sources share it, so the whole
// file seeds once):
//   Acme: S.O. A = 10 x BR-1001 @ 2.50, 4 shipped and invoiced (10.00);
//         a return of 2 received and credited at the invoiced 2.50 (5.00)
//   Baker: S.O. B = 3 x BR-1002 @ 4.00, not shipped
//   PO to Rope Supply: 50 x BR-1001 @ 1.00 + 20 x BR-1002 @ 2.00, 30 received
//   BR-1001 opened at 100 on hand, BR-1002 at 50.
let root: Client;
let soA: number;
let soB: number;
let poNumber: string;

const run = (c: Client, spec: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  c.post("/api/reports/run", { spec: { dateRange: { preset: "all" }, ...spec }, tzOffset: 0, ...extra });

const rowsByDim = (res: any, dim: string) => Object.fromEntries(res.rows.map((r: any) => [r.dims[dim], r.cells]));

beforeAll(async () => {
  await resetDb();
  fakeQuickBooks.reset();
  root = await admin();
  await makeItem(root, "BR-1001", 100, 2.5);
  await makeItem(root, "BR-1002", 50, 4);
  const acme = await makeCustomer(root, "Acme Fabrication");
  const baker = await makeCustomer(root, "Baker Marine");
  let a = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10, rate: 2.5 }], { customerId: acme.id, rep: "JD", shipVia: "UPS" });
  a = ok(await ship(root, a, [4]));
  soA = Number(a.soNumber);
  await issueInvoiceFor(root, soA);
  const b = await orderReadyToShip(root, [{ item: "BR-1002", ordered: 3, rate: 4 }], { customerId: baker.id, rep: "KL", shipVia: "FedEx" });
  soB = Number(b.soNumber);
  const ra = ok(await root.post("/api/returns", { customerId: acme.id, soNumber: String(soA), billTo: acme.billTo, requestDate: "2026-10-05", lines: [{ itemNumber: "BR-1001", description: "x", qty: 2, rate: 2.5, restock: true, reason: "Damaged" }] }), 201);
  ok(await root.post(`/api/returns/${ra.raNumber}/receive`, { version: ra.version, lines: [] }));
  const vendor = await makeVendor(root, "Rope Supply Co");
  const po = await makePo(root, vendor, [{ itemNumber: "BR-1001", orderedQty: 50, cost: 1 }, { itemNumber: "BR-1002", orderedQty: 20, cost: 2 }]);
  poNumber = po.poNumber;
  const qtys = po.lines.map((l: any) => (l.itemNumber === "BR-1001" ? 30 : 0));
  ok(await receive(root, po, qtys));
});

describe("report engine: one source at a time, totals by hand", () => {
  it("sales-order-lines by customer", async () => {
    const res = ok(await run(root, { source: "sales-order-lines", kind: "summary", measures: ["qtyOrdered", "qtyShipped", "qtyRemaining", "amount", "orders"], rows: ["customer"] }));
    const by = rowsByDim(res, "customer");
    expect(by["Acme Fabrication"]).toEqual({ qtyOrdered: 10, qtyShipped: 4, qtyRemaining: 6, amount: 25, orders: 1 });
    expect(by["Baker Marine"]).toEqual({ qtyOrdered: 3, qtyShipped: 0, qtyRemaining: 3, amount: 12, orders: 1 });
    expect(res.total).toEqual({ qtyOrdered: 13, qtyShipped: 4, qtyRemaining: 9, amount: 37, orders: 2 });
    expect(res.columns.map((c: any) => c.key)).toEqual(["qtyOrdered", "qtyShipped", "qtyRemaining", "amount", "orders"]);
  });

  it("sales-order-lines displayed by item with a row total per customer, and subtotals when nested", async () => {
    const pivot = ok(await run(root, { source: "sales-order-lines", measures: ["amount"], rows: ["customer"], columns: { by: "item" } }));
    expect(pivot.columns.map((c: any) => c.key)).toEqual(["amount|BR-1001", "amount|BR-1002", "amount|total"]);
    expect(rowsByDim(pivot, "customer")["Acme Fabrication"]).toEqual({ "amount|BR-1001": 25, "amount|BR-1002": null, "amount|total": 25 });
    expect(pivot.total).toEqual({ "amount|BR-1001": 25, "amount|BR-1002": 12, "amount|total": 37 });

    const nested = ok(await run(root, { source: "sales-order-lines", measures: ["amount", "orders"], rows: ["rep", "customer"] }));
    expect(nested.rows.map((r: any) => [r.dims.rep, r.dims.customer, r.cells.amount])).toEqual([["JD", "Acme Fabrication", 25], ["KL", "Baker Marine", 12]]);
    expect(nested.subtotals).toEqual([
      { dims: { rep: "JD" }, cells: { amount: 25, orders: 1 } },
      { dims: { rep: "KL" }, cells: { amount: 12, orders: 1 } },
    ]);
  });

  it("sales-order-lines detail pages, links each row to its order and subtotals the group", async () => {
    const page1 = ok(await run(root, { source: "sales-order-lines", kind: "detail", rows: ["customer"], fields: ["soNumber", "item", "qtyOrdered", "amount"] }, { pageSize: 1, page: 1 }));
    expect(page1).toMatchObject({ kind: "detail", page: 1, pageSize: 1, totalRows: 2, truncated: true });
    expect(page1.rows[0]).toMatchObject({ dims: { customer: "Acme Fabrication" }, cells: { soNumber: String(soA), item: "BR-1001", qtyOrdered: 10, amount: 25 }, link: `/storage/${soA}` });
    expect(page1.subtotals).toEqual([
      { dims: { customer: "Acme Fabrication" }, cells: { qtyOrdered: 10, amount: 25, _count: 1 } },
      { dims: { customer: "Baker Marine" }, cells: { qtyOrdered: 3, amount: 12, _count: 1 } },
    ]);
    expect(page1.total).toEqual({ qtyOrdered: 13, amount: 37, _count: 2 });
    const page2 = ok(await run(root, { source: "sales-order-lines", kind: "detail", rows: ["customer"], fields: ["soNumber", "item", "qtyOrdered", "amount"] }, { pageSize: 1, page: 2 }));
    expect(page2.rows[0].cells.soNumber).toBe(String(soB));
    expect(page2.truncated).toBe(false);
  });

  it("shipments by day and by carrier", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = ok(await run(root, { source: "shipments", measures: ["units", "shipments", "amount"], rows: ["day"] }));
    expect(rowsByDim(res, "day")[today]).toEqual({ units: 4, shipments: 1, amount: 10 });
    const detail = ok(await run(root, { source: "shipments", kind: "detail", fields: ["soNumber", "item", "units", "amount"] }));
    expect(detail.rows).toHaveLength(1);
    expect(detail.rows[0]).toMatchObject({ cells: { soNumber: String(soA), item: "BR-1001", units: 4, amount: 10 }, link: `/storage/${soA}` });
  });

  it("invoice-lines: the issued invoice for the shipment", async () => {
    const res = ok(await run(root, { source: "invoice-lines", measures: ["qty", "amount", "documents"], rows: ["customer"], filters: [{ field: "status", op: "equals", value: "ISSUED" }] }));
    expect(rowsByDim(res, "customer")).toEqual({ "Acme Fabrication": { qty: 4, amount: 10, documents: 1 } });
    const detail = ok(await run(root, { source: "invoice-lines", kind: "detail", fields: ["number", "item", "qty", "amount"] }));
    expect(detail.rows[0]).toMatchObject({ cells: { number: "INV-20001", item: "BR-1001", qty: 4, amount: 10 }, link: "/invoices/INV-20001" });
  });

  it("credit-memo-lines: the draft memo for the received return, priced from the invoice", async () => {
    const res = ok(await run(root, { source: "credit-memo-lines", measures: ["qty", "amount", "documents"], rows: ["status"] }));
    expect(rowsByDim(res, "status")).toEqual({ DRAFT: { qty: 2, amount: 5, documents: 1 } });
    expect(res.labels.status.DRAFT).toBe("Draft");
    const detail = ok(await run(root, { source: "credit-memo-lines", kind: "detail", fields: ["number", "raNumber", "qty", "amount"] }));
    expect(detail.rows[0].cells).toMatchObject({ number: "Draft", qty: 2, amount: 5 });
    expect(detail.rows[0].link).toMatch(/^\/invoices\/credit-memos\/[0-9a-f-]{36}$/);
  });

  it("purchase-order-lines by vendor and by item", async () => {
    const res = ok(await run(root, { source: "purchase-order-lines", measures: ["qtyOrdered", "qtyReceived", "qtyOutstanding", "cost", "outstandingValue", "pos"], rows: ["vendor"] }));
    expect(rowsByDim(res, "vendor")).toEqual({ "Rope Supply Co": { qtyOrdered: 70, qtyReceived: 30, qtyOutstanding: 40, cost: 90, outstandingValue: 60, pos: 1 } });
    const byItem = ok(await run(root, { source: "purchase-order-lines", measures: ["qtyOutstanding", "outstandingValue"], rows: ["item"] }));
    expect(rowsByDim(byItem, "item")).toEqual({ "BR-1001": { qtyOutstanding: 20, outstandingValue: 20 }, "BR-1002": { qtyOutstanding: 20, outstandingValue: 40 } });
    const detail = ok(await run(root, { source: "purchase-order-lines", kind: "detail", fields: ["poNumber", "item", "qtyOrdered"] }));
    expect(detail.rows[0].link).toBe(`/purchase-orders/${poNumber}`);
  });

  it("receipts by vendor", async () => {
    const res = ok(await run(root, { source: "receipts", measures: ["units", "cost", "receipts"], rows: ["vendor"] }));
    expect(rowsByDim(res, "vendor")).toEqual({ "Rope Supply Co": { units: 30, cost: 30, receipts: 1 } });
  });

  it("stock-movements by reason reconcile to the ledger", async () => {
    const res = ok(await run(root, { source: "stock-movements", measures: ["unitsIn", "unitsOut", "net", "movements"], rows: ["reason"] }));
    const by = rowsByDim(res, "reason");
    expect(by.OPENING).toEqual({ unitsIn: 150, unitsOut: 0, net: 150, movements: 2 });
    expect(by.SHIP).toEqual({ unitsIn: 0, unitsOut: 4, net: -4, movements: 1 });
    expect(by.RECEIVE_PO).toEqual({ unitsIn: 30, unitsOut: 0, net: 30, movements: 1 });
    expect(by.RETURN).toEqual({ unitsIn: 2, unitsOut: 0, net: 2, movements: 1 });
    const onHand = await prisma.item.aggregate({ _sum: { qtyOnHand: true } });
    expect(res.total.net).toBe(onHand._sum.qtyOnHand);
    const detail = ok(await run(root, { source: "stock-movements", kind: "detail", filters: [{ field: "reason", op: "equals", value: "SHIP" }] }));
    expect(detail.rows[0]).toMatchObject({ cells: { item: "BR-1001", delta: -4, reference: String(soA) }, link: `/storage/${soA}` });
  });

  it("inventory: on hand, on sales order, allocated, available, on PO, value", async () => {
    const res = ok(await run(root, { source: "inventory", measures: ["onHand", "onSalesOrder", "reserved", "available", "onPurchaseOrder", "valueAtRate", "valueAtCost"], rows: ["item"] }));
    const by = rowsByDim(res, "item");
    // 100 + 30 received - 4 shipped + 2 returned; 6 still owed on S.O. A; cost 1.00 from the receipt.
    expect(by["BR-1001"]).toEqual({ onHand: 128, onSalesOrder: 6, reserved: 0, available: 128, onPurchaseOrder: 20, valueAtRate: 320, valueAtCost: 128 });
    // S.O. B is released with its 3 allocated; no cost known yet.
    expect(by["BR-1002"]).toEqual({ onHand: 50, onSalesOrder: 3, reserved: 3, available: 47, onPurchaseOrder: 20, valueAtRate: 200, valueAtCost: 0 });
    const detail = ok(await run(root, { source: "inventory", kind: "detail", fields: ["item", "onHand"] }));
    expect(detail.rows[0].link).toMatch(/^\/items\//);
  });

  it("returns by customer", async () => {
    const res = ok(await run(root, { source: "returns", measures: ["qty", "qtyRestocked", "amount", "returns"], rows: ["customer"] }));
    expect(rowsByDim(res, "customer")).toEqual({ "Acme Fabrication": { qty: 2, qtyRestocked: 2, amount: 5, returns: 1 } });
    const detail = ok(await run(root, { source: "returns", kind: "detail", fields: ["raNumber", "reason", "qty"] }));
    expect(detail.rows[0].cells).toMatchObject({ reason: "Damaged", qty: 2 });
    expect(detail.rows[0].link).toMatch(/^\/returns\/RA-/);
  });

  it("customers and vendors as contact lists", async () => {
    const customers = ok(await run(root, { source: "customers", kind: "detail", fields: ["name", "city", "state"], sort: { by: "name", dir: "asc" } }));
    expect(customers.rows.map((r: any) => r.cells.name)).toEqual(["Acme Fabrication", "Baker Marine"]);
    expect(customers.rows[0].cells).toMatchObject({ city: "Manteno", state: "IL" });
    expect(customers.total).toEqual({ _count: 2 });
    const vendors = ok(await run(root, { source: "vendors", kind: "detail" }));
    expect(vendors.rows[0].cells).toMatchObject({ name: "Rope Supply Co", phone: "555" });
    expect(vendors.rows[0].link).toMatch(/^\/vendors\//);
    const byState = ok(await run(root, { source: "customers", measures: ["customers"], rows: ["state"] }));
    expect(rowsByDim(byState, "state")).toEqual({ IL: { customers: 2 } });
  });
});

describe("report engine: filters, visibility, dates and limits", () => {
  it("applies every filter operator", async () => {
    const spec = (filters: unknown[]) => ({ source: "sales-order-lines", measures: ["orders"], rows: [], filters });
    expect(ok(await run(root, spec([{ field: "customer", op: "contains", value: "acme" }]))).total.orders).toBe(1);
    expect(ok(await run(root, spec([{ field: "customer", op: "in", values: ["Acme Fabrication", "Baker Marine"] }]))).total.orders).toBe(2);
    expect(ok(await run(root, spec([{ field: "rep", op: "equals", value: "KL" }]))).total.orders).toBe(1);
    expect(ok(await run(root, spec([{ field: "qtyOrdered", op: "gte", value: "10" }]))).total.orders).toBe(1);
    expect(ok(await run(root, spec([{ field: "qtyOrdered", op: "between", values: ["1", "5"] }]))).total.orders).toBe(1);
    expect(ok(await run(root, spec([{ field: "shipToState", op: "isEmpty" }]))).total.orders).toBe(0);
    expect((await run(root, spec([{ field: "nope", op: "equals", value: "x" }]))).status).toBe(400);
  });

  it("leaves money out for a login that may not see prices, and cost for one that may not see cost", async () => {
    const dock = await as("dockhand", { permissions: { reports: "view", "shipment-history": "view", inventory: "view" } });
    const summary = ok(await run(dock, { source: "sales-order-lines", measures: ["qtyOrdered", "amount", "cost", "margin"], rows: ["customer"] }));
    expect(summary.columns.map((c: any) => c.key)).toEqual(["qtyOrdered"]);
    expect(summary.hidden).toEqual(["amount", "cost", "margin"]);
    expect(summary.rows[0].cells).toEqual({ qtyOrdered: 10 });
    const detail = ok(await run(dock, { source: "sales-order-lines", kind: "detail" }));
    expect(detail.columns.map((c: any) => c.key)).not.toContain("rate");
    expect(detail.columns.map((c: any) => c.key)).not.toContain("amount");
    expect(JSON.stringify(detail.rows)).not.toMatch(/"rate"|"amount"|"cost"/);
    // Order Entry sees prices but not cost.
    const office = await as("clerk", { permissions: { reports: "view", "order-entry": "view" } });
    const priced = ok(await run(office, { source: "sales-order-lines", measures: ["amount", "cost"], rows: [] }));
    expect(priced.total).toEqual({ amount: 37 });
    expect(priced.hidden).toEqual(["cost"]);
    // A login with none of the source's pages is refused.
    expect((await run(office, { source: "purchase-order-lines", measures: ["pos"], rows: [] })).status).toBe(403);
    const sources = ok(await office.get("/api/reports/sources")).map((s: any) => s.key);
    expect(sources).toContain("sales-order-lines");
    expect(sources).not.toContain("purchase-order-lines");
  });

  it("resolves date presets on the browser's calendar day", () => {
    // 03:00 UTC on 31 Oct is still 30 Oct in Chicago (offset 300) and already 31 Oct in Sydney (-660).
    const at = new Date("2026-10-31T03:00:00Z");
    expect(resolveRange({ preset: "today" }, 300, at)).toEqual({ from: "2026-10-30", to: "2026-10-30" });
    expect(resolveRange({ preset: "today" }, -660, at)).toEqual({ from: "2026-10-31", to: "2026-10-31" });
    expect(resolveRange({ preset: "yesterday" }, 300, at)).toEqual({ from: "2026-10-29", to: "2026-10-29" });
    expect(resolveRange({ preset: "this-week" }, 300, at)).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(resolveRange({ preset: "last-week" }, 300, at)).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(resolveRange({ preset: "this-month" }, 300, at)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolveRange({ preset: "this-month-to-date" }, 300, at)).toEqual({ from: "2026-10-01", to: "2026-10-30" });
    expect(resolveRange({ preset: "last-month" }, 300, at)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolveRange({ preset: "this-quarter" }, 300, at)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(resolveRange({ preset: "last-quarter" }, 300, at)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(resolveRange({ preset: "this-year" }, 300, at)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(resolveRange({ preset: "this-year-to-date" }, 300, at)).toEqual({ from: "2026-01-01", to: "2026-10-30" });
    expect(resolveRange({ preset: "last-year" }, 300, at)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(resolveRange({ preset: "last-30-days" }, 300, at)).toEqual({ from: "2026-10-01", to: "2026-10-30" });
    expect(resolveRange({ preset: "last-90-days" }, -660, at)).toEqual({ from: "2026-08-03", to: "2026-10-31" });
    expect(resolveRange({ preset: "last-365-days" }, 0, at)).toEqual({ from: "2025-11-01", to: "2026-10-31" });
    expect(resolveRange({ preset: "all" }, 300, at)).toEqual({ from: null, to: null });
    expect(resolveRange({ preset: "custom", from: "2026-01-05", to: "2026-01-09" }, 300, at)).toEqual({ from: "2026-01-05", to: "2026-01-09" });
    expect(previousPeriod({ from: "2026-10-01", to: "2026-10-31" })).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousPeriod({ from: "2026-10-05", to: "2026-10-11" })).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("buckets timestamps by the local day the offset describes", async () => {
    // Pick an offset that puts the browser on a different calendar day from UTC right now.
    const now = new Date();
    const offset = now.getUTCHours() < 12 ? 13 * 60 : -13 * 60;
    const localDay = new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
    const utcDay = now.toISOString().slice(0, 10);
    expect(localDay).not.toBe(utcDay);
    const byDay = ok(await run(root, { source: "shipments", measures: ["units"], rows: ["day"], dateRange: { preset: "today" } }, { tzOffset: offset }));
    expect(byDay.range).toEqual({ from: localDay, to: localDay });
    expect(rowsByDim(byDay, "day")).toEqual({ [localDay]: { units: 4 } });
    // The UTC day, asked for as a custom range at that offset, holds nothing.
    const utcRange = ok(await run(root, { source: "shipments", measures: ["units"], rows: [], dateRange: { preset: "custom", from: utcDay, to: utcDay } }, { tzOffset: offset }));
    expect(utcRange.total.units).toBe(0);
    expect(ok(await run(root, { source: "shipments", measures: ["units"], rows: [], dateRange: { preset: "yesterday" } }, { tzOffset: offset })).total.units).toBe(0);
  });

  it("compares with the previous period and shows % of column", async () => {
    const res = ok(await run(root, { source: "sales-order-lines", measures: ["amount"], rows: ["customer"], dateRange: { preset: "custom", from: "2026-09-01", to: "2026-09-30" }, subColumns: ["previousPeriod", "pctOfColumn"] }));
    expect(res.columns.map((c: any) => c.key)).toEqual(["amount", "amount~previousPeriod", "amount~pctOfColumn"]);
    const acme = rowsByDim(res, "customer")["Acme Fabrication"];
    expect(acme).toEqual({ amount: 25, "amount~previousPeriod": null, "amount~pctOfColumn": 67.6 });
    expect(res.total).toEqual({ amount: 37, "amount~previousPeriod": 0, "amount~pctOfColumn": 100 });
  });

  it("refuses a row dimension with more than 20,000 groups", async () => {
    await prisma.$executeRaw`INSERT INTO "Item" ("id", "itemNumber", "description", "updatedAt")
      SELECT gen_random_uuid()::text, 'BULK-' || g, 'bulk', now() FROM generate_series(1, 20001) g`;
    try {
      const res = await run(root, { source: "inventory", measures: ["onHand"], rows: ["item"] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/more than 20,000 rows of Item/);
      // Totaling by something broader still answers.
      expect(ok(await run(root, { source: "inventory", measures: ["items"], rows: ["um"] })).total.items).toBe(20003);
    } finally {
      await prisma.item.deleteMany({ where: { description: "bulk" } });
    }
  });

  it("answers identical requests from the cache for a minute", async () => {
    const spec = { source: "customers", measures: ["customers"], rows: ["rep"] };
    const a = ok(await run(root, spec));
    const b = ok(await run(root, spec));
    expect(b.generatedAt).toBe(a.generatedAt);
  });
});

describe("standard report catalog", () => {
  it("offers every standard report to admin and each one runs", async () => {
    const catalog = ok(await root.get("/api/reports/catalog"));
    expect(catalog.map((r: any) => r.key)).toEqual([
      "sales-by-customer-summary", "sales-by-customer-detail", "sales-by-item-summary", "sales-by-item-detail", "sales-by-rep-summary",
      "open-sales-orders-by-customer", "open-sales-orders-by-item", "backorders-by-item", "shipments-by-day",
      "invoice-register", "credit-memo-register",
      "purchases-by-vendor-summary", "purchases-by-vendor-detail", "open-purchase-orders-by-vendor", "open-purchase-orders-by-item", "receipts-by-vendor",
      "inventory-stock-status-by-item", "inventory-valuation-summary", "item-stock-movement",
      "customer-contact-list", "vendor-contact-list",
    ]);
    for (const r of catalog) {
      const res = await run(root, { ...r.spec, dateRange: { preset: "all" } });
      expect(res.status, `${r.key}: ${JSON.stringify(res.body)}`).toBe(200);
    }
    const sales = catalog.find((r: any) => r.key === "sales-by-customer-summary");
    expect(sales).toMatchObject({ area: "Sales", defaultPreset: "this-month-to-date", spec: { source: "invoice-lines", rows: ["customer"] } });
    const result = ok(await run(root, { ...sales.spec, dateRange: { preset: "all" } }));
    expect(rowsByDim(result, "customer")).toEqual({ "Acme Fabrication": { qty: 4, amount: 10 } });
  });

  it("offers only the areas whose sources the account may read", async () => {
    const buyer = await as("buyer", { permissions: { reports: "view", "purchase-orders": "view", vendors: "view" } });
    const areas = new Set(ok(await buyer.get("/api/reports/catalog")).map((r: any) => r.area));
    // Reports access itself grants reading orders (lib/orderView.ts ORDER_READ_PAGES), so Orders comes with it.
    expect([...areas].sort()).toEqual(["Inventory", "Lists", "Orders", "Purchasing"]);
    const keys = ok(await buyer.get("/api/reports/catalog")).map((r: any) => r.key);
    expect(keys).toContain("vendor-contact-list");
    expect(keys).not.toContain("customer-contact-list");
    expect(keys).not.toContain("sales-by-customer-summary");
    const none = await as("nobody", { permissions: { reports: "view" } });
    expect(new Set(ok(await none.get("/api/reports/catalog")).map((r: any) => r.area))).toEqual(new Set(["Orders"]));
    const noReports = await as("floor", { permissions: { dock: "view" } });
    expect((await noReports.get("/api/reports/catalog")).status).toBe(403);
  });
});

describe("report center preferences", () => {
  it("keeps favorites and the newest dozen recent reports per account", async () => {
    const me = await as("analyst", { permissions: { reports: "view" } });
    expect(ok(await me.get("/api/reports/preferences"))).toEqual({ favorites: [], recent: [] });
    expect(ok(await me.post("/api/reports/preferences/favorite", { ref: "shipments-by-day", on: true })).favorites).toEqual(["shipments-by-day"]);
    expect(ok(await me.post("/api/reports/preferences/favorite", { ref: "saved:abc", on: true })).favorites).toEqual(["saved:abc", "shipments-by-day"]);
    expect(ok(await me.post("/api/reports/preferences/favorite", { ref: "saved:abc", on: false })).favorites).toEqual(["shipments-by-day"]);
    for (let i = 0; i < 14; i++) expect((await me.post("/api/reports/preferences/recent", { ref: `r-${i}` })).status).toBe(204);
    const prefs = ok(await me.get("/api/reports/preferences"));
    expect(prefs.recent).toHaveLength(12);
    expect(prefs.recent[0].ref).toBe("r-13");
    // Another account sees its own, empty, list.
    expect(ok(await root.get("/api/reports/preferences"))).toEqual({ favorites: [], recent: [] });
  });
});
