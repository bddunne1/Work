// Sprint 2: the fixes reported after sprint 1 went live, then the invoice
// review queue and the reservation table.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";
import { fakeQuickBooks } from "../src/integrations/quickbooks/fake.js";
import { processOutbox } from "../src/integrations/sync.js";
import { readFileSync } from "node:fs";
import { admin, allocate, as, cancel, check, editItem, getOrder, issueInvoiceFor, itemByNumber, makeCustomer, makeItem, makeOrder, makePo, makeVendor, markPrinted, ok, orderReadyToShip, receive, release, resetDb, ship, so, unallocate, undoShipment } from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  fakeQuickBooks.reset();
});

describe("estimated ship date at creation", () => {
  it("is the order date plus the standard lead time in business days", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    // 2026-09-29 is a Tuesday; five business days later is Tuesday 2026-10-06.
    const o = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }], { orderDate: "2026-09-29", dueDate: "2026-10-20" });
    expect(String(o.estimatedShipDate).slice(0, 10)).toBe("2026-10-06");
    // The estimate the client used to send is ignored; the setting rules.
    const sent = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }], { orderDate: "2026-10-01", dueDate: "2026-10-20", estimatedShipDate: "2026-12-25" });
    expect(String(sent.estimatedShipDate).slice(0, 10)).toBe("2026-10-08");
    // Lead time from Settings: 0 days ships the same day; a Friday plus 1 is Monday.
    await root.put("/api/settings/lead_time_days", { value: 0 });
    const sameDay = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }], { orderDate: "2026-10-02", dueDate: "2026-10-20" });
    expect(String(sameDay.estimatedShipDate).slice(0, 10)).toBe("2026-10-02");
    await root.put("/api/settings/lead_time_days", { value: 1 });
    const monday = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }], { orderDate: "2026-10-02", dueDate: "2026-10-20" });
    expect(String(monday.estimatedShipDate).slice(0, 10)).toBe("2026-10-05");
    expect(await prisma.salesOrder.count({ where: { estimatedShipDate: null } })).toBe(0);
  });
});

