import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";
import {
  admin, allocate, check, editItem, editOrder, editPo, editRa, expectLedgerReconciles, itemByNumber, makeItem, makeOrder, makePo, makeVendor, markPrinted,
  ok, orderReadyToShip, receive, release, resetDb, ship, so, undoShipment,
} from "./helpers.js";

beforeEach(resetDb);

describe("shipping guards (R5-01)", () => {
  it("refuses to ship more than was staged, or a line that was not staged", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    await makeItem(root, "BR-1002", 100);
    let o = await makeOrder(root, [{ item: "BR-1001", ordered: 10 }, { item: "BR-1002", ordered: 10 }]);
    o = ok(await check(root, o));
    o = ok(await allocate(root, o, [10, 0], false));
    o = ok(await release(root, o));
    o = ok(await markPrinted(root, o));
    // Line 2 was never released.
    let res = await ship(root, o, [10, 1]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/BR-1002: 0 units are staged/);
    // Line 1 over what was staged.
    res = await ship(root, o, [11, 0]);
    expect(res.status).toBe(409);
    // A line id from another order.
    const other = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }]);
    res = await root.post(`${so(o)}/ship`, { version: o.version, lines: [{ lineItemId: other.lineItems[0].id, qty: 1 }] });
    expect(res.status).toBe(400);
    // Nothing changed.
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(100);
    expect(await prisma.shipmentRecord.count()).toBe(0);
    o = ok(await ship(root, o, [10, 0]));
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(90);
  });

  it("refuses to take on-hand below zero even when the pick was staged before a count correction", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 10);
    const o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10 }]);
    // A cycle count finds only 6 on the shelf.
    ok(await root.patch("/api/items/by-number/BR-1001/qty", { setQtyOnHand: 6, expectedQtyOnHand: 10 }));
    const res = await ship(root, o);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/would take on-hand to -4/);
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(6);
    expect(await prisma.shipmentRecord.count()).toBe(0);
    // The transaction rolled back: no SHIP movement was left behind.
    const moves = await prisma.stockMovement.findMany({ where: { itemNumber: "BR-1001" } });
    expect(moves.map((m) => m.reason)).toEqual(["ADJUST"]);
  });
});

describe("races", () => {
  it("two people confirming the same shipment: exactly one succeeds and stock moves once", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10 }]);
    const results = await Promise.all([ship(root, o), ship(root, o), ship(root, o)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(90);
    expect(await prisma.shipmentRecord.count()).toBe(1);
    await expectLedgerReconciles("BR-1001", 100);
  });

  it("two analysts allocating the last units: the second is told there is no stock", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 10);
    const a = ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 8 }])));
    const b = ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 8 }])));
    const [ra, rb] = await Promise.all([allocate(root, a, [8], false), allocate(root, b, [8], false)]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(loser.body.shortages?.[0]).toMatch(/2 available, 8 requested/);
    // Total reserved never exceeds on hand.
    const open = await prisma.salesOrder.findMany({ where: { status: "ALLOCATED" } });
    const reserved = open.reduce((s, o) => s + ((o.allocation as any)?.lines ?? []).reduce((x: number, l: any) => x + l.allocatedQty, 0), 0);
    expect(reserved).toBe(8);
  });

  it("many concurrent allocations against one scarce item never over-commit it", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 25);
    const orders = [];
    for (let i = 0; i < 8; i++) orders.push(ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 6 }]))));
    const results = await Promise.all(orders.map((o) => allocate(root, o, [6], false)));
    const wins = results.filter((r) => r.status === 200).length;
    const losses = results.filter((r) => r.status === 409).length;
    expect(wins + losses).toBe(8);
    expect(wins).toBe(4); // 4 x 6 = 24 <= 25; a fifth would need 30
    const open = await prisma.salesOrder.findMany({ where: { status: "ALLOCATED" } });
    const reserved = open.reduce((s, o) => s + ((o.allocation as any)?.lines ?? []).reduce((x: number, l: any) => x + l.allocatedQty, 0), 0);
    expect(reserved).toBeLessThanOrEqual(25);
  });

  it("two docks receiving the same PO at once: one receipt, stock added once", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 0);
    const vendor = await makeVendor(root);
    const po = await makePo(root, vendor, [{ itemNumber: "BR-1001", orderedQty: 50 }]);
    const results = await Promise.all([receive(root, po, [50]), receive(root, po, [50])]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(50);
    expect(await prisma.vendorReceivingRecord.count()).toBe(1);
    expect((await itemByNumber("BR-1001")).qtyOnPurchaseOrder).toBe(0);
    await expectLedgerReconciles("BR-1001", 0);
  });

  it("ship and undo interleaved with an edit: versions keep every writer honest", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10 }]);
    const [edit, shipped] = await Promise.all([editOrder(root, o, { notes: "hurry" }), ship(root, o)]);
    // Whichever landed second saw a moved version.
    expect([edit.status, shipped.status].sort()).toEqual([200, 409]);
    await expectLedgerReconciles("BR-1001", 100);
    const current = ok(await root.get(so(o)));
    if (shipped.status === 200) {
      expect(current.status).toBe("Shipped");
      expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(90);
    } else {
      expect(current.notes).toBe("hurry");
      expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(100);
    }
  });
});

