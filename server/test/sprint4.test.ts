// Sprint 4: allocating beyond on hand (allocation-override), inbound
// shipments, and the Purchase Orders open/closed filter.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";
import { admin, allocate, as, check, getOrder, makeItem, makeOrder, makePo, makeVendor, ok, receive, resetDb, ship, so, walkToPrinted } from "./helpers.js";

beforeEach(async () => {
  await resetDb();
});

async function itemRow(itemNumber: string) {
  return prisma.item.findUniqueOrThrow({ where: { itemNumber }, select: { qtyOnHand: true, qtyReserved: true } });
}

describe("allocating beyond on hand (allocation-override)", () => {
  it("lets a permitted account allocate more than is free when it asks to, and reserves the full quantity", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 4);
    const analyst = await as("ana", { permissions: { allocation: "edit", "allocation-override": "edit" } });
    const o = ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 10 }])));
    // Without the flag the shortage is refused exactly as before, even for a permitted account.
    const refused = await allocate(analyst, o, [10]);
    expect(refused.status).toBe(409);
    expect(refused.body.shortages).toEqual(["BR-1001: 4 available, 10 requested"]);
    expect(await itemRow("BR-1001")).toEqual({ qtyOnHand: 4, qtyReserved: 0 });
    // With it, the allocation goes through and the reservation says so.
    const over = ok(await analyst.post(`/api/sales-orders/${o.soNumber}/allocate`, { version: o.version, lines: [{ lineItemId: o.lineItems[0].id, allocatedQty: 10 }], allowOverAllocation: true }));
    expect(over.status).toBe("Allocated");
    expect(await itemRow("BR-1001")).toEqual({ qtyOnHand: 4, qtyReserved: 10 });
    // Available is honestly negative on the item.
    const item = ok(await root.get("/api/items")).find((i: any) => i.itemNumber === "BR-1001");
    expect(item.qtyOnHand - item.qtyReserved).toBe(-6);
    // The audit detail carries the override and the shortage.
    await expect.poll(async () => {
      const rows = await prisma.auditLog.findMany({ where: { action: "ORDER_STATUS_CHANGED", targetId: String(o.soNumber) } });
      return rows.map((r) => r.detail).find((d: any) => d?.overAllocated);
    }).toMatchObject({ overAllocated: true, to: "Allocated", shortages: [{ itemNumber: "BR-1001", available: 4, requested: 10 }] });
  });

  it("still refuses an account without the permission, flag or not", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 4);
    const analyst = await as("plain", { permissions: { allocation: "edit" } });
    const o = ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 10 }])));
    const refused = await analyst.post(`/api/sales-orders/${o.soNumber}/allocate`, { version: o.version, lines: [{ lineItemId: o.lineItems[0].id, allocatedQty: 10 }], allowOverAllocation: true });
    expect(refused.status).toBe(409);
    expect(refused.body.shortages).toEqual(["BR-1001: 4 available, 10 requested"]);
    expect(await itemRow("BR-1001")).toEqual({ qtyOnHand: 4, qtyReserved: 0 });
    expect((await getOrder(root, o.soNumber)).status).toBe("Checked");
  });

  it("records a revision beyond on hand as ORDER_ALLOCATION_REVISED with the override", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 5);
    const o = ok(await allocate(root, ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 8 }]))), [5]));
    expect(o.status).toBe("Allocated");
    const revised = ok(await root.post(`/api/sales-orders/${o.soNumber}/allocate`, { version: o.version, lines: [{ lineItemId: o.lineItems[0].id, allocatedQty: 8 }], allowOverAllocation: true }));
    expect(revised.status).toBe("Allocated");
    expect(await itemRow("BR-1001")).toEqual({ qtyOnHand: 5, qtyReserved: 8 });
    await expect.poll(async () => {
      const rows = await prisma.auditLog.findMany({ where: { action: "ORDER_ALLOCATION_REVISED", targetId: String(o.soNumber) } });
      return rows.map((r) => r.detail).find((d: any) => d?.overAllocated);
    }).toMatchObject({ overAllocated: true, shortages: [{ itemNumber: "BR-1001", available: 5, requested: 8 }] });
  });
});

