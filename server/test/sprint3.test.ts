// Sprint 3: a human at every check, back orders flagged on receipt, the
// order claim, the floor's Ready to ship stage, carrier details, cost.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";
import { fakeQuickBooks } from "../src/integrations/quickbooks/fake.js";
import { admin, allocate, as, check, getOrder, itemByNumber, makeItem, makeOrder, makePo, makeVendor, markPrinted, ok, ready, receive, release, resetDb, so, undoShipment, unready, walkToPrinted, walkToReady } from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  fakeQuickBooks.reset();
});

describe("maker is not checker (G-10)", () => {
  it("refuses the check by the person who entered the order; another validator or an admin may", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const entry = await as("entry", { permissions: { "order-entry": "edit", validation: "edit" } });
    const other = await as("val", { permissions: { validation: "edit" } });
    const mine = await makeOrder(entry, [{ item: "BR-1001", ordered: 2 }]);
    const refused = await check(entry, mine);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/another person has to check it/);
    expect(refused.body.makerIsChecker).toBe(true);
    expect((await getOrder(root, mine.soNumber)).status).toBe("Entered");
    expect(ok(await check(other, mine)).status).toBe("Checked");
    // Admin may check its own.
    const own = await makeOrder(root, [{ item: "BR-1001", ordered: 1 }]);
    expect(ok(await check(root, own)).status).toBe("Checked");
  });
});

describe("back orders flagged on receipt (G-06)", () => {
  it("flags every back order holding a received item, shows coverage, and clears on the next decision", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 5);
    await makeItem(root, "BR-2002", 0);
    const vendor = await makeVendor(root);
    // Two back orders short of BR-1001, one of BR-2002 only.
    let a = ok(await allocate(root, ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 20 }], { dueDate: "2026-10-05" }))), [0]));
    let b = ok(await allocate(root, ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 3 }, { item: "BR-2002", ordered: 4 }], { dueDate: "2026-10-06" }))), [0, 0]));
    const c = ok(await allocate(root, ok(await check(root, await makeOrder(root, [{ item: "BR-2002", ordered: 9 }]))), [0]));
    expect([a.status, b.status, c.status]).toEqual(["Backordered", "Backordered", "Backordered"]);
    let queue = ok(await root.get("/api/sales-orders/back-orders"));
    expect(queue.counts).toEqual({ arrived: 0, covered: 0, uncovered: 3 });
    // A PO for BR-1001 covers a and b's short line; c stays uncovered.
    const po = await makePo(root, vendor, [{ itemNumber: "BR-1001", orderedQty: 40 }]);
    queue = ok(await root.get("/api/sales-orders/back-orders"));
    const row = (soNumber: any) => queue.rows.find((r: any) => r.soNumber === soNumber);
    expect(row(a.soNumber).group).toBe("covered");
    expect(row(b.soNumber).group).toBe("uncovered"); // BR-2002 line has no PO
    expect(row(c.soNumber).group).toBe("uncovered");
    expect(row(a.soNumber).coverage[0]).toMatchObject({ item: "BR-1001", remaining: 20, free: 5, coverage: "partial", po: { poNumber: po.poNumber, outstanding: 40 } });
    // Receiving flags both orders holding BR-1001, not the BR-2002-only one, and allocates nothing.
    const received = ok(await receive(root, po, [40]));
    expect(received.status).toBe("Received");
    queue = ok(await root.get("/api/sales-orders/back-orders"));
    expect(queue.counts).toEqual({ arrived: 2, covered: 0, uncovered: 1 });
    expect(row(a.soNumber).group).toBe("arrived");
    expect(row(a.soNumber).stockArrivedAt).toBeTruthy();
    expect(row(a.soNumber).coverage[0]).toMatchObject({ free: 45, coverage: "full" });
    expect(row(a.soNumber).fillableNow).toBe(true);
    expect(row(b.soNumber).group).toBe("arrived");
    expect(row(b.soNumber).fillableNow).toBe(false);
    expect(row(c.soNumber).stockArrivedAt).toBeNull();
    expect((await itemByNumber("BR-1001"))!.qtyReserved).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { action: "VENDOR_PO_RECEIVED", targetId: po.poNumber } });
    expect(audit!.detail).toMatchObject({ backOrdersFlagged: 2 });
    const summary = ok(await root.get("/api/dashboard/summary"));
    expect(summary.queues.arrived.count).toBe(2);
    expect(summary.queues.backorder.count).toBe(1);
    // The analyst's decision clears the flag, whether they allocate or hold again.
    a = await getOrder(root, a.soNumber);
    a = ok(await allocate(root, a));
    expect(a.status).toBe("Allocated");
    expect(a.stockArrivedAt).toBeNull();
    b = await getOrder(root, b.soNumber);
    b = ok(await allocate(root, b, [0, 0]));
    expect(b.status).toBe("Backordered");
    expect(b.stockArrivedAt).toBeNull();
    queue = ok(await root.get("/api/sales-orders/back-orders"));
    expect(queue.counts).toEqual({ arrived: 0, covered: 0, uncovered: 2 });
  });
});

