import { beforeEach, describe, expect, it } from "vitest";
import { fakeQuickBooks } from "../src/integrations/quickbooks/fake.js";
import { processOutbox, reconcileInvoices } from "../src/integrations/sync.js";
import { termsDays } from "../src/lib/money.js";
import { prisma } from "../src/prisma.js";
import { admin, as, editOrder, makeCustomer, makeItem, makeOrder, ok, orderReadyToShip, resetDb, ship, so, undoShipment } from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  fakeQuickBooks.reset();
});

describe("invoices", () => {
  it("raises one invoice per shipment, priced from the order, to the cent", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100, 2.5);
    await makeItem(root, "BR-1002", 100, 0.3333);
    const cust = await makeCustomer(root, "Acme Fabrication", { terms: "Net 45" });
    let o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10, rate: 2.5 }, { item: "BR-1002", ordered: 7, rate: 0.3333 }]);
    o = ok(await root.put(so(o), { ...o, taxRate: 6.25, customerId: cust.id, terms: "Net 45", lineItems: o.lineItems.map((l: any) => ({ ...l, rate: Number(l.rate) })) }));
    // Ship 4 of the first line and all of the second.
    o = ok(await ship(root, o, [4, 7]));
    const invoices = await prisma.invoice.findMany({ include: { lines: true } });
    expect(invoices).toHaveLength(1);
    const inv = invoices[0];
    expect(inv.invoiceNumber).toBe("INV-20001");
    expect(inv.soNumber).toBe(Number(o.soNumber));
    expect(inv.customerId).toBe(cust.id);
    expect(inv.customerName).toBe("Acme Fabrication");
    expect(inv.status).toBe("ISSUED");
    // 4 x 2.50 = 10.00; 7 x 0.3333 = 2.3331 -> 2.33 (rounded per line)
    expect(inv.lines.map((l) => l.amount.toString()).sort()).toEqual(["10", "2.33"]);
    expect(inv.subtotal.toString()).toBe("12.33");
    // 6.25% of 12.33 = 0.770625 -> 0.77
    expect(inv.tax.toString()).toBe("0.77");
    expect(inv.total.toString()).toBe("13.1");
    // Due 45 days after the invoice date.
    expect((inv.dueDate.getTime() - inv.invoiceDate.getTime()) / 86_400_000).toBe(45);
    expect(inv.shipmentRecordId).toBe(o.shipmentHistory[0].id);
    // Queued for QuickBooks in the same transaction.
    const outbox = await prisma.syncOutbox.findMany();
    expect(outbox.map((r) => [r.entityType, r.entityId, r.action, r.status])).toEqual([["invoice", "INV-20001", "UPSERT", "PENDING"]]);

    // The second shipment gets its own invoice.
    o = ok(await root.post(`${so(o)}/allocate`, { version: o.version, lines: [{ lineItemId: o.lineItems[0].id, allocatedQty: 6 }, { lineItemId: o.lineItems[1].id, allocatedQty: 0 }], shipCompleteOnly: false }));
    o = ok(await root.post("/api/sales-orders/release", { orders: [{ soNumber: o.soNumber, version: o.version }] })).orders[0];
    o = ok(await root.post(`${so(o)}/mark-printed`, { version: o.version, pickList: true, packingSlip: true }));
    o = ok(await ship(root, o));
    const second = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNumber: "INV-20002" }, include: { lines: true } });
    expect(second.lines).toHaveLength(1);
    expect(second.subtotal.toString()).toBe("15");
  });

  it("charges no tax to an exempt customer", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const cust = await makeCustomer(root, "Reseller Inc", { taxExempt: true });
    let o = await makeOrder(root, [{ item: "BR-1001", ordered: 2, rate: 10 }], { customerId: cust.id, taxRate: 8 });
    o = ok(await root.post(`${so(o)}/check`, { version: o.version }));
    o = ok(await root.post(`${so(o)}/allocate`, { version: o.version, lines: [{ lineItemId: o.lineItems[0].id, allocatedQty: 2 }] }));
    o = ok(await root.post("/api/sales-orders/release", { orders: [{ soNumber: o.soNumber, version: o.version }] })).orders[0];
    o = ok(await root.post(`${so(o)}/mark-printed`, { version: o.version, pickList: true, packingSlip: true }));
    o = ok(await ship(root, o));
    const inv = await prisma.invoice.findFirstOrThrow();
    expect(inv.taxRate.toString()).toBe("0");
    expect(inv.tax.toString()).toBe("0");
    expect(inv.total.toString()).toBe("20");
  });

  it("voids the invoice when the shipment is undone, and a void supersedes a pending push", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 3 }]);
    o = ok(await ship(root, o));
    o = ok(await undoShipment(root, o));
    const inv = await prisma.invoice.findFirstOrThrow();
    expect(inv.status).toBe("VOID");
    expect(inv.voidedBy).toBe("admin");
    expect(inv.voidReason).toBe("Shipment undone");
    expect(inv.shipmentRecordId).toBeNull();
    const outbox = await prisma.syncOutbox.findMany({ orderBy: { createdAt: "asc" } });
    expect(outbox.map((r) => [r.action, r.status])).toEqual([["UPSERT", "DONE"], ["VOID", "PENDING"]]);
    // Never reached QuickBooks, so the void is a no-op there.
    const run = await processOutbox();
    expect(run.done).toBe(1);
    expect(fakeQuickBooks.invoices.size).toBe(0);
    // Re-shipping raises a fresh invoice number; the void one stays on record.
    o = ok(await ship(root, o));
    expect((await prisma.invoice.findMany()).map((i) => [i.invoiceNumber, i.status]).sort()).toEqual([["INV-20001", "VOID"], ["INV-20002", "ISSUED"]]);
  });

  it("is readable and voidable through the API by the invoices page only", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 3 }]);
    o = ok(await ship(root, o));
    const viewer = await as("viewer", { permissions: { invoices: "view" } });
    const nobody = await as("nobody", { permissions: { "open-orders": "view" } });
    const list = ok(await viewer.get("/api/invoices?q=INV-20001"));
    expect(list.total).toBe(1);
    expect(list.rows[0].sync.status).toBe("PENDING");
    ok(await viewer.get("/api/invoices/INV-20001"));
    expect((await nobody.get("/api/invoices")).status).toBe(403);
    expect((await viewer.post("/api/invoices/INV-20001/void", { reason: "wrong price" })).status).toBe(403);
    const voided = ok(await root.post("/api/invoices/INV-20001/void", { reason: "wrong price" }));
    expect(voided.status).toBe("VOID");
    expect((await root.post("/api/invoices/INV-20001/void", { reason: "again" })).status).toBe(409);
    // The shipment itself stands.
    expect((await prisma.shipmentRecord.count())).toBe(1);
    expect(ok(await root.get(so(o))).status).toBe("Shipped");
  });
});