describe("purchase orders (R5-03)", () => {
  it("received quantities, history and status cannot be set by a plain save", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 0);
    const vendor = await makeVendor(root);
    let po = await makePo(root, vendor, [{ itemNumber: "BR-1001", orderedQty: 50 }]);
    expect((await itemByNumber("BR-1001")).qtyOnPurchaseOrder).toBe(50);
    const tampered = {
      ...po,
      status: "Received",
      lines: [{ ...po.lines[0], receivedQty: 50 }],
      receivingHistory: [{ receivedAt: new Date().toISOString(), lines: [{ lineId: po.lines[0].id, qty: 50 }] }],
    };
    po = ok(await editPo(root, tampered, {}));
    expect(po.status).toBe("Open");
    expect(po.lines[0].receivedQty).toBe(0);
    expect(po.receivingHistory).toEqual([]);
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(0);
    expect((await itemByNumber("BR-1001")).qtyOnPurchaseOrder).toBe(50);
  });

  it("derives status from receipts, freezes received lines, and caps over-receipt", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 0);
    await makeItem(root, "BR-1002", 0);
    const vendor = await makeVendor(root);
    let po = await makePo(root, vendor, [{ itemNumber: "BR-1001", orderedQty: 50 }, { itemNumber: "BR-1002", orderedQty: 20 }]);
    po = ok(await receive(root, po, [30, 0]));
    expect(po.status).toBe("Partially Received");
    expect((await itemByNumber("BR-1001")).qtyOnPurchaseOrder).toBe(20);
    // Can't remove or shrink the received line below 30; can edit the other.
    expect((await editPo(root, po, { lines: [po.lines[1]] })).status).toBe(409);
    expect((await editPo(root, po, { lines: [{ ...po.lines[0], orderedQty: 29 }, po.lines[1]] })).status).toBe(409);
    po = ok(await editPo(root, po, { lines: [po.lines[0], { ...po.lines[1], orderedQty: 25 }] }));
    expect(po.lines[0].receivedQty).toBe(30);
    // A typo of 2000 against 20 outstanding is refused; a case over is fine.
    expect((await receive(root, po, [20, 2000])).status).toBe(400);
    po = ok(await receive(root, po, [20, 27]));
    expect(po.status).toBe("Received");
    expect((await itemByNumber("BR-1002")).qtyOnHand).toBe(27);
    // Closed POs don't receive; reopening restores the derived status.
    po = ok(await editPo(root, po, { status: "Closed" }));
    expect(po.status).toBe("Closed");
    expect((await receive(root, po, [1, 0])).status).toBe(409);
    po = ok(await editPo(root, po, { status: "Open" }));
    expect(po.status).toBe("Received");
    await expectLedgerReconciles("BR-1001", 0);
    await expectLedgerReconciles("BR-1002", 0);
  });
});