describe("order claim (C-08)", () => {
  it("holds an order for ten minutes for one reviewer, shows who, and ends with the decision or when it runs out", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const derek = await as("an.derek", { permissions: { validation: "edit", allocation: "edit" } });
    const sofia = await as("an.sofia", { permissions: { validation: "edit", allocation: "edit" } });
    const o = await makeOrder(root, [{ item: "BR-1001", ordered: 2 }]);
    const claimed = ok(await derek.post(`${so(o)}/claim`, {}));
    expect(claimed.claim).toMatchObject({ by: "an.derek" });
    expect(claimed.version).toBe(o.version);
    // Visible on the open list; refused for the other analyst.
    const listed = ok(await sofia.get("/api/sales-orders?open=1")).find((x: any) => x.soNumber === o.soNumber);
    expect(listed.claim.by).toBe("an.derek");
    const refused = await sofia.post(`${so(o)}/claim`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.claimedBy).toBe("an.derek");
    // Re-claiming by the holder extends; the other cannot release it, the holder can.
    expect(ok(await derek.post(`${so(o)}/claim`, {})).claim.by).toBe("an.derek");
    expect(ok(await sofia.post(`${so(o)}/unclaim`, {})).claim.by).toBe("an.derek");
    expect(ok(await derek.post(`${so(o)}/unclaim`, {})).claim).toBeNull();
    // The decision ends the claim.
    ok(await derek.post(`${so(o)}/claim`, {}));
    const checked = ok(await check(sofia, o));
    expect(checked.claim).toBeNull();
    // An old claim runs out on its own.
    ok(await derek.post(`${so(o)}/claim`, {}));
    await prisma.salesOrder.update({ where: { soNumber: Number(o.soNumber) }, data: { claimedUntil: new Date(Date.now() - 1000) } });
    expect((await getOrder(root, o.soNumber)).claim).toBeNull();
    expect(ok(await sofia.post(`${so(o)}/claim`, {})).claim.by).toBe("an.sofia");
    // Nobody without a review page can claim.
    const dock = await as("dock", { permissions: { "open-picks": "edit" } });
    expect((await dock.post(`${so(o)}/claim`, {})).status).toBe(403);
  });
});

