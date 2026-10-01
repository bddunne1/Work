// Sprint 3: a human at every check, back orders flagged on receipt, the
// order claim, the floor's Ready to ship stage, carrier details, cost.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";
import { fakeQuickBooks } from "../src/integrations/quickbooks/fake.js";
import { admin, allocate, as, check, getOrder, itemByNumber, makeItem, makeOrder, makePo, makeVendor, ok, receive, resetDb, so } from "./helpers.js";

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
