// Sprint 4: allocating beyond on hand (allocation-override), inbound
// shipments, and the Purchase Orders open/closed filter.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";
import { admin, allocate, as, check, getOrder, makeItem, makeOrder, ok, resetDb } from "./helpers.js";

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