describe("ready to ship (decided 1 Oct) and release-and-print (G-05)", () => {
  it("packs at the pack check, prints the slip from what was packed, and ships exactly that", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    await makeItem(root, "BR-2002", 100);
    let o = await walkToPrinted(root, await makeOrder(root, [{ item: "BR-1001", ordered: 10 }, { item: "BR-2002", ordered: 4 }]));
    expect(o.readyAt).toBeNull();
    // No shipment before the pack check.
    const early = await root.post(`${so(o)}/ship`, { version: o.version, lines: o.pendingShipment });
    expect(early.status).toBe(409);
    expect(early.body.notReady).toBe(true);
    // The warehouse login does the pack check on its shared account, with initials typed.
    const dock = await as("floor", { permissions: { dock: "edit" } });
    expect((await dock.get(so(o))).status).toBe(200);
    expect((await dock.get(so(o))).body.pricesHidden).toBe(true);
    const packed = ok(await ready(dock, o, [8, 4], "KM"));
    expect(packed.readyAt).toBeTruthy();
    expect(packed.readyBy).toBe("KM");
    expect(packed.packingSlipPrintedAt).toBeTruthy();
    expect(packed.pendingShipment).toEqual([{ lineItemId: o.lineItems[0].id, qty: 8 }, { lineItemId: o.lineItems[1].id, qty: 4 }]);
    expect((await itemByNumber("BR-1001"))!.qtyReserved).toBe(8);
    const audit = await prisma.auditLog.findFirst({ where: { action: "ORDER_READY", targetId: String(o.soNumber) } });
    expect(audit!.detail).toMatchObject({ units: 12, shorts: 2, packedBy: "KM" });
    // Shipping anything other than what was packed is refused; the packed quantities ship.
    const changed = await dock.post(`${so(packed)}/ship`, { version: packed.version, lines: [{ lineItemId: o.lineItems[0].id, qty: 7 }, { lineItemId: o.lineItems[1].id, qty: 4 }] });
    expect(changed.status).toBe(409);
    expect(changed.body.error).toMatch(/packed at the pack check/);
    // A short found at pickup: back to the floor, re-check, then ship.
    const back = ok(await unready(dock, packed));
    expect(back.readyAt).toBeNull();
    expect(back.pendingShipment).toEqual(packed.pendingShipment);
    const again = ok(await ready(dock, back, [8, 3]));
    const shipped = ok(await dock.post(`${so(again)}/ship`, { version: again.version, lines: again.pendingShipment }));
    expect(shipped.status).toBe("Backordered");
    expect(shipped.readyAt).toBeNull();
    expect((await itemByNumber("BR-1001"))!).toMatchObject({ qtyOnHand: 92, qtyReserved: 0 });
    expect((await itemByNumber("BR-2002"))!).toMatchObject({ qtyOnHand: 97, qtyReserved: 0 });
    // Undo puts it back on the dock, ready.
    const undone = ok(await undoShipment(root, shipped));
    expect(undone.readyAt).toBeTruthy();
    expect(undone.status).toBe("Pick & Packed");
    // Nobody without the dock or Open Picks can do the pack check.
    const analyst = await as("an", { permissions: { allocation: "edit", "pick-pack": "edit" } });
    expect((await analyst.post(`${so(undone)}/unready`, { version: undone.version })).status).toBe(403);
    // Summary counts the two floor stages apart.
    const s = ok(await root.get("/api/dashboard/summary"));
    expect(s.queues.ship.count).toBe(1);
    expect(s.queues.pack.count).toBe(0);
  });

  it("releases and prints the pick list in one step", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = ok(await allocate(root, ok(await check(root, await makeOrder(root, [{ item: "BR-1001", ordered: 3 }])))));
    const res = ok(await root.post("/api/sales-orders/release", { print: true, orders: [{ soNumber: o.soNumber, version: o.version }] }));
    o = res.orders[0];
    expect(o.status).toBe("Pick & Packed");
    expect(o.pickListPrintedAt).toBeTruthy();
    expect(o.packingSlipPrintedAt).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: "ORDER_STATUS_CHANGED", targetId: String(o.soNumber) }, orderBy: { createdAt: "desc" } });
    expect(audit!.detail).toMatchObject({ to: "Pick & Packed", printed: true });
    // Straight to the pack check; the slip prints there.
    o = ok(await ready(root, o));
    expect(o.packingSlipPrintedAt).toBeTruthy();
    // A pick list reprint from Open Picks is still allowed.
    expect((await markPrinted(root, o)).status).toBe(200);
    void release;
  });
});

