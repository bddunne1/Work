import { expect, test } from "@playwright/test";
import { api, makeOrder, seed, signIn, so } from "./helpers";

// The analyst's morning: check the order, allocate stock, release the pick.
test("validate, allocate and release an order", async ({ page }) => {
  const state = seed();
  const order = await makeOrder(state, [{ item: state.itemNumbers[0], ordered: 5 }, { item: state.itemNumbers[1], ordered: 2 }]);
  await signIn(page);

  await page.goto(`/#/validation/${order.soNumber}`);
  await page.getByRole("button", { name: "Mark as Checked" }).click();
  await expect.poll(async () => (await api("GET", so(order))).status).toBe("Checked");

  await page.goto(`/#/allocation/${order.soNumber}`);
  await page.getByRole("button", { name: "Allocate All" }).click();
  await page.getByRole("button", { name: /Confirm/ }).click();
  await expect.poll(async () => (await api("GET", so(order))).status).toBe("Allocated");

  await page.goto(`/#/pick-pack/${order.soNumber}`);
  await page.getByRole("button", { name: "Release Order" }).click();
  await expect.poll(async () => (await api("GET", so(order))).status).toBe("Pick & Packed");
  const released = await api("GET", so(order));
  expect(released.pendingShipment.map((l: any) => l.qty).sort()).toEqual([2, 5]);
  // The stock is held for it.
  const item = (await api("GET", `/api/items?q=${state.itemNumbers[0]}`)).find?.((i: any) => i.itemNumber === state.itemNumbers[0]);
  if (item) expect(item.qtyReserved).toBeGreaterThanOrEqual(5);
});
