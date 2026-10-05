// Sprint 1, batch 1: the integrity holes the master review still listed
// (A-13, A-15, A-16, A-17, A-18), the price lock and Import decisions
// (B-06, B-07), and the QuickBooks void of a document that is already gone.
import { beforeEach, describe, expect, it } from "vitest";
import { fakeQuickBooks } from "../src/integrations/quickbooks/fake.js";
import { processOutbox } from "../src/integrations/sync.js";
import { prisma } from "../src/prisma.js";
import {
  admin,
  getOrder,
  allocate,
  as,
  check,
  editOrder,
  editRa,
  expectLedgerReconciles,
  issueInvoiceFor,
  itemByNumber,
  makeCustomer,
  makeItem,
  makeOrder,
  movementsFor,
  ok,
  orderReadyToShip,
  release,
  resetDb,
  ship,
  so,
  undoShipment,
} from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  fakeQuickBooks.reset();
});

async function issueReturn(c: Awaited<ReturnType<typeof admin>>, o: any, item: string, qty: number, restock = true) {
  return ok(
    await c.post("/api/returns", {
      soNumber: String(o.soNumber),
      billTo: o.billTo,
      requestDate: "2026-09-29",
      lines: [{ itemNumber: item, description: "x", qty, rate: 2.5, restock }],
    }),
    201
  );
}
const receiveReturn = (c: Awaited<ReturnType<typeof admin>>, ra: any) => c.post(`/api/returns/${ra.raNumber}/receive`, { version: ra.version, lines: [] });

describe("returns (A-13, A-16)", () => {
  it("counts received returns against the shipped total even after they are closed", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 20 }]);
    o = ok(await ship(root, o));
    const ra = await issueReturn(root, o, "BR-1001", 20);
    const received = ok(await receiveReturn(root, ra));
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(100);
    // Closing the received RA used to free its quantity for a second return.
    const closed = ok(await editRa(root, received, { status: "Closed" }));
    expect(closed.status).toBe("Closed");
    const again = await root.post("/api/returns", {
      soNumber: String(o.soNumber),
      billTo: o.billTo,
      requestDate: "2026-09-29",
      lines: [{ itemNumber: "BR-1001", description: "x", qty: 1, rate: 2.5 }],
    });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/0 returnable/);
    // An RA closed without ever being received does not count.
    const o2 = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 5 }])));
    const abandoned = await issueReturn(root, o2, "BR-1001", 5);
    ok(await editRa(root, abandoned, { status: "Closed" }));
    expect((await issueReturn(root, o2, "BR-1001", 5)).status).toBe("Issued");
    expect(await prisma.creditMemo.count()).toBe(1);
  });

  it("freezes a received return's lines and never reopens a closed one", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10 }])));
    const ra = await issueReturn(root, o, "BR-1001", 4);
    const received = ok(await receiveReturn(root, ra));
    const bumped = await editRa(root, received, { lines: received.lines.map((l: any) => ({ ...l, qty: 9 })) });
    expect(bumped.status).toBe(409);
    expect(bumped.body.error).toMatch(/can't change now/);
    const repriced = await editRa(root, received, { lines: received.lines.map((l: any) => ({ ...l, rate: 99 })) });
    expect(repriced.status).toBe(409);
    // Header fields (notes, reason) may still be corrected.
    const noted = ok(await editRa(root, received, { notes: "customer called" }));
    expect(noted.notes).toBe("customer called");
    const closed = ok(await editRa(root, noted, { status: "Closed" }));
    const reopened = await editRa(root, closed, { status: "Received" });
    expect(reopened.status).toBe(409);
    expect(reopened.body.error).toMatch(/closed/);
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(94);
    await expectLedgerReconciles("BR-1001", 100);
  });
});

