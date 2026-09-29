// Sprint 2: the fixes reported after sprint 1 went live, then the invoice
// review queue and the reservation table.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";
import { admin, makeItem, makeOrder, resetDb } from "./helpers.js";

beforeEach(async () => {
  await resetDb();
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
