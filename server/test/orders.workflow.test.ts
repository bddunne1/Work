import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";
import {
  ADDRESS, admin, allocate, as, cancel, check, editOrder, expectLedgerReconciles, getOrder, makeCustomer, makeItem, makeOrder,
  markPrinted, ok, orderReadyToShip, release, resetDb, ship, so, unallocate, undoShipment,
} from "./helpers.js";

beforeEach(resetDb);

describe("order workflow commands", () => {
  it("walks an order through every step with the right stamps", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = await makeOrder(root, [{ item: "BR-1001", ordered: 10 }], { writtenBy: "ZZ", writtenById: "forged-id", writtenByColor: "#000000" });
    // Attribution comes from the session, not the body (R5-02).
    expect(o.writtenBy).toBe("AD");
    expect(o.writtenById).not.toBe("forged-id");
    expect(o.status).toBe("Entered");

    o = ok(await check(root, o));
    expect(o.status).toBe("Checked");
    expect(o.checkedBy).toBe("AD");
    expect(o.checkedAt).toBeTruthy();

    o = ok(await allocate(root, o));
    expect(o.status).toBe("Allocated");
    expect(o.allocation.fullyAllocated).toBe(true);
    expect(o.allocation.lines[0].allocatedQty).toBe(10);

    o = ok(await release(root, o));
    expect(o.status).toBe("Pick & Packed");
    expect(o.pickPackStatus).toBe("Complete");
    expect(o.pendingShipment).toEqual([{ lineItemId: o.lineItems[0].id, qty: 10 }]);
    expect(o.allocation.lines[0].allocatedQty).toBe(0);

    o = ok(await markPrinted(root, o));
    expect(o.pickListPrintedAt).toBeTruthy();
    expect(o.packingSlipPrintedAt).toBeTruthy();

    o = ok(await ship(root, o));
    expect(o.status).toBe("Shipped");
    expect(o.shipmentHistory).toHaveLength(1);
    expect(o.pendingShipment).toEqual([]);
    const { item } = await expectLedgerReconciles("BR-1001", 100);
    expect(item.qtyOnHand).toBe(90);

    o = ok(await undoShipment(root, o));
    expect(o.status).toBe("Pick & Packed");
    expect(o.shipmentHistory).toHaveLength(0);
    expect(o.pendingShipment[0].qty).toBe(10);
    expect((await expectLedgerReconciles("BR-1001", 100)).item.qtyOnHand).toBe(100);
  });

  it("refuses a step made from a stale version and a step the order is not ready for", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const o = await makeOrder(root, [{ item: "BR-1001", ordered: 5 }]);
    const checked = ok(await check(root, o));
    // Second check with the version the first caller held: 409, no change.
    const again = await check(root, o);
    expect(again.status).toBe(409);
    expect(again.body.conflict).toBe(true);
    // Allocating an Entered order (via a fresh version) is out of sequence.
    const early = await allocate(root, await makeOrder(root, [{ item: "BR-1001", ordered: 1 }]));
    expect(early.status).toBe(409);
    // Releasing a merely Checked order, likewise.
    const rel = await release(root, checked);
    expect(rel.status).toBe(409);
    // Shipping something that was never released.
    const shipEarly = await ship(root, checked, [5]);
    expect(shipEarly.status).toBe(409);
  });

  it("holds a partial allocation for a ship-complete-only customer and reserves nothing", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 4);
    const cust = await makeCustomer(root, "Complete Co", { shipCompleteOnly: true });
    let o = await makeOrder(root, [{ item: "BR-1001", ordered: 10 }], { customerId: cust.id });
    o = ok(await check(root, o));
    // Caller leaves the decision to the customer record.
    o = ok(await allocate(root, o, [4]));
    expect(o.status).toBe("Backordered");
    expect(o.allocation.lines[0].allocatedQty).toBe(0);
    expect(o.allocation.shipCompleteOnly).toBe(true);
    // The same partial, explicitly allowed, goes to Allocated for what's there.
    o = ok(await allocate(root, o, [4], false));
    expect(o.status).toBe("Allocated");
    expect(o.allocation.lines[0].allocatedQty).toBe(4);
    // Allocating nothing at all is a hold whatever the customer says.
    o = ok(await unallocate(root, o));
    o = ok(await allocate(root, o, [0], false));
    expect(o.status).toBe("Backordered");
  });

  it("never allocates more than a line still owes", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = await makeOrder(root, [{ item: "BR-1001", ordered: 10 }]);
    o = ok(await check(root, o));
    const over = await allocate(root, o, [11]);
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/only 10 remaining/);
  });

  it("unallocates an allocated or unprinted pick, but not one that has printed", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = await makeOrder(root, [{ item: "BR-1001", ordered: 10 }]);
    o = ok(await check(root, o));
    o = ok(await allocate(root, o));
    o = ok(await unallocate(root, o));
    expect(o.status).toBe("Checked");
    expect(o.allocation).toBeNull();
    o = ok(await allocate(root, o));
    o = ok(await release(root, o));
    o = ok(await unallocate(root, o));
    expect(o.status).toBe("Checked");
    expect(o.pendingShipment).toEqual([]);
    expect(o.pickedAt).toBeNull();
    o = ok(await allocate(root, o));
    o = ok(await release(root, o));
    o = ok(await markPrinted(root, o));
    const refused = await unallocate(root, o);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/printed/);
  });

  it("lets a printed pick be trimmed down but never up", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10 }]);
    const lineId = o.lineItems[0].id;
    const up = await markPrinted(root, o, [{ lineItemId: lineId, qty: 11 }]);
    expect(up.status).toBe(400);
    o = ok(await markPrinted(root, o, [{ lineItemId: lineId, qty: 7 }]));
    expect(o.pendingShipment).toEqual([{ lineItemId: lineId, qty: 7 }]);
    const zero = await markPrinted(root, o, [{ lineItemId: lineId, qty: 0 }]);
    expect(zero.status).toBe(400);
  });

  it("ships a partial, backorders the rest, and lets the remainder go round again", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10 }]);
    o = ok(await ship(root, o, [6]));
    expect(o.status).toBe("Backordered");
    o = ok(await allocate(root, o, [4]));
    expect(o.status).toBe("Allocated");
    o = ok(await release(root, o));
    o = ok(await markPrinted(root, o));
    // Undo of the first shipment is blocked while a second pick is staged.
    const blocked = await undoShipment(root, o);
    expect(blocked.status).toBe(409);
    o = ok(await ship(root, o));
    expect(o.status).toBe("Shipped");
    expect(o.shipmentHistory).toHaveLength(2);
    expect((await expectLedgerReconciles("BR-1001", 100)).item.qtyOnHand).toBe(90);
  });

  it("cancels an open order, releasing what it held, and refuses to cancel twice or edit afterwards", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = await makeOrder(root, [{ item: "BR-1001", ordered: 10 }]);
    o = ok(await check(root, o));
    o = ok(await allocate(root, o));
    expect((await cancel(root, o, "")).status).toBe(400);
    o = ok(await cancel(root, o, "customer called"));
    expect(o.status).toBe("Cancelled");
    expect(o.allocation).toBeNull();
    expect(o.cancelledBy).toBe("admin");
    expect((await cancel(root, o)).status).toBe(409);
    expect((await editOrder(root, o, { notes: "x" })).status).toBe(409);
    // Stock is untouched: cancelling releases a reservation, not a shipment.
    expect((await expectLedgerReconciles("BR-1001", 100)).moves).toHaveLength(0);
  });
});