describe("credit memos", () => {
  it("credits a received return at the price the invoice charged", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100, 2.5);
    let o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10, rate: 4.75 }]);
    o = ok(await root.put(so(o), { ...o, taxRate: 5, lineItems: o.lineItems.map((l: any) => ({ ...l, rate: Number(l.rate) })) }));
    o = ok(await ship(root, o));
    // The RA is written at the catalog price; the credit uses the invoiced one.
    const ra = ok(
      await root.post("/api/returns", { soNumber: String(o.soNumber), billTo: o.billTo, requestDate: "2026-09-29", reason: "damaged", lines: [{ itemNumber: "BR-1001", description: "x", qty: 3, rate: 2.5, restock: false }] }),
      201
    );
    expect(await prisma.creditMemo.count()).toBe(0);
    const received = ok(await root.post(`/api/returns/${ra.raNumber}/receive`, { version: ra.version, lines: [] }));
    expect(received.status).toBe("Received");
    const memo = await prisma.creditMemo.findFirstOrThrow({ include: { lines: true } });
    expect(memo.creditMemoNumber).toBe("CM-30001");
    expect(memo.raNumber).toBe(ra.raNumber);
    expect(memo.lines[0].rate.toString()).toBe("4.75");
    expect(memo.lines[0].invoiceNumber).toBe("INV-20001");
    expect(memo.subtotal.toString()).toBe("14.25");
    expect(memo.tax.toString()).toBe("0.71");
    expect(memo.total.toString()).toBe("14.96");
    // Not restocked, still credited.
    expect((await prisma.item.findUniqueOrThrow({ where: { itemNumber: "BR-1001" } })).qtyOnHand).toBe(90);
    const list = ok(await root.get("/api/invoices/credit-memos"));
    expect(list.total).toBe(1);
    ok(await root.get(`/api/invoices/credit-memos/CM-30001`));
  });
});