describe("undo last shipment (A-15)", () => {
  it("refuses once a received return has put the units back", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10 }])));
    const ra = await issueReturn(root, o, "BR-1001", 10);
    ok(await receiveReturn(root, ra));
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(100);
    const undo = await undoShipment(root, ok(await root.get(so(o))));
    expect(undo.status).toBe(409);
    expect(undo.body.error).toMatch(new RegExp(ra.raNumber));
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(100);
    await expectLedgerReconciles("BR-1001", 100);
  });

  it("refuses once the invoice has reached QuickBooks, until it is voided from Invoices", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10 }])));
    const invoice = await issueInvoiceFor(root, o.soNumber);
    expect((await processOutbox({ limit: 10 })).done).toBeGreaterThan(0);
    o = ok(await root.get(so(o)));
    const blocked = await undoShipment(root, o);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/reached QuickBooks/);
    expect(blocked.body.error).toMatch(invoice.invoiceNumber);
    ok(await root.post(`/api/invoices/${invoice.invoiceNumber}/void`, { reason: "wrong quantities" }));
    o = ok(await root.get(so(o)));
    o = ok(await undoShipment(root, o));
    expect(o.status).toBe("Pick & Packed");
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(100);
    // A shipment that never synced can still be undone directly.
    const o2 = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 3 }])));
    expect((await undoShipment(root, o2)).status).toBe(200);
  });
});

describe("opening stock (A-17)", () => {
  it("writes an OPENING movement so the ledger explains on hand from zero", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 500);
    await makeItem(root, "BR-1002", 0);
    const moves = await movementsFor("BR-1001");
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ reason: "OPENING", delta: 500, qtyAfter: 500, actorUsername: "admin" });
    expect(await movementsFor("BR-1002")).toHaveLength(0);
    const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 20 }])));
    expect(o.status).toBe("Shipped");
    await expectLedgerReconciles("BR-1001", 500);
    await expectLedgerReconciles("BR-1002", 0);
  });
});

describe("bulk release (A-18)", () => {
  it("reports each order's own failure and releases the rest", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const ready = async () => {
      let o = await makeOrder(root, [{ item: "BR-1001", ordered: 5 }]);
      o = ok(await check(root, o));
      return ok(await allocate(root, o));
    };
    const a = await ready();
    const b = await ready();
    const c = await ready();
    const res = await root.post("/api/sales-orders/release", {
      orders: [
        { soNumber: a.soNumber, version: a.version },
        { soNumber: b.soNumber, version: b.version + 7 },
        { soNumber: "not-a-number", version: 1 },
        { soNumber: c.soNumber, version: c.version },
      ],
    });
    expect(res.status).toBe(200);
    const byOrder = new Map(res.body.results.map((r: any) => [r.soNumber, r]));
    expect(byOrder.get(String(a.soNumber))).toMatchObject({ ok: true });
    expect(byOrder.get(String(b.soNumber))).toMatchObject({ ok: false });
    expect(byOrder.get("not-a-number")).toMatchObject({ ok: false });
    expect(byOrder.get(String(c.soNumber))).toMatchObject({ ok: true });
    expect(res.body.orders.map((o: any) => o.status)).toEqual(["Pick & Packed", "Pick & Packed"]);
  });
});