describe("carrier details on the order (G-07, decided 1 Oct)", () => {
  const bol = {
    weight: "40",
    packageCount: "2",
    palletSlip: "Y" as const,
    handlingUnitQty: "1",
    handlingUnitType: "Pallet",
    packageQty: "2",
    packageType: "Cartons",
    hazmat: false,
    commodityDescription: "Rope",
    nmfcNumber: "",
    freightClass: "",
    additionalInfo: "",
    generatedAt: new Date().toISOString(),
  };

  it("saves carrier, SCAC, PRO and pickup date at the BOL step and at Mark Shipped, on the order and the shipment", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    let o = await walkToPrinted(root, await makeOrder(root, [{ item: "BR-1001", ordered: 4 }]));
    // The BOL step saves the carrier it was written for.
    o = ok(await root.post(`${so(o)}/set-bol`, { version: o.version, bol, carrier: { carrier: "Central Transport", scac: "ctii", pickupDate: "2026-10-02" } }));
    expect(o).toMatchObject({ carrier: "Central Transport", scac: "CTII", proNumber: null });
    expect(o.pickupDate).toMatch(/^2026-10-02/);
    // A bad SCAC or a half-typed date is refused.
    expect((await root.post(`${so(o)}/set-bol`, { version: o.version, bol, carrier: { scac: "TOO-LONG-FOR-A-SCAC" } })).status).toBe(400);
    expect((await root.post(`${so(o)}/set-bol`, { version: o.version, bol, carrier: { pickupDate: "2026-1" } })).status).toBe(400);
    // Mark Shipped adds the PRO the driver hands over; the rest carries.
    o = ok(await ready(root, o));
    const shipped = ok(await root.post(`${so(o)}/ship`, { version: o.version, lines: o.pendingShipment, carrier: { proNumber: "PRO-778899" } }));
    expect(shipped).toMatchObject({ status: "Shipped", carrier: "Central Transport", scac: "CTII", proNumber: "PRO-778899" });
    expect(shipped.pickupDate).toMatch(/^2026-10-02/);
    expect(shipped.shipmentHistory[0]).toMatchObject({ carrier: "Central Transport", scac: "CTII", proNumber: "PRO-778899" });
    const audit = await prisma.auditLog.findFirst({ where: { action: "ORDER_SHIPPED", targetId: String(o.soNumber) } });
    expect(audit!.detail).toMatchObject({ proNumber: "PRO-778899" });
    // The PRO finds the order and its shipment.
    const search = ok(await root.get("/api/sales-orders/search?q=778899"));
    expect(search.rows.map((r: any) => r.soNumber)).toEqual([shipped.soNumber]);
    const ships = ok(await root.get("/api/shipments?q=PRO-7788&from=2000-01-01&to=2100-01-01"));
    expect(ships.rows).toHaveLength(1);
    expect(ships.rows[0]).toMatchObject({ soNumber: Number(o.soNumber), carrier: "Central Transport", proNumber: "PRO-778899", pickupDate: "2026-10-02" });
  });

  it("defaults the pickup date to the ship date when none was given, and the dock may enter the PRO", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const dock = await as("dock", { permissions: { dock: "edit" } });
    const o = await walkToReady(root, await makeOrder(root, [{ item: "BR-1001", ordered: 2 }]));
    const shipped = ok(await dock.post(`${so(o)}/ship`, { version: o.version, lines: o.pendingShipment, carrier: { carrier: "UPS Freight", proNumber: "1Z999" } }));
    expect(shipped.pickupDate).toMatch(new RegExp(`^${new Date().toISOString().slice(0, 10)}`));
    expect(shipped.shipmentHistory[0]).toMatchObject({ carrier: "UPS Freight", proNumber: "1Z999" });
    expect(shipped.carrier).toBe("UPS Freight");
  });

  it("keeps the BOL defaults as a setting and refuses a malformed one", async () => {
    const root = await admin();
    const good = { unitsPerPackage: 12, packagesPerHandlingUnit: 40, handlingUnitType: "Pallet", packageType: "Cartons", freightClass: "70", nmfcNumber: "50040" };
    expect((await root.put("/api/settings/bol_defaults", { value: good })).status).toBe(204);
    expect((await root.put("/api/settings/bol_defaults", { value: { ...good, unitsPerPackage: 0 } })).status).toBe(400);
    expect((await root.put("/api/settings/bol_defaults", { value: { ...good, extra: 1 } })).status).toBe(400);
    const all = ok(await root.get("/api/settings"));
    expect(all.bol_defaults).toEqual(good);
  });
});