describe("QuickBooks bridge", () => {
  async function shippedInvoice(root: Awaited<ReturnType<typeof admin>>, customerId?: string) {
    let o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 2, rate: 10 }, { item: "BR-1002", ordered: 1, rate: 5 }]);
    if (customerId) o = ok(await editOrder(root, o, { customerId }));
    o = ok(await ship(root, o));
    return prisma.invoice.findFirstOrThrow({ where: { soNumber: Number(o.soNumber) } });
  }

  it("pushes customer and items before the invoice, idempotently", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    await makeItem(root, "BR-1002", 100);
    const cust = await makeCustomer(root, "Acme Fabrication");
    const inv = await shippedInvoice(root, cust.id);
    const run = await processOutbox();
    expect(run).toMatchObject({ attempted: 1, done: 1, failed: 0, dead: 0 });
    expect(fakeQuickBooks.customers.size).toBe(1);
    expect(fakeQuickBooks.items.size).toBe(2);
    expect(fakeQuickBooks.invoices.size).toBe(1);
    const qbInv = [...fakeQuickBooks.invoices.values()][0].data;
    expect(qbInv.docNumber).toBe(inv.invoiceNumber);
    expect(qbInv.total).toBe(25);
    expect(qbInv.lines.map((l) => l.amount).sort((a, b) => a - b)).toEqual([5, 20]);
    const refs = await prisma.externalRef.findMany({ orderBy: { entityType: "asc" } });
    expect(refs.map((r) => r.entityType).sort()).toEqual(["customer", "invoice", "item", "item"]);
    const log = await prisma.syncLog.findMany();
    expect(log).toHaveLength(1);
    expect(log[0].ok).toBe(true);

    // A second invoice for the same customer reuses the QuickBooks records.
    const before = fakeQuickBooks.calls.length;
    await shippedInvoice(root, cust.id);
    await processOutbox();
    expect(fakeQuickBooks.customers.size).toBe(1);
    expect(fakeQuickBooks.items.size).toBe(2);
    expect(fakeQuickBooks.invoices.size).toBe(2);
    // The customer was updated by id, not searched for by name again.
    expect(fakeQuickBooks.calls.slice(before).filter((c) => c.startsWith("upsertCustomer"))).toHaveLength(1);
    // Running again with nothing queued does nothing.
    expect(await processOutbox()).toMatchObject({ attempted: 0 });
  });

  it("invoices a walk-in customer under the bill-to name", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    await makeItem(root, "BR-1002", 100);
    await shippedInvoice(root);
    await processOutbox();
    const qbCustomer = [...fakeQuickBooks.customers.values()][0].data;
    expect(qbCustomer.displayName).toBe("Acme Fabrication");
    const ref = await prisma.externalRef.findFirst({ where: { entityType: "customer" } });
    expect(ref!.entityId).toBe("name:acme fabrication");
  });

  it("retries with backoff, gives up on a permanent error, and can be requeued", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    await makeItem(root, "BR-1002", 100);
    const inv = await shippedInvoice(root);
    fakeQuickBooks.failNext(1);
    const t0 = new Date(Date.now() + 1000);
    let run = await processOutbox({ now: t0 });
    expect(run).toMatchObject({ attempted: 1, failed: 1, done: 0 });
    let row = await prisma.syncOutbox.findFirstOrThrow({ where: { entityId: inv.invoiceNumber } });
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/unavailable/);
    // Not due yet a minute early; due after the first backoff.
    expect(await processOutbox({ now: new Date(t0.getTime() + 30_000) })).toMatchObject({ attempted: 0 });
    run = await processOutbox({ now: new Date(t0.getTime() + 61_000) });
    expect(run).toMatchObject({ attempted: 1, done: 1 });
    expect(fakeQuickBooks.invoices.size).toBe(1);
    expect((await prisma.syncLog.findMany()).map((l) => l.ok)).toEqual([false, true]);

    // A permanent error (bad data QuickBooks rejects) is DEAD at once, and a
    // retry by hand requeues it.
    const inv2 = await shippedInvoice(root);
    fakeQuickBooks.failNext(1, true);
    run = await processOutbox();
    expect(run.dead).toBe(1);
    row = await prisma.syncOutbox.findFirstOrThrow({ where: { entityId: inv2.invoiceNumber } });
    expect(row.status).toBe("DEAD");
    expect(row.lastError).toMatch(/Business Validation/);
    // Not retried on its own, however long we wait.
    expect(await processOutbox({ now: new Date(Date.now() + 365 * 86_400_000) })).toMatchObject({ attempted: 0 });
    const retry = ok(await root.post("/api/integrations/quickbooks/retry", { ids: [row.id] }));
    expect(retry).toMatchObject({ requeued: 1, done: 1 });
    expect((await prisma.syncOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("DONE");
  });

  it("voids in QuickBooks what was voided here, and reconciles both sides", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    await makeItem(root, "BR-1002", 100);
    const inv = await shippedInvoice(root);
    await processOutbox();
    const qbId = [...fakeQuickBooks.invoices.keys()][0];
    ok(await root.post(`/api/invoices/${inv.invoiceNumber}/void`, { reason: "duplicate" }));
    const run = await processOutbox();
    expect(run.done).toBe(1);
    expect(fakeQuickBooks.invoices.get(qbId)!.voided).toBe(true);

    // Reconcile: a second invoice that never made it, and one QuickBooks has that we don't.
    const inv2 = await shippedInvoice(root);
    fakeQuickBooks.invoices.set("999", { id: "999", syncToken: 0, data: { docNumber: "INV-99999", customerRefId: "1", txnDate: new Date().toISOString().slice(0, 10), dueDate: "", lines: [], totalTax: 0, total: 42 } });
    const today = new Date().toISOString().slice(0, 10);
    const report = await reconcileInvoices(today, today);
    expect(report.missingInQuickBooks.map((m) => m.invoiceNumber)).toEqual([inv2.invoiceNumber]);
    expect(report.missingInQuickBooks[0].syncStatus).toBe("PENDING");
    expect(report.missingHere.map((m) => m.docNumber)).toEqual(["INV-99999"]);
    expect(report.voidMismatch).toEqual([]);
    const viaApi = ok(await root.get(`/api/integrations/quickbooks/reconcile?from=${today}&to=${today}`));
    expect(viaApi.ours).toBe(2);
    const status = ok(await root.get("/api/integrations/quickbooks/status"));
    expect(status.connected).toBe(true);
    expect(status.fake).toBe(true);
    expect(status.queue.pending).toBe(1);
  });

  it("pushes a credit memo, and customer edits flow to QuickBooks once it knows the customer", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    await makeItem(root, "BR-1002", 100);
    const cust = await makeCustomer(root, "Acme Fabrication");
    // Editing an unsynced customer queues nothing.
    ok(await root.put(`/api/customers/${cust.id}`, { ...cust, rep: "JD", priceOverrides: [], partNumberMap: [], notes: [] }));
    expect(await prisma.syncOutbox.count({ where: { entityType: "customer" } })).toBe(0);
    const inv = await shippedInvoice(root, cust.id);
    await processOutbox();
    const ra = ok(await root.post("/api/returns", { customerId: cust.id, soNumber: String(inv.soNumber), billTo: cust.billTo, requestDate: "2026-09-29", lines: [{ itemNumber: "BR-1001", description: "x", qty: 1, rate: 1 }] }), 201);
    ok(await root.post(`/api/returns/${ra.raNumber}/receive`, { version: ra.version, lines: [] }));
    const run = await processOutbox();
    expect(run.done).toBe(1);
    expect(fakeQuickBooks.creditMemos.size).toBe(1);
    expect([...fakeQuickBooks.creditMemos.values()][0].data.total).toBe(10);
    // Now a customer edit is pushed.
    const fresh = ok(await root.get(`/api/customers/${cust.id}`));
    ok(await root.put(`/api/customers/${cust.id}`, { ...fresh, name: "Acme Fabrication LLC", priceOverrides: [], partNumberMap: [], notes: [] }));
    expect(await prisma.syncOutbox.count({ where: { entityType: "customer", status: "PENDING" } })).toBe(1);
    await processOutbox();
    expect([...fakeQuickBooks.customers.values()][0].data.displayName).toBe("Acme Fabrication LLC");
    expect(fakeQuickBooks.customers.size).toBe(1);
  });
});

describe("terms parsing", () => {
  it("reads the common formats", () => {
    expect(termsDays("Net 30")).toBe(30);
    expect(termsDays("net45")).toBe(45);
    expect(termsDays("2% 10 Net 30")).toBe(30);
    expect(termsDays("Due on receipt")).toBe(0);
    expect(termsDays("COD")).toBe(0);
    expect(termsDays("")).toBe(30);
    expect(termsDays("whatever")).toBe(30);
  });
});