describe("order edits (PUT)", () => {
  it("ignores server-owned fields sent by the client", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = await makeOrder(root, [{ item: "BR-1001", ordered: 10 }]);
    const tampered = {
      ...o,
      notes: "edited",
      status: "Shipped",
      checkedBy: "ZZ",
      checkedAt: new Date().toISOString(),
      writtenBy: "ZZ",
      allocation: { lines: [{ lineItemId: o.lineItems[0].id, allocatedQty: 10 }], fullyAllocated: true, decidedAt: new Date().toISOString() },
      pendingShipment: [{ lineItemId: o.lineItems[0].id, qty: 10 }],
      pickListPrintedAt: new Date().toISOString(),
      shipmentHistory: [{ shippedAt: new Date().toISOString(), lines: [{ lineItemId: o.lineItems[0].id, qty: 10 }] }],
    };
    o = ok(await editOrder(root, tampered, {}));
    expect(o.notes).toBe("edited");
    expect(o.status).toBe("Entered");
    expect(o.checkedBy).toBeNull();
    expect(o.writtenBy).toBe("AD");
    expect(o.allocation).toBeNull();
    expect(o.pendingShipment).toBeNull();
    expect(o.pickListPrintedAt).toBeNull();
    expect(o.shipmentHistory).toEqual([]);
    expect(await prisma.shipmentRecord.count()).toBe(0);
  });

  it("freezes lines once stock is committed, and shipped lines forever", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    await makeItem(root, "BR-1002", 100);
    let o = await makeOrder(root, [{ item: "BR-1001", ordered: 10 }, { item: "BR-1002", ordered: 5 }]);
    o = ok(await check(root, o));
    // Header edits are fine while Checked; so are line edits.
    o = ok(await editOrder(root, o, { lineItems: [{ ...o.lineItems[0], ordered: 12 }, o.lineItems[1]] }));
    expect(o.lineItems.find((l: any) => l.item === "BR-1001").ordered).toBe(12);

    o = ok(await allocate(root, o));
    const frozen = await editOrder(root, o, { lineItems: [{ ...o.lineItems[0], ordered: 20 }, o.lineItems[1]] });
    expect(frozen.status).toBe(409);
    expect(frozen.body.error).toMatch(/unallocate/i);
    // A header-only edit still goes through.
    o = ok(await editOrder(root, o, { notes: "leave at dock" }));
    expect(o.notes).toBe("leave at dock");

    // Ship line 1 partly, backorder, unallocate back to Checked: line 1 is
    // still frozen at >= shipped and can't be removed (R5-11).
    o = ok(await release(root, o));
    o = ok(await markPrinted(root, o));
    o = ok(await ship(root, o, [12, 0]));
    expect(o.status).toBe("Backordered");
    o = ok(await allocate(root, o, [0, 5]));
    o = ok(await unallocate(root, o));
    expect(o.status).toBe("Checked");
    const l1 = o.lineItems.find((l: any) => l.item === "BR-1001");
    const l2 = o.lineItems.find((l: any) => l.item === "BR-1002");
    expect((await editOrder(root, o, { lineItems: [l2] })).status).toBe(409);
    expect((await editOrder(root, o, { lineItems: [{ ...l1, ordered: 11 }, l2] })).status).toBe(409);
    expect((await editOrder(root, o, { lineItems: [{ ...l1, item: "BR-1002" }, l2] })).status).toBe(409);
    o = ok(await editOrder(root, o, { lineItems: [{ ...l1, ordered: 12 }, { ...l2, ordered: 3 }] }));
    expect(o.lineItems.find((l: any) => l.item === "BR-1002").ordered).toBe(3);
  });

  it("refuses lines that belong to another order and unknown items", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const a = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }]);
    const b = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }]);
    expect((await editOrder(root, a, { lineItems: [...a.lineItems, b.lineItems[0]] })).status).toBe(400);
    const unknown = await editOrder(root, a, { lineItems: [{ ...a.lineItems[0], item: "NOPE-1" }] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.missingItems).toEqual(["NOPE-1"]);
    expect(await prisma.salesOrderLine.count({ where: { soNumber: Number(b.soNumber) } })).toBe(1);
  });

  it("records what changed, including prices", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const o = await makeOrder(root, [{ item: "BR-1001", ordered: 10, rate: 2.5 }]);
    ok(await editOrder(root, o, { rep: "JD", lineItems: [{ ...o.lineItems[0], rate: 3.25 }] }));
    // The audit write is fire-and-forget; give it a moment.
    await new Promise((r) => setTimeout(r, 50));
    const entry = await prisma.auditLog.findFirst({ where: { action: "ORDER_UPDATED", targetId: String(o.soNumber) } });
    expect(entry).toBeTruthy();
    const detail = entry!.detail as any;
    expect(detail.rep).toEqual({ from: "", to: "JD" });
    expect(detail.rates["BR-1001"]).toEqual({ from: "2.5", to: 3.25 });
  });
});