describe("invoice review queue", () => {
  const draftFor = async (c: any, soNumber: any) => ok(await c.get(`/api/invoices?soNumber=${soNumber}&status=DRAFT`)).rows[0];
  // Decimal columns come back as strings; a reviewer's screen sends numbers.
  const asInput = (lines: any[]) => lines.map((l) => ({ id: l.id, kind: l.kind, item: l.item, description: l.description, qty: l.qty, rate: Number(l.rate), taxable: l.taxable }));

  it("holds a shipment's invoice as a draft, oldest first, until it is reviewed and issued with freight", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100, 2.5);
    const cust = await makeCustomer(root, "Acme Fabrication");
    const first = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10, rate: 2.5 }], { customerId: cust.id, taxRate: 6.25 })));
    const second = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 4, rate: 2.5 }], { customerId: cust.id })));
    const queue = ok(await root.get("/api/invoices?status=DRAFT"));
    expect(queue.total).toBe(2);
    expect(queue.rows.map((r: any) => r.soNumber)).toEqual([Number(first.soNumber), Number(second.soNumber)]);
    expect(queue.rows[0].sync.status).toBe("DRAFT");
    expect(ok(await root.get("/api/invoices/queue"))).toMatchObject({ invoices: 2, creditMemos: 0 });
    expect(ok(await root.get("/api/invoices?status=ISSUED")).total).toBe(0);

    // Review: freight (not taxed), a taxable handling charge, and a repriced line.
    let draft = await draftFor(root, first.soNumber);
    expect(draft.total).toBe("26.56"); // 25.00 + 6.25%
    const item = draft.lines[0];
    draft = ok(
      await root.put(`/api/invoices/${draft.id}`, {
        version: draft.version,
        notes: "Freight per UPS quote",
        lines: [
          { id: item.id, kind: "ITEM", item: item.item, description: item.description, qty: item.qty, rate: 2.4, taxable: true },
          { kind: "CHARGE", item: "FREIGHT", description: "UPS Ground, 2 cartons", qty: 1, rate: 18.5, taxable: false },
          { kind: "CHARGE", item: "HANDLING", description: "Crating", qty: 1, rate: 10, taxable: true },
        ],
      })
    );
    expect(draft.status).toBe("DRAFT");
    expect(draft.invoiceNumber).toBeNull();
    expect(draft.lines.map((l: any) => [l.kind, l.item, l.amount])).toEqual([["ITEM", "BR-1001", "24"], ["CHARGE", "FREIGHT", "18.5"], ["CHARGE", "HANDLING", "10"]]);
    expect(draft.subtotal).toBe("52.5");
    // Tax on 24.00 + 10.00 only: 2.125 -> 2.13
    expect(draft.tax).toBe("2.13");
    expect(draft.total).toBe("54.63");
    expect(draft.notes).toBe("Freight per UPS quote");
    expect(draft.version).toBe(2);

    // A stale version, a changed quantity and a bad charge are refused.
    expect((await root.put(`/api/invoices/${draft.id}`, { version: 1, lines: asInput(draft.lines) })).status).toBe(409);
    expect((await root.put(`/api/invoices/${draft.id}`, { version: 2, lines: [{ ...asInput(draft.lines)[0], qty: 9 }] })).status).toBe(409);
    expect((await root.put(`/api/invoices/${draft.id}`, { version: 2, lines: [asInput(draft.lines)[0], { kind: "CHARGE", item: "FREIGHT", description: "x", qty: 1, rate: -5, taxable: false }] })).status).toBe(400);
    expect((await root.put(`/api/invoices/${draft.id}`, { version: 2, lines: [asInput(draft.lines)[0], { kind: "CHARGE", item: "TIP", description: "x", qty: 1, rate: 5, taxable: false }] })).status).toBe(400);

    // Issue: number assigned, pushed to QuickBooks with the charge lines.
    const issued = ok(await root.post(`/api/invoices/${draft.id}/issue`, { version: draft.version }));
    expect(issued.invoiceNumber).toBe("INV-20001");
    expect(issued.status).toBe("ISSUED");
    expect(issued.approvedBy).toBe("admin");
    expect(issued.total).toBe("54.63");
    expect((await root.post(`/api/invoices/${draft.id}/issue`, { version: issued.version })).status).toBe(409);
    expect((await root.put(`/api/invoices/INV-20001`, { version: issued.version, lines: asInput(issued.lines) })).status).toBe(409);
    expect(ok(await root.get("/api/invoices/INV-20001")).id).toBe(draft.id);
    const run = await processOutbox();
    expect(run).toMatchObject({ done: 1, failed: 0, dead: 0 });
    const qb = [...fakeQuickBooks.invoices.values()][0].data;
    expect(qb.docNumber).toBe("INV-20001");
    expect(qb.total).toBe(54.63);
    expect(qb.lines.map((l: any) => l.amount).sort((a: number, b: number) => a - b)).toEqual([10, 18.5, 24]);
    // The queue moves on; the second draft is next and gets the next number.
    expect(ok(await root.get("/api/invoices/queue"))).toMatchObject({ invoices: 1 });
    expect((await issueInvoiceFor(root, second.soNumber)).invoiceNumber).toBe("INV-20002");
  });

  it("removes a draft when its shipment is undone, without burning a number", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 2 }])));
    const draft = await draftFor(root, o.soNumber);
    expect((await root.post(`/api/invoices/${draft.id}/void`, { reason: "x" })).status).toBe(409);
    o = ok(await undoShipment(root, o));
    expect((await root.get(`/api/invoices/${draft.id}`)).status).toBe(404);
    expect(await prisma.invoice.count()).toBe(0);
    o = ok(await ship(root, o));
    expect((await issueInvoiceFor(root, o.soNumber)).invoiceNumber).toBe("INV-20001");
  });

  it("reviews a credit memo the same way, with a deduction, and keeps the review behind the invoices page", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100, 3);
    const cust = await makeCustomer(root, "Acme Fabrication");
    const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10, rate: 3 }], { customerId: cust.id })));
    await issueInvoiceFor(root, o.soNumber);
    const ra = ok(await root.post("/api/returns", { customerId: cust.id, soNumber: String(o.soNumber), billTo: cust.billTo, requestDate: "2026-09-29", lines: [{ itemNumber: "BR-1001", description: "x", qty: 4, rate: 1, restock: true }] }), 201);
    ok(await root.post(`/api/returns/${ra.raNumber}/receive`, { version: ra.version, lines: [] }));
    let memo = ok(await root.get(`/api/invoices/credit-memos?status=DRAFT`)).rows[0];
    expect(memo.creditMemoNumber).toBeNull();
    expect(memo.lines[0].rate).toBe("3");
    expect(memo.lines[0].invoiceNumber).toBe("INV-20001");
    expect(memo.total).toBe("12");
    expect(ok(await root.get("/api/invoices/queue"))).toMatchObject({ invoices: 0, creditMemos: 1 });
    const viewer = await as("viewer", { permissions: { invoices: "view" } });
    expect((await viewer.put(`/api/invoices/credit-memos/${memo.id}`, { version: memo.version, lines: asInput(memo.lines) })).status).toBe(403);
    expect((await viewer.post(`/api/invoices/credit-memos/${memo.id}/issue`, { version: memo.version })).status).toBe(403);
    // A 15% restocking deduction.
    memo = ok(await root.put(`/api/invoices/credit-memos/${memo.id}`, { version: memo.version, lines: [...asInput(memo.lines), { kind: "CHARGE", item: "DEDUCTION", description: "Restocking 15%", qty: 1, rate: -1.8, taxable: false }] }));
    expect(memo.subtotal).toBe("10.2");
    expect(memo.total).toBe("10.2");
    expect((await root.put(`/api/invoices/credit-memos/${memo.id}`, { version: memo.version, lines: [...asInput(memo.lines).filter((l: any) => l.kind === "ITEM"), { kind: "CHARGE", item: "DEDUCTION", description: "too much", qty: 1, rate: -50, taxable: false }] })).status).toBe(400);
    const issued = ok(await root.post(`/api/invoices/credit-memos/${memo.id}/issue`, { version: memo.version }));
    expect(issued.creditMemoNumber).toBe("CM-30001");
    expect(ok(await root.get(`/api/invoices/credit-memos/CM-30001`)).id).toBe(memo.id);
    const run = await processOutbox();
    expect(run).toMatchObject({ failed: 0, dead: 0 });
    expect(fakeQuickBooks.creditMemos.size).toBe(1);
    expect([...fakeQuickBooks.creditMemos.values()][0].data.total).toBe(10.2);
    expect(ok(await root.get(so(o))).status).toBe("Shipped");
  });
});