describe("item cost and margin (E-05, E-02)", () => {
  it("keeps the last purchase cost on the item, updates it on receipt, and shows it only to those who may see cost", async () => {
    const root = await admin();
    const item = ok(await root.post("/api/items", { itemNumber: "CO-1001", description: "Costed rope", um: "EA", rate: 10, cost: 4.25, qtyOnHand: 20, weight: 1 }), 201);
    expect(Number(item.cost)).toBe(4.25);
    // A receipt overwrites it with the PO line's cost.
    const vendor = await makeVendor(root);
    const po = await makePo(root, vendor, [{ itemNumber: "CO-1001", orderedQty: 50, cost: 4.6 }]);
    await receive(root, po, [50]);
    expect(Number((await itemByNumber("CO-1001"))!.cost)).toBe(4.6);
    // Purchasing and the catalog editor see it; a dock login and an order-entry login do not.
    const buyer = await as("buyer", { permissions: { "purchase-orders": "edit", receiving: "edit" } });
    const dock = await as("dock", { permissions: { dock: "edit" } });
    const clerk = await as("clerk", { permissions: { "order-entry": "edit", catalog: "view" } });
    expect(Number(ok(await buyer.get(`/api/items/${item.id}`)).cost)).toBe(4.6);
    expect(ok(await dock.get(`/api/items/${item.id}`))).not.toHaveProperty("cost");
    const listed = ok(await clerk.get("/api/items")).find((i: any) => i.itemNumber === "CO-1001");
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty("cost");
    // The audit names the field when the catalog editor changes it.
    const edited = ok(await root.put(`/api/items/${item.id}`, { ...ok(await root.get(`/api/items/${item.id}`)), cost: 5, rate: 10, weight: 1 }));
    expect(Number(edited.cost)).toBe(5);
    const audit = await prisma.auditLog.findFirst({ where: { action: "ITEM_UPDATED", targetId: item.id }, orderBy: { createdAt: "desc" } });
    expect(audit!.detail).toHaveProperty("cost");
  });

  it("puts margin on the quick report and analytics for those who may see cost, and leaves cost out for the rest", async () => {
    const root = await admin();
    const item = ok(await root.post("/api/items", { itemNumber: "CO-2002", description: "Costed twine", um: "EA", rate: 8, cost: 6, qtyOnHand: 100, weight: 1 }), 201);
    const o = await walkToReady(root, await makeOrder(root, [{ item: "CO-2002", ordered: 10, rate: 8 }]));
    const shipped = ok(await root.post(`${so(o)}/ship`, { version: o.version, lines: o.pendingShipment }));
    const draft = ok(await root.get(`/api/invoices?soNumber=${shipped.soNumber}&status=DRAFT`)).rows[0];
    ok(await root.post(`/api/invoices/${draft.id}/issue`, { version: draft.version }));

    const report = ok(await root.get(`/api/items/${item.id}/quick-report`));
    expect(report.costHidden).toBe(false);
    expect(report.summary).toMatchObject({ cost: 6, valueAtCost: 540, margin: 2 });
    expect(report.soLines[0]).toMatchObject({ rate: 8, margin: 2, lineMargin: 20 });

    const month = new Date().toISOString().slice(0, 7);
    const summary = ok(await root.get(`/api/analytics/summary?thisMonth=${month}`));
    expect(summary.margin).toMatchObject({ gross: 20, pct: 25, grossThisMonth: 20, uncosted: 0 });
    expect(summary.inventory.totalCost).toBe(540);

    // Customer service sees prices but not cost: no margin, no cost anywhere.
    const cs = await as("cs", { permissions: { "order-entry": "edit", "order-detail": "view", analytics: "view", catalog: "view" } });
    const theirs = ok(await cs.get(`/api/items/${item.id}/quick-report`));
    expect(theirs.costHidden).toBe(true);
    expect(theirs.summary).not.toHaveProperty("cost");
    expect(theirs.soLines[0]).toHaveProperty("rate");
    expect(theirs.soLines[0]).not.toHaveProperty("margin");
    expect(theirs.poLines.every((l: any) => !("cost" in l))).toBe(true);
    const theirSummary = ok(await cs.get(`/api/analytics/summary?thisMonth=${month}`));
    expect(theirSummary.margin).toBeUndefined();
    expect(theirSummary.inventory.totalCost).toBeUndefined();
  });
});