describe("permissions on order commands", () => {
  const perms = {
    entry: { "order-entry": "edit" } as const,
    validation: { validation: "edit" } as const,
    analyst: { allocation: "edit", "back-orders": "edit", "pick-release": "edit" } as const,
    printer: { "pick-pack": "edit" } as const,
    logistics: { "open-picks": "edit", "shipment-history": "edit", bol: "edit", schedule: "edit" } as const,
    labels: { labels: "edit" } as const,
  };

  it("lets each page do exactly its own step", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const entry = await as("entry", { permissions: perms.entry });
    const validation = await as("validation", { permissions: perms.validation });
    const analyst = await as("analyst", { permissions: perms.analyst });
    const printer = await as("printer", { permissions: perms.printer });
    const logistics = await as("logistics", { permissions: perms.logistics });
    const labels = await as("labels", { permissions: perms.labels });

    let o = await makeOrder(entry, [{ item: "BR-1001", ordered: 10 }]);
    expect(o.writtenBy).toBe("EN");
    // Order entry can't check; validation can.
    expect((await check(entry, o)).status).toBe(403);
    expect((await check(labels, o)).status).toBe(403);
    o = ok(await check(validation, o));
    expect(o.checkedBy).toBe("VA");
    // Validation can't allocate; the analyst can.
    expect((await allocate(validation, o)).status).toBe(403);
    o = ok(await allocate(analyst, o));
    // Only pick-release releases.
    expect((await release(printer, o)).status).toBe(403);
    o = ok(await release(analyst, o));
    // Printing: pick-pack or open-picks.
    expect((await markPrinted(analyst, o)).status).toBe(403);
    o = ok(await markPrinted(printer, o));
    // Shipping: logistics only.
    expect((await ship(analyst, o)).status).toBe(403);
    expect((await ship(printer, o)).status).toBe(403);
    o = ok(await ship(logistics, o));
    expect(o.status).toBe("Shipped");
    expect((await undoShipment(analyst, o)).status).toBe(403);
    o = ok(await undoShipment(logistics, o));
    // Labels edit no longer rewrites orders (R5-05): not the writer, no edit page.
    expect((await editOrder(labels, o, { notes: "hijack" })).status).toBe(403);
    // The writer may still correct their own order's header.
    o = ok(await editOrder(entry, o, { notes: "corrected" }));
    expect(o.notes).toBe("corrected");
    // Cancel: order-detail or allocation.
    expect((await cancel(logistics, o)).status).toBe(403);
    expect((await cancel(analyst, o)).status).toBe(200);
  });

  it("names the page in the error rather than the internal key", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const analyst = await as("analyst", { permissions: perms.analyst });
    const o = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }]);
    const res = await editOrder(analyst, o, { notes: "x" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Order Entry or Sales Order View/);
  });

  it("view-only accounts read but cannot write anything", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const viewer = await as("viewer", { permissions: { "open-orders": "view", validation: "view", allocation: "view" } });
    const o = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }]);
    ok(await viewer.get(so(o)));
    expect((await check(viewer, o)).status).toBe(403);
    expect((await allocate(viewer, o)).status).toBe(403);
    expect((await viewer.post("/api/sales-orders", { orderDate: "2026-09-28", dueDate: "2026-09-28", billTo: ADDRESS, shipTo: ADDRESS })).status).toBe(403);
    expect((await editOrder(viewer, o, {})).status).toBe(403);
  });

  it("keeps dates and the BOL behind their own pages", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const analyst = await as("analyst", { permissions: perms.analyst });
    const logistics = await as("logistics", { permissions: perms.logistics });
    const printer = await as("printer", { permissions: perms.printer });
    let o = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }]);
    expect((await printer.post(`${so(o)}/set-ship-date`, { version: o.version, estimatedShipDate: "2026-10-01" })).status).toBe(403);
    o = ok(await analyst.post(`${so(o)}/set-ship-date`, { version: o.version, estimatedShipDate: "2026-10-01" }));
    expect(o.estimatedShipDate.slice(0, 10)).toBe("2026-10-01");
    o = ok(await logistics.post(`${so(o)}/set-ship-date`, { version: o.version, estimatedShipDate: null }));
    expect(o.estimatedShipDate).toBeNull();
    const bol = { weight: "120", packageCount: "2", palletSlip: "Y", handlingUnitQty: "1", handlingUnitType: "PLT", packageQty: "2", packageType: "CTN", hazmat: false, commodityDescription: "Rope", nmfcNumber: "", freightClass: "70", additionalInfo: "", generatedAt: new Date().toISOString() };
    expect((await analyst.post(`${so(o)}/set-bol`, { version: o.version, bol })).status).toBe(403);
    o = ok(await logistics.post(`${so(o)}/set-bol`, { version: o.version, bol }));
    expect(o.bol.weight).toBe("120");
    expect(await getOrder(root, o.soNumber)).toMatchObject({ bol: { weight: "120" } });
  });
});