describe("reservation table", () => {
  const reserved = async (itemNumber: string) => (await itemByNumber(itemNumber))!.qtyReserved;
  const rowsFor = (soNumber: any) => prisma.allocation.findMany({ where: { soNumber: Number(soNumber) }, orderBy: { qty: "asc" } });
  // The invariant every step must leave true: each item's qtyReserved is the
  // sum of its Allocation rows, and every row belongs to an order that holds.
  async function expectConsistent() {
    const items = await prisma.item.findMany({ include: { allocations: true } });
    for (const i of items) expect(i.qtyReserved, `${i.itemNumber} qtyReserved`).toBe(i.allocations.reduce((s, a) => s + a.qty, 0));
    const orders = await prisma.salesOrder.findMany({ include: { allocations: true } });
    for (const o of orders) if (!["ALLOCATED", "BACKORDERED", "PICK_PACKED"].includes(o.status)) expect(o.allocations, `S.O. ${o.soNumber} ${o.status} holds stock`).toEqual([]);
  }

  it("keeps Item.qtyReserved in step with every order step, and refuses an allocation the column says is not free", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 10);
    await makeItem(root, "BR-2002", 3);
    expect(await reserved("BR-1001")).toBe(0);
    let a = ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 6 }, { item: "BR-2002", ordered: 2 }])));
    let b = ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 6 }])));
    a = ok(await allocate(root, a));
    expect(await reserved("BR-1001")).toBe(6);
    expect(await reserved("BR-2002")).toBe(2);
    expect((await rowsFor(a.soNumber)).map((r) => [r.lineItemId, r.qty])).toEqual([[a.lineItems[1].id, 2], [a.lineItems[0].id, 6]]);
    // Only 4 left: the check reads the column, not every open order.
    const short = await allocate(root, b);
    expect(short.status).toBe(409);
    expect(short.body.shortages).toEqual(["BR-1001: 4 available, 6 requested"]);
    b = ok(await allocate(root, b, [4]));
    expect(await reserved("BR-1001")).toBe(10);
    // Revising downwards frees the difference; revising back up is checked against everyone else.
    a = ok(await allocate(root, a, [5, 2]));
    expect(await reserved("BR-1001")).toBe(9);
    expect((await allocate(root, a, [6, 2])).status).toBe(200);
    a = await getOrder(root, a.soNumber);
    expect(await reserved("BR-1001")).toBe(10);
    // Release moves the hold from allocated to staged - same total.
    a = ok(await release(root, a));
    expect(await reserved("BR-1001")).toBe(10);
    // Trimming the pick at print time drops what the floor can't fill.
    a = ok(await markPrinted(root, a, [{ lineItemId: a.lineItems[0].id, qty: 5 }]));
    expect(await reserved("BR-1001")).toBe(9);
    expect(await reserved("BR-2002")).toBe(2);
    // Shipping takes the units out of on hand and out of the hold together.
    a = ok(await ship(root, a));
    expect(a.status).toBe("Backordered");
    expect((await itemByNumber("BR-1001"))!).toMatchObject({ qtyOnHand: 5, qtyReserved: 4 });
    expect((await itemByNumber("BR-2002"))!).toMatchObject({ qtyOnHand: 1, qtyReserved: 0 });
    expect(await rowsFor(a.soNumber)).toEqual([]);
    // Undo puts them back on hand and back on hold, as a staged pick.
    a = ok(await undoShipment(root, a));
    expect(a.status).toBe("Pick & Packed");
    expect((await itemByNumber("BR-1001"))!).toMatchObject({ qtyOnHand: 10, qtyReserved: 9 });
    expect((await rowsFor(a.soNumber)).map((r) => r.qty)).toEqual([2, 5]);
    a = ok(await ship(root, a));
    // Unallocate and cancel both let go of everything the order held.
    b = ok(await unallocate(root, b));
    expect(await reserved("BR-1001")).toBe(0);
    b = ok(await allocate(root, b, [4]));
    expect(await reserved("BR-1001")).toBe(4);
    b = ok(await cancel(root, b));
    expect(await reserved("BR-1001")).toBe(0);
    // A hold (allocating nothing) reserves nothing.
    let c = ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 2 }])));
    c = ok(await allocate(root, c, [0]));
    expect(c.status).toBe("Backordered");
    expect(await reserved("BR-1001")).toBe(0);
    await expectConsistent();
  });

  it("releases the remainder of a partial shipment back to the queue with nothing held (A-07)", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 10);
    await makeItem(root, "BR-2002", 5);
    let a = ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 10 }, { item: "BR-2002", ordered: 5 }])));
    a = ok(await allocate(root, a));
    // Release the first line only; the second stays allocated while the pick is out.
    a = ok(await release(root, a, [10, 0]));
    expect(a.pickPackStatus).toBe("Partial");
    expect(await reserved("BR-1001")).toBe(10);
    expect(await reserved("BR-2002")).toBe(5);
    a = ok(await markPrinted(root, a));
    a = ok(await ship(root, a));
    expect(a.status).toBe("Backordered");
    expect(a.allocation).toBeNull();
    expect((await itemByNumber("BR-1001"))!).toMatchObject({ qtyOnHand: 0, qtyReserved: 0 });
    expect((await itemByNumber("BR-2002"))!).toMatchObject({ qtyOnHand: 5, qtyReserved: 0 });
    // Those 5 are free for whoever needs them first...
    let b = ok(await check(root, await makeOrder(root, [{ item: "BR-2002", ordered: 5 }])));
    b = ok(await allocate(root, b));
    expect(await reserved("BR-2002")).toBe(5);
    // ...and the back order is told so when it comes back for a decision.
    const again = await allocate(root, a, [0, 5]);
    expect(again.status).toBe(409);
    expect(again.body.shortages).toEqual(["BR-2002: 0 available, 5 requested"]);
    await expectConsistent();
  });

  it("backfills the table from the JSON an upgraded database still carries", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 50);
    await makeItem(root, "BR-2002", 50);
    // Three live holds: allocated, released (staged), and a partial release.
    const allocated = ok(await allocate(root, ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 7 }, { item: "BR-2002", ordered: 3 }])))));
    const staged = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 4 }]);
    let partial = ok(await allocate(root, ok(await check(root, await makeOrder(root, [{ item: "BR-2002", ordered: 9 }])))));
    // (Releasing part of a line uses up its allocation: 5 held, not 9.)
    partial = ok(await release(root, partial, [5]));
    // And two that hold nothing whatever their JSON says: a shipped order,
    // and a back order holding after a partial shipment, with a JSON null.
    const shipped = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 2 }])));
    await prisma.salesOrder.update({ where: { soNumber: Number(shipped.soNumber) }, data: { allocation: { lines: [{ lineItemId: shipped.lineItems[0].id, allocatedQty: 2 }], fullyAllocated: true, decidedAt: "x" } } });
    const held = ok(await allocate(root, ok(await check(root, await makeOrder(root, [{ item: "BR-2002", ordered: 1 }]))), [0]));
    expect(held.status).toBe("Backordered");
    const before = await prisma.allocation.findMany({ orderBy: { lineItemId: "asc" }, select: { soNumber: true, lineItemId: true, itemId: true, qty: true } });
    expect(before).toHaveLength(4);
    expect((await itemByNumber("BR-1001"))!.qtyReserved).toBe(11);
    expect((await itemByNumber("BR-2002"))!.qtyReserved).toBe(8);

    // Wipe what the API maintained, then run the migration's backfill.
    await prisma.$executeRawUnsafe('DELETE FROM "Allocation"');
    await prisma.$executeRawUnsafe('UPDATE "Item" SET "qtyReserved" = 0');
    const sql = readFileSync(new URL("../prisma/migrations/20260929140000_reservation_table/migration.sql", import.meta.url), "utf8");
    const backfill = sql.slice(sql.indexOf("-- backfill"));
    for (const statement of backfill.split(";").map((x) => x.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
    const after = await prisma.allocation.findMany({ orderBy: { lineItemId: "asc" }, select: { soNumber: true, lineItemId: true, itemId: true, qty: true } });
    expect(after).toEqual(before);
    expect((await itemByNumber("BR-1001"))!.qtyReserved).toBe(11);
    expect((await itemByNumber("BR-2002"))!.qtyReserved).toBe(8);
    expect(await prisma.allocation.count({ where: { soNumber: { in: [Number(shipped.soNumber), Number(held.soNumber)] } } })).toBe(0);
    expect(await prisma.allocation.count({ where: { soNumber: Number(allocated.soNumber) } })).toBe(2);
    expect(await prisma.allocation.count({ where: { soNumber: Number(staged.soNumber) } })).toBe(1);
    await expectConsistent();
  });

  it("keeps on-purchase-order by catalog link, so a renamed item's total survives (A-06)", async () => {
    const root = await admin();
    const item = await makeItem(root, "BR-1001", 0);
    const vendor = await makeVendor(root);
    // Typed with the wrong case: still this item.
    let po = await makePo(root, vendor, [{ itemNumber: "br-1001", orderedQty: 7 }]);
    expect((await itemByNumber("BR-1001"))!.qtyOnPurchaseOrder).toBe(7);
    ok(await editItem(root, ok(await root.get(`/api/items/${item.id}`)), { itemNumber: "BR-1001-X" }));
    expect(await prisma.item.findUnique({ where: { itemNumber: "BR-1001" } })).toBeNull();
    po = ok(await receive(root, ok(await root.get(`/api/vendor-purchase-orders/${po.poNumber}`)), [3]));
    expect(po.status).toBe("Partially Received");
    expect((await itemByNumber("BR-1001-X"))!).toMatchObject({ qtyOnHand: 3, qtyOnPurchaseOrder: 4 });
  });
});