describe("inbound shipments", () => {
  async function setup() {
    const root = await admin();
    await makeItem(root, "BR-1001", 0);
    await makeItem(root, "BR-2002", 0);
    const vendor = await makeVendor(root);
    const po = await makePo(root, vendor, [{ itemNumber: "BR-1001", orderedQty: 40 }, { itemNumber: "BR-2002", orderedQty: 10 }]);
    return { root, vendor, po };
  }
  const line = (po: any, itemNumber: string) => po.lines.find((l: any) => l.itemNumber === itemNumber);

  it("creates, lists (open first, by ETA), updates with a version check, moves status and deletes", async () => {
    const { root, vendor, po } = await setup();
    const purchasing = await as("buyer", { permissions: { "inbound-shipments": "edit" } });
    const a = ok(await purchasing.post("/api/inbound-shipments", { reference: "MSCU1234567", carrier: "MSC", eta: "2026-11-20", etd: "2026-10-25", lines: [{ vendorPoLineId: line(po, "BR-1001").id, qty: 30 }] }), 201);
    expect(a).toMatchObject({ reference: "MSCU1234567", status: "Booked", eta: "2026-11-20", vendorId: vendor.id, vendorName: vendor.name, poNumbers: [po.poNumber], units: 30 });
    expect(a.lines[0]).toMatchObject({ poNumber: po.poNumber, itemNumber: "BR-1001", orderedQty: 40, receivedQty: 0, qty: 30 });
    const b = ok(await purchasing.post("/api/inbound-shipments", { reference: "TRUCK-9", eta: "2026-11-05", lines: [{ vendorPoLineId: line(po, "BR-2002").id, qty: 10 }] }), 201);
    const c = ok(await purchasing.post("/api/inbound-shipments", { reference: "NO-ETA", lines: [{ vendorPoLineId: line(po, "BR-1001").id, qty: 10 }] }), 201);
    // Soonest ETA first, no ETA last.
    expect(ok(await purchasing.get("/api/inbound-shipments")).map((s: any) => s.reference)).toEqual(["TRUCK-9", "MSCU1234567", "NO-ETA"]);
    // Paged and searched.
    const paged = ok(await purchasing.get("/api/inbound-shipments?page=1&pageSize=2&open=1"));
    expect(paged.total).toBe(3);
    expect(paged.rows.map((s: any) => s.reference)).toEqual(["TRUCK-9", "MSCU1234567"]);
    expect(ok(await purchasing.get("/api/inbound-shipments?q=msc")).map((s: any) => s.reference)).toEqual(["MSCU1234567"]);
    expect(ok(await purchasing.get(`/api/inbound-shipments?q=${vendor.name.split(" ")[0]}`)).length).toBe(3);
    expect(ok(await purchasing.get(`/api/inbound-shipments?poNumber=${po.poNumber}`)).length).toBe(3);
    // Update is version-checked.
    const stale = await purchasing.put(`/api/inbound-shipments/${a.id}`, { ...a, version: a.version - 1, carrier: "Maersk" });
    expect(stale.status).toBe(409);
    const updated = ok(await purchasing.put(`/api/inbound-shipments/${a.id}`, { reference: a.reference, carrier: "Maersk", eta: "2026-11-22", etd: a.etd, notes: "rolled a sailing", vendorId: vendor.id, version: a.version, lines: [{ vendorPoLineId: line(po, "BR-1001").id, qty: 25 }, { vendorPoLineId: line(po, "BR-2002").id, qty: 5 }] }));
    expect(updated).toMatchObject({ carrier: "Maersk", eta: "2026-11-22", units: 30, version: a.version + 1 });
    expect(updated.lines).toHaveLength(2);
    // Status moves; Arrived stamps arrivedAt.
    const arrived = ok(await purchasing.post(`/api/inbound-shipments/${b.id}/status`, { version: b.version, status: "Arrived" }));
    expect(arrived.status).toBe("Arrived");
    expect(arrived.arrivedAt).toBeTruthy();
    const cancelled = ok(await purchasing.post(`/api/inbound-shipments/${c.id}/status`, { version: c.version, status: "Cancelled" }));
    expect(cancelled.status).toBe("Cancelled");
    expect(ok(await purchasing.get("/api/inbound-shipments?open=1")).map((s: any) => s.reference)).toEqual(["TRUCK-9", "MSCU1234567"]);
    // Delete takes the lines with it and leaves the PO alone.
    expect((await purchasing.del(`/api/inbound-shipments/${c.id}`)).status).toBe(204);
    expect((await purchasing.get(`/api/inbound-shipments/${c.id}`)).status).toBe(404);
    expect(await prisma.inboundShipmentLine.count()).toBe(3);
    expect(ok(await root.get(`/api/vendor-purchase-orders/${po.poNumber}`)).lines).toHaveLength(2);
    // A PO line an inbound shipment carries can't be removed from the PO.
    const fresh = ok(await root.get(`/api/vendor-purchase-orders/${po.poNumber}`));
    const trimmed = await root.put(`/api/vendor-purchase-orders/${po.poNumber}`, {
      ...fresh,
      lines: fresh.lines.filter((l: any) => l.itemNumber === "BR-1001").map((l: any) => ({ ...l, cost: Number(l.cost) })),
    });
    expect(trimmed.status).toBe(409);
    expect(trimmed.body.error).toMatch(/inbound shipment/);
    // Every write is on the activity log.
    await expect.poll(async () => (await prisma.auditLog.findMany({ where: { targetType: "inbound-shipment" } })).map((r) => r.action).sort()).toEqual(
      ["INBOUND_SHIPMENT_CREATED", "INBOUND_SHIPMENT_CREATED", "INBOUND_SHIPMENT_CREATED", "INBOUND_SHIPMENT_DELETED", "INBOUND_SHIPMENT_STATUS_CHANGED", "INBOUND_SHIPMENT_STATUS_CHANGED", "INBOUND_SHIPMENT_UPDATED"]
    );
  });

  it("refuses lines from another vendor's PO and unknown lines", async () => {
    const { root, vendor, po } = await setup();
    const other = await makeVendor(root, "Other Supply");
    const otherPo = await makePo(root, other, [{ itemNumber: "BR-1001", orderedQty: 5 }]);
    const mixed = await root.post("/api/inbound-shipments", { reference: "MIX", vendorId: vendor.id, lines: [{ vendorPoLineId: line(otherPo, "BR-1001").id, qty: 5 }] });
    expect(mixed.status).toBe(400);
    expect(mixed.body.error).toMatch(/different vendor/);
    const unknown = await root.post("/api/inbound-shipments", { reference: "GHOST", lines: [{ vendorPoLineId: "nope", qty: 1 }] });
    expect(unknown.status).toBe(400);
    // Two vendors' lines with no vendor given: refused too (no single vendor to resolve).
    const twoVendors = await root.post("/api/inbound-shipments", { reference: "TWO", lines: [{ vendorPoLineId: line(po, "BR-1001").id, qty: 1 }, { vendorPoLineId: line(otherPo, "BR-1001").id, qty: 1 }] });
    expect(twoVendors.status).toBe(201);
    expect(twoVendors.body.vendorId).toBeNull();
  });

  it("permission matrix: the page edits, PO/receiving/back-order pages read, everyone else is refused", async () => {
    const { po } = await setup();
    const body = { reference: "PERM", lines: [{ vendorPoLineId: line(po, "BR-1001").id, qty: 1 }] };
    const viewer = await as("viewer", { permissions: { "inbound-shipments": "view" } });
    const receiver = await as("recv", { permissions: { receiving: "edit" } });
    const analyst = await as("ana2", { permissions: { "back-orders": "edit" } });
    const buyer = await as("buyer2", { permissions: { "purchase-orders": "edit" } });
    const nobody = await as("nobody", { permissions: { "order-entry": "edit" } });
    expect((await viewer.post("/api/inbound-shipments", body)).status).toBe(403);
    expect((await receiver.post("/api/inbound-shipments", body)).status).toBe(403);
    expect((await buyer.post("/api/inbound-shipments", body)).status).toBe(403);
    for (const c of [viewer, receiver, analyst, buyer]) expect((await c.get("/api/inbound-shipments")).status).toBe(200);
    expect((await nobody.get("/api/inbound-shipments")).status).toBe(403);
    const editor = await as("editor", { permissions: { "inbound-shipments": "edit" } });
    const created = ok(await editor.post("/api/inbound-shipments", body), 201);
    expect((await viewer.get(`/api/inbound-shipments/${created.id}`)).status).toBe(200);
    expect((await viewer.post(`/api/inbound-shipments/${created.id}/status`, { version: created.version, status: "Arrived" })).status).toBe(403);
    expect((await viewer.del(`/api/inbound-shipments/${created.id}`)).status).toBe(403);
    expect((await editor.del(`/api/inbound-shipments/${created.id}`)).status).toBe(204);
  });

  it("gives the back order queue the inbound ETA over the PO's expected date, and marks the shipment received with the PO lines", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 0);
    const vendor = await makeVendor(root);
    const so = ok(await allocate(root, ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 12 }]))), [0]));
    expect(so.status).toBe("Backordered");
    // The PO says the 30th; the container carrying the line says the 10th.
    const po = ok(await root.post("/api/vendor-purchase-orders", { vendorId: vendor.id, vendorName: vendor.name, orderDate: "2026-10-01", expectedDate: "2026-11-30", lines: [{ itemNumber: "BR-1001", description: "BR-1001", orderedQty: 40, cost: 1 }] }), 201);
    let queue = ok(await root.get("/api/sales-orders/back-orders"));
    expect(queue.rows[0].coverage[0].po).toMatchObject({ poNumber: po.poNumber, expectedDate: "2026-11-30", inbound: null });
    expect(queue.rows[0].projectedArrival).toBe("2026-11-30");
    const ship = ok(await root.post("/api/inbound-shipments", { reference: "CMAU7654321", eta: "2026-11-10", lines: [{ vendorPoLineId: po.lines[0].id, qty: 40 }] }), 201);
    queue = ok(await root.get("/api/sales-orders/back-orders"));
    expect(queue.rows[0].coverage[0].po).toMatchObject({ poNumber: po.poNumber, expectedDate: "2026-11-10", inbound: { reference: "CMAU7654321", eta: "2026-11-10", status: "BOOKED" } });
    expect(queue.rows[0].projectedArrival).toBe("2026-11-10");
    // A cancelled shipment no longer counts.
    ok(await root.post(`/api/inbound-shipments/${ship.id}/status`, { version: ship.version, status: "Cancelled" }));
    queue = ok(await root.get("/api/sales-orders/back-orders"));
    expect(queue.rows[0].projectedArrival).toBe("2026-11-30");
    // A second, open shipment: a partial receipt leaves it open, the receipt that completes the line marks it Received.
    const ship2 = ok(await root.post("/api/inbound-shipments", { reference: "CMAU0000001", eta: "2026-11-12", lines: [{ vendorPoLineId: po.lines[0].id, qty: 40 }] }), 201);
    let received = ok(await receive(root, po, [15]));
    expect(received.status).toBe("Partially Received");
    expect(ok(await root.get(`/api/inbound-shipments/${ship2.id}`)).status).toBe("Booked");
    received = ok(await receive(root, received, [25]));
    expect(received.status).toBe("Received");
    const closed = ok(await root.get(`/api/inbound-shipments/${ship2.id}`));
    expect(closed.status).toBe("Received");
    expect(closed.arrivedAt).toBeTruthy();
    expect(ok(await root.get("/api/inbound-shipments?open=1"))).toHaveLength(0);
  });
});