describe("price lock and Import (B-06, B-07)", () => {
  it("lets Import create orders but not edit them", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const importer = await as("importer", { permissions: { import: "edit" } });
    const created = await makeOrder(importer, [{ item: "BR-1001", ordered: 1 }]);
    expect(created.soNumber).toBeDefined();
    // Another account's order: the importer holds no edit page for it.
    const other = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }]);
    const res = await editOrder(importer, other, { notes: "changed by import" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Order Entry/);
  });

  it("locks prices, tax and customer once stock is committed", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const validator = await as("val", { permissions: { validation: "edit" } });
    const entry = await as("entry", { permissions: { "order-entry": "edit" } });
    let o = await makeOrder(root, [{ item: "BR-1001", ordered: 5, rate: 2.5 }]);
    // Before allocation any editor may reprice.
    o = ok(await editOrder(validator, o, { lineItems: o.lineItems.map((l: any) => ({ ...l, rate: 3 })) }));
    // Validation is not a pricing page: the validator's copy has no rates (B-10).
    expect(o.pricesHidden).toBe(true);
    expect(o.lineItems[0].rate).toBeUndefined();
    expect(Number((await getOrder(root, o.soNumber)).lineItems[0].rate)).toBe(3);
    o = ok(await check(root, o));
    o = ok(await allocate(root, o));
    // Allocated: Validation edit is not a pricing page.
    const byValidator = await editOrder(validator, o, { lineItems: o.lineItems.map((l: any) => ({ ...l, rate: 4 })) });
    expect(byValidator.status).toBe(403);
    expect(byValidator.body.error).toMatch(/allocated order/);
    const taxByValidator = await editOrder(validator, o, { taxRate: 8 });
    expect(taxByValidator.status).toBe(403);
    // Non-price header edits still go through.
    o = ok(await editOrder(validator, o, { notes: "dock 4" }));
    // Order Entry may reprice, and it is audited old to new.
    o = ok(await editOrder(entry, o, { lineItems: o.lineItems.map((l: any) => ({ ...l, rate: 4 })) }));
    expect(Number(o.lineItems[0].rate)).toBe(4);
    // The audit row for a header or line edit is written after the response
    // (logAudit), so wait for the one that records the price change rather
    // than reading whichever ORDER_UPDATED row landed last.
    await expect
      .poll(async () => {
        const rows = await prisma.auditLog.findMany({ where: { action: "ORDER_UPDATED", targetId: String(o.soNumber) } });
        return rows.some((a) => JSON.stringify(a.detail).includes('"from":"3"'));
      }, { timeout: 3000 })
      .toBe(true);
    // Released: nobody, not even admin.
    o = ok(await release(root, o));
    const released = await editOrder(root, o, { lineItems: o.lineItems.map((l: any) => ({ ...l, rate: 5 })) });
    expect(released.status).toBe(409);
    expect(released.body.error).toMatch(/locked/);
    const customerChange = await editOrder(root, o, { customerId: null, notes: "x" });
    // No customer to begin with, so this is not a change - allowed.
    expect(customerChange.status).toBe(200);
  });
});