describe("returns", () => {
  it("stamps the writer, restocks once, and refuses more than shipped", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10 }]);
    o = ok(await ship(root, o));
    const ra = ok(
      await root.post("/api/returns", {
        soNumber: String(o.soNumber),
        billTo: o.billTo,
        requestDate: "2026-09-29",
        writtenBy: "ZZ",
        lines: [{ itemNumber: "BR-1001", description: "x", qty: 4, rate: 2.5, restock: true }],
      }),
      201
    );
    expect(ra.writtenBy).toBe("AD");
    const tooMany = await root.post("/api/returns", {
      soNumber: String(o.soNumber),
      billTo: o.billTo,
      requestDate: "2026-09-29",
      lines: [{ itemNumber: "BR-1001", description: "x", qty: 7, rate: 2.5 }],
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toMatch(/6 returnable/);
    // A plain save can't mark it received.
    expect((await editRa(root, ra, { status: "Received" })).status).toBe(409);
    const received = ok(await root.post(`/api/returns/${ra.raNumber}/receive`, { version: ra.version, lines: [] }));
    expect(received.status).toBe("Received");
    expect(received.receivedBy).toBe("admin");
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(94);
    expect((await root.post(`/api/returns/${ra.raNumber}/receive`, { version: received.version, lines: [] })).status).toBe(409);
    await expectLedgerReconciles("BR-1001", 100);
  });
});

describe("items", () => {
  it("treats item numbers as case- and space-insensitive and renames history along", async () => {
    const root = await admin();
    const item = await makeItem(root, "BR-1001", 100);
    expect((await root.post("/api/items", { itemNumber: "br-1001 ", description: "dup", rate: 1, qtyOnHand: 1 })).status).toBe(409);
    let o = await makeOrder(root, [{ item: "br-1001", ordered: 2 }]);
    expect(o.lineItems[0].itemId).toBe(item.id);
    const renamed = ok(await editItem(root, item, { itemNumber: "BR-1001-X" }));
    expect(renamed.itemNumber).toBe("BR-1001-X");
    o = ok(await root.get(so(o)));
    expect(o.lineItems[0].item).toBe("BR-1001-X");
    // An edited on-hand figure is a ledger entry.
    ok(await editItem(root, renamed, { qtyOnHand: 90 }));
    await expectLedgerReconciles("BR-1001-X", 100);
    // The atomic count correction refuses a stale expectation.
    const stale = await root.patch("/api/items/by-number/BR-1001-X/qty", { setQtyOnHand: 50, expectedQtyOnHand: 100 });
    expect(stale.status).toBe(409);
    expect(stale.body.qtyOnHand).toBe(90);
  });

  it("rejects negative prices and non-positive quantities", async () => {
    const root = await admin();
    expect((await root.post("/api/items", { itemNumber: "N-1", description: "x", rate: -1 })).status).toBe(400);
    await makeItem(root, "BR-1001", 10);
    expect((await root.post("/api/sales-orders", { orderDate: "2026-09-28", dueDate: "2026-09-28", billTo: { name: "a", addressLine1: "b", city: "c", state: "IL", zip: "1" }, shipTo: { name: "a", addressLine1: "b", city: "c", state: "IL", zip: "1" }, lineItems: [{ item: "BR-1001", description: "x", ordered: 0, rate: 1 }] })).status).toBe(400);
    expect((await root.post("/api/sales-orders", { orderDate: "2026-09-28", dueDate: "2026-09-28", billTo: { name: "a", addressLine1: "b", city: "c", state: "IL", zip: "1" }, shipTo: { name: "a", addressLine1: "b", city: "c", state: "IL", zip: "1" }, taxRate: 250, lineItems: [] })).status).toBe(400);
  });
});

describe("undo after repack", () => {
  it("undoing a shipment restores stock and re-stages exactly what shipped", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    await makeItem(root, "BR-1002", 100);
    let o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10 }, { item: "BR-1002", ordered: 4 }]);
    o = ok(await ship(root, o, [10, 3]));
    expect(o.status).toBe("Backordered");
    expect((await itemByNumber("BR-1002")).qtyOnHand).toBe(97);
    o = ok(await undoShipment(root, o));
    expect(o.status).toBe("Pick & Packed");
    expect(o.pendingShipment).toEqual([
      { lineItemId: o.lineItems[0].id, qty: 10 },
      { lineItemId: o.lineItems[1].id, qty: 3 },
    ]);
    expect((await itemByNumber("BR-1001")).qtyOnHand).toBe(100);
    expect((await itemByNumber("BR-1002")).qtyOnHand).toBe(100);
    expect((await undoShipment(root, o)).status).toBe(409);
    await expectLedgerReconciles("BR-1001", 100);
    await expectLedgerReconciles("BR-1002", 100);
  });
});