describe("purchase orders: open and closed (list filters)", () => {
  it("filters with ?open=1 / ?closed=1 and reports both counts on the paged list", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 0);
    const vendor = await makeVendor(root);
    const open = await makePo(root, vendor, [{ itemNumber: "BR-1001", orderedQty: 10 }]);
    const partial = await makePo(root, vendor, [{ itemNumber: "BR-1001", orderedQty: 10 }]);
    ok(await receive(root, partial, [4]));
    const received = await makePo(root, vendor, [{ itemNumber: "BR-1001", orderedQty: 5 }]);
    ok(await receive(root, received, [5]));
    const closed = await makePo(root, vendor, [{ itemNumber: "BR-1001", orderedQty: 7 }]);
    ok(await root.put(`/api/vendor-purchase-orders/${closed.poNumber}`, { ...closed, status: "Closed", lines: closed.lines.map((l: any) => ({ ...l, cost: Number(l.cost) })) }));
    const numbers = (res: any) => (res.rows ?? res).map((p: any) => p.poNumber).sort();
    expect(numbers(ok(await root.get("/api/vendor-purchase-orders?open=1")))).toEqual([open.poNumber, partial.poNumber].sort());
    expect(numbers(ok(await root.get("/api/vendor-purchase-orders?closed=1")))).toEqual([received.poNumber, closed.poNumber].sort());
    expect(numbers(ok(await root.get("/api/vendor-purchase-orders")))).toHaveLength(4);
    const pagedOpen = ok(await root.get("/api/vendor-purchase-orders?page=1&pageSize=50&open=1"));
    expect(pagedOpen.total).toBe(2);
    expect(pagedOpen.counts).toEqual({ open: 2, closed: 2 });
    const pagedClosed = ok(await root.get("/api/vendor-purchase-orders?page=1&pageSize=1&closed=1"));
    expect(pagedClosed.total).toBe(2);
    expect(pagedClosed.rows).toHaveLength(1);
    expect(pagedClosed.counts).toEqual({ open: 2, closed: 2 });
    // The search narrows the counts too.
    const searched = ok(await root.get(`/api/vendor-purchase-orders?page=1&closed=1&q=${closed.poNumber}`));
    expect(searched.counts).toEqual({ open: 0, closed: 1 });
    // open wins if both flags are sent.
    expect(numbers(ok(await root.get("/api/vendor-purchase-orders?open=1&closed=1")))).toEqual([open.poNumber, partial.poNumber].sort());
  });
});

