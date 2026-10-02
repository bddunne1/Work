import { expect, test } from "@playwright/test";
import { api, seed, signIn } from "./helpers";

// Receiving a three-line PO (G-08): "Receive all outstanding" fills every
// line, one is corrected to 0 before Receive, and the receipt sets each
// received item's last purchase cost (E-05).
test("receive all outstanding, with one exception", async ({ page }) => {
  const state = seed();
  const address = { name: "Rope Supply Co", addressLine1: "1 Mill Rd", addressLine2: "", city: "Manteno", state: "IL", zip: "60950", notes: "" };
  const vendor = await api("POST", "/api/vendors", { name: `Smoke Vendor ${Date.now().toString(36)}`, contactName: "Rep", phone: "555", email: "rep@example.com", address });
  const third = `E2E-${Date.now().toString(36).toUpperCase().slice(-5)}-C`;
  await api("POST", "/api/items", { itemNumber: third, description: "Third smoke item", um: "EA", rate: 3, qtyOnHand: 0, weight: 1, components: [], links: [] });
  const po = await api("POST", "/api/vendor-purchase-orders", {
    vendorId: vendor.id,
    vendorName: vendor.name,
    orderDate: new Date().toISOString().slice(0, 10),
    lines: [
      { itemNumber: state.itemNumbers[0], description: "A", orderedQty: 24, cost: 1.1 },
      { itemNumber: state.itemNumbers[1], description: "B", orderedQty: 12, cost: 1.2 },
      { itemNumber: third, description: "C", orderedQty: 6, cost: 1.3 },
    ],
  });
  await signIn(page);

  await page.goto(`/#/purchase-orders/${po.poNumber}`);
  await page.getByRole("button", { name: "Receive all outstanding" }).click();
  const inputs = page.locator("input.allocate-qty-input");
  await expect(inputs).toHaveCount(3);
  await expect(inputs.nth(0)).toHaveValue("24");
  await expect(inputs.nth(1)).toHaveValue("12");
  await expect(inputs.nth(2)).toHaveValue("6");
  // The third line did not arrive.
  await inputs.nth(2).fill("0");
  await page.getByRole("button", { name: "Receive", exact: true }).click();

  await expect.poll(async () => (await api("GET", `/api/vendor-purchase-orders/${po.poNumber}`)).status).toBe("Partially Received");
  const after = await api("GET", `/api/vendor-purchase-orders/${po.poNumber}`);
  expect(after.lines.map((l: any) => l.receivedQty)).toEqual([24, 12, 0]);
  // The receipt set the received items' cost; the third keeps none.
  const items = await api("GET", "/api/items");
  const cost = (n: string) => items.find((i: any) => i.itemNumber === n)?.cost;
  expect(Number(cost(state.itemNumbers[0]))).toBe(1.1);
  expect(Number(cost(state.itemNumbers[1]))).toBe(1.2);
  expect(cost(third)).toBeNull();
});