describe("customer delete and inactive flag (A-14)", () => {
  it("refuses to delete a customer with history and hides an inactive one from the pickers", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const cust = await makeCustomer(root, "Acme Fabrication");
    const fresh = await makeCustomer(root, "Never Ordered Inc");
    await makeOrder(root, [{ item: "BR-1001", ordered: 1 }], { customerId: cust.id });
    const refused = await root.del(`/api/customers/${cust.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/1 order/);
    expect(refused.body.error).toMatch(/inactive/i);
    expect(await prisma.customer.count({ where: { id: cust.id } })).toBe(1);
    // Mark inactive: the row stays, its summary says so, orders keep it.
    const detail = ok(await root.get(`/api/customers/${cust.id}`));
    const retired = ok(await root.put(`/api/customers/${cust.id}`, { ...detail, active: false }));
    expect(retired.active).toBe(false);
    const summaries = ok(await root.get("/api/customers?summary=1"));
    expect(summaries.find((c: any) => c.id === cust.id)?.active).toBe(false);
    expect((await prisma.salesOrder.findFirstOrThrow()).customerId).toBe(cust.id);
    // A customer with no history can still be deleted outright.
    expect((await root.del(`/api/customers/${fresh.id}`)).status).toBe(204);
  });
});

describe("idempotent creates (A-21)", () => {
  it("answers a repeated create with the first result, per account and per kind", async () => {
    const root = await admin();
    const other = await as("other", { permissions: { "order-entry": "edit", returns: "edit", "purchase-orders": "edit" } });
    await makeItem(root, "BR-1001", 100);
    const body = {
      poNumber: "PO-1",
      orderDate: "2026-09-29",
      dueDate: "2026-10-01",
      billTo: { name: "A", addressLine1: "1 St", city: "C", state: "IL", zip: "60000" },
      shipTo: { name: "A", addressLine1: "1 St", city: "C", state: "IL", zip: "60000" },
      taxRate: 0,
      lineItems: [{ item: "BR-1001", description: "x", um: "EA", ordered: 1, rate: 2.5 }],
    };
    const post = (c: any, key: string, b: unknown = body) => c.post("/api/sales-orders", b, { "Idempotency-Key": key });
    const first = await post(root, "draft-1");
    expect(first.status).toBe(201);
    const again = await post(root, "draft-1");
    expect(again.status).toBe(201);
    expect(again.body.soNumber).toBe(first.body.soNumber);
    expect(await prisma.salesOrder.count()).toBe(1);
    // Same key, different account: a different order.
    const theirs = await post(other, "draft-1");
    expect(theirs.status).toBe(201);
    expect(theirs.body.soNumber).not.toBe(first.body.soNumber);
    // A rejected request is replayed as rejected; a fresh key is a fresh try.
    const bad = await post(root, "draft-2", { ...body, lineItems: [{ ...body.lineItems[0], item: "NOPE-1" }] });
    expect(bad.status).toBe(400);
    expect((await post(root, "draft-2", body)).status).toBe(400);
    expect((await post(root, "draft-3", body)).status).toBe(201);
    expect(await prisma.salesOrder.count()).toBe(3);
    // Returns and POs have their own key space.
    const raBody = { soNumber: String(first.body.soNumber), billTo: body.billTo, requestDate: "2026-09-29", lines: [] };
    const ra1 = await root.post("/api/returns", raBody, { "Idempotency-Key": "draft-1" });
    const ra2 = await root.post("/api/returns", raBody, { "Idempotency-Key": "draft-1" });
    expect(ra1.status).toBe(201);
    expect(ra2.body.raNumber).toBe(ra1.body.raNumber);
    expect(await prisma.returnAuthorization.count()).toBe(1);
  });
});

describe("shipments endpoint (C-09)", () => {
  it("lists one row per shipment with totals, and marks the undoable one", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100, 2);
    await makeItem(root, "BR-1002", 100, 3);
    const cust = await makeCustomer(root, "Acme Fabrication");
    let o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10, rate: 2 }, { item: "BR-1002", ordered: 4, rate: 3 }], { customerId: cust.id });
    o = ok(await ship(root, o, [6, 4]));
    expect(o.status).toBe("Backordered");
    // Round two for the rest.
    o = ok(await allocate(root, o, [4, 0]));
    o = ok(await release(root, o, [4, 0]));
    o = ok(await root.post(`${so(o)}/mark-printed`, { version: o.version, pickList: true, packingSlip: true }));
    o = ok(await ship(root, o));
    expect(o.status).toBe("Shipped");
    const day = new Date().toISOString().slice(0, 10);
    const res = ok(await root.get(`/api/shipments?from=${day}&to=${day}`));
    expect(res.total).toBe(2);
    expect(res.rows.map((r: any) => r.units)).toEqual([4, 10]);
    expect(res.rows[0].isLatest).toBe(true);
    expect(res.rows[1].isLatest).toBe(false);
    expect(res.rows[1].lines.map((l: any) => `${l.item}x${l.qty}`)).toEqual(["BR-1001x6", "BR-1002x4"]);
    expect(res.rows[0].invoiceStatus).toBe("DRAFT");
    expect(res.rows[0].invoiceId).toBeTruthy();
    expect(res.rows[0].invoiceNumber).toBeNull();
    expect(res.totals).toMatchObject({ shipments: 2, units: 14, amount: "32.00", complete: true });
    // Search by customer and by P.O.; an empty range.
    expect(ok(await root.get(`/api/shipments?q=acme`)).total).toBe(2);
    expect(ok(await root.get(`/api/shipments?q=${o.poNumber}`)).total).toBe(2);
    expect(ok(await root.get(`/api/shipments?q=nobody`)).total).toBe(0);
    expect(ok(await root.get(`/api/shipments?from=2020-01-01&to=2020-01-02`)).total).toBe(0);
    // Needs a page that can see shipments.
    const nobody = await as("nobody", { permissions: { "order-entry": "edit" } });
    expect((await nobody.get(`/api/shipments`)).status).toBe(403);
  });
});

describe("date validation (C-15)", () => {
  it("refuses a blank or half-typed date with a field error instead of a 500", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const o = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }]);
    for (const dueDate of ["", "0002-10-01", "2026-13-40", "next week"]) {
      const res = await editOrder(root, o, { dueDate });
      expect(res.status, dueDate).toBe(400);
      expect(JSON.stringify(res.body.error), dueDate).toMatch(/dueDate/);
    }
    // The full timestamp a record round-trips with is fine.
    expect((await editOrder(root, o, { dueDate: "2026-10-05T00:00:00.000Z" })).status).toBe(200);
    const shipDate = await root.post(`${so(o)}/set-ship-date`, { version: o.version + 1, estimatedShipDate: "0002-1" });
    expect(shipDate.status).toBe(400);
  });
});

describe("paged PO and return lists (D-06)", () => {
  it("pages and searches on the server, and still answers the plain list", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const vendor = ok(await root.post("/api/vendors", { name: "Rope Supply Co", contactName: "Rep", phone: "555", email: "rep@example.com", address: { name: "Rope Supply Co", addressLine1: "1 St", city: "C", state: "IL", zip: "60000" } }), 201);
    for (let i = 0; i < 3; i++) {
      ok(await root.post("/api/vendor-purchase-orders", { vendorId: vendor.id, vendorName: vendor.name, orderDate: "2026-09-29", lines: [{ itemNumber: "BR-1001", description: "x", orderedQty: 10, cost: 1 }], status: "Open", notes: "" }), 201);
    }
    const page1 = ok(await root.get("/api/vendor-purchase-orders?page=1&pageSize=2"));
    expect(page1.total).toBe(3);
    expect(page1.rows).toHaveLength(2);
    const page2 = ok(await root.get("/api/vendor-purchase-orders?page=2&pageSize=2"));
    expect(page2.rows).toHaveLength(1);
    expect(ok(await root.get("/api/vendor-purchase-orders?page=1&q=rope")).total).toBe(3);
    expect(ok(await root.get("/api/vendor-purchase-orders?page=1&q=nobody")).total).toBe(0);
    expect(Array.isArray(ok(await root.get("/api/vendor-purchase-orders")))).toBe(true);

    const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 5 }])));
    const ra = await issueReturn(root, o, "BR-1001", 1);
    const ras = ok(await root.get(`/api/returns?page=1&q=${ra.raNumber}`));
    expect(ras.total).toBe(1);
    expect(ok(await root.get(`/api/returns?page=1&q=${o.soNumber}`)).total).toBe(1);
    expect(ok(await root.get(`/api/returns?page=1&q=zzz`)).total).toBe(0);
    expect(Array.isArray(ok(await root.get("/api/returns")))).toBe(true);
  });
});

describe("QuickBooks void of a document that no longer exists", () => {
  it("completes the outbox row instead of leaving it dead", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const shipped = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 2 }])));
    const invoice = await issueInvoiceFor(root, shipped.soNumber);
    expect((await processOutbox({ limit: 10 })).done).toBeGreaterThan(0);
    // QuickBooks "loses" the invoice (a deleted sandbox company, say).
    fakeQuickBooks.reset();
    ok(await root.post(`/api/invoices/${invoice.invoiceNumber}/void`, { reason: "duplicate" }));
    const summary = await processOutbox({ limit: 10 });
    expect(summary.dead).toBe(0);
    expect(summary.failed).toBe(0);
    const row = await prisma.syncOutbox.findFirstOrThrow({ where: { entityType: "invoice", action: "VOID" } });
    expect(row.status).toBe("DONE");
    const log = await prisma.syncLog.findFirst({ where: { entityId: invoice.invoiceNumber, ok: true }, orderBy: { createdAt: "desc" } });
    expect(log?.message).toMatch(/no longer exists/);
  });
});