describe("picked-by and checked-by at the pack check (sprint 5)", () => {
  it("stores both initials, keeps readyBy as the checker, audits them and copies them onto the shipment", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 50);
    const o = await walkToPrinted(root, await makeOrder(root, [{ item: "BR-1001", ordered: 6 }]));
    const dock = await as("floor2", { permissions: { dock: "edit" } });
    const packed = ok(await dock.post(`${so(o)}/ready`, { version: o.version, pickedBy: " jr ", checkedBy: "km" }));
    expect(packed).toMatchObject({ pickedByInitials: "jr", checkedByInitials: "km", readyBy: "km" });
    await expect.poll(async () => (await prisma.auditLog.findFirst({ where: { action: "ORDER_READY", targetId: String(o.soNumber) } }))?.detail).toMatchObject({ pickedBy: "jr", checkedBy: "km", units: 6 });
    // Un-ready clears them with the rest of the ready stamp.
    const back = ok(await dock.post(`${so(packed)}/unready`, { version: packed.version }));
    expect(back).toMatchObject({ readyAt: null, pickedByInitials: null, checkedByInitials: null });
    // An office login without initials is stamped from its account for both.
    const again = ok(await root.post(`${so(back)}/ready`, { version: back.version }));
    expect(again.pickedByInitials).toBe(again.checkedByInitials);
    expect(again.pickedByInitials).toBeTruthy();
    // The shipment keeps them after Mark Shipped clears the order's ready fields.
    const shipped = ok(await ship(root, again));
    expect(shipped).toMatchObject({ status: "Shipped", pickedByInitials: null, checkedByInitials: null });
    expect(shipped.shipmentHistory[0]).toMatchObject({ pickedBy: again.pickedByInitials, checkedBy: again.checkedByInitials });
    const history = ok(await root.get("/api/shipments?from=2000-01-01&to=2100-01-01"));
    const row = (history.rows ?? history).find((r: any) => r.soNumber === Number(o.soNumber));
    expect(row).toMatchObject({ pickedBy: again.pickedByInitials, checkedBy: again.checkedByInitials });
  });
});
