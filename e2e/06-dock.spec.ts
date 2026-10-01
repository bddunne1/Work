import { expect, test } from "@playwright/test";
import { WAREHOUSE_PASSWORD, api, orderPrinted, seed, signIn, so } from "./helpers";

// The shared floor login on the dock screen: finds the printed pick, does
// the pack check one short with the packer's initials, which marks the
// order Ready to ship, then marks it shipped when the carrier collects it.
test("the dock does the pack check with a short, then ships what was packed", async ({ page }) => {
  const state = seed();
  const order = await orderPrinted(state, [
    { item: state.itemNumbers[0], ordered: 5, rate: 2 },
    { item: state.itemNumbers[1], ordered: 2, rate: 3 },
  ]);
  await signIn(page, state.warehouseUsername, WAREHOUSE_PASSWORD);

  await page.goto("/#/dock");
  await expect(page.getByRole("heading", { name: /Being picked/ })).toBeVisible();
  await page.locator(".dock-card", { hasText: `#${order.soNumber}` }).first().click();
  await expect(page.getByRole("heading", { name: "Pack check" })).toBeVisible();
  // No prices on the floor.
  await expect(page.locator("body")).not.toContainText("$");

  // Initials are required of the shared login.
  await page.getByRole("button", { name: "Ready to ship · print packing slip" }).click();
  await expect(page.getByRole("alert")).toContainText("initials");

  // One short on the first line: 4 of 5 packed.
  await page.locator("input.allocate-qty-input").first().fill("4");
  await page.getByLabel("Packed by (initials)").fill("km");
  await page.getByRole("button", { name: "Ready to ship · print packing slip" }).click();
  await expect(page.getByRole("heading", { name: "Ready to ship" })).toBeVisible();
  await expect(page.getByText(/by KM/)).toBeVisible();

  const ready = await api("GET", so(order));
  expect(ready.readyAt).toBeTruthy();
  expect(ready.readyBy).toBe("KM");
  expect(ready.pendingShipment.map((l: any) => l.qty).sort()).toEqual([2, 4]);

  // The dock lists it as Ready to ship, then ships exactly what was packed.
  await page.goto("/#/dock");
  await expect(page.locator(".dock-stage-ready .dock-card", { hasText: `#${order.soNumber}` })).toBeVisible();
  await page.locator(".dock-stage-ready .dock-card", { hasText: `#${order.soNumber}` }).click();
  // The driver's PRO goes on at pickup; the carrier came from the order.
  await page.getByLabel("PRO #").fill("PRO-E2E-4471");
  await page.getByRole("button", { name: "Mark Shipped" }).click();
  await expect(page).toHaveURL(/#\/dock$/);
  await expect(page.locator(".dock-shipped")).toContainText(`#${order.soNumber}`);

  // The short leaves one unit owed, so the order goes to the back order
  // queue rather than Shipped.
  const shipped = await api("GET", so(order));
  expect(shipped.status).toBe("Backordered");
  expect(shipped.proNumber).toBe("PRO-E2E-4471");
  expect(shipped.shipmentHistory[0].proNumber).toBe("PRO-E2E-4471");
  const shippedUnits = shipped.shipmentHistory.flatMap((rec: any) => rec.lines).reduce((s: number, l: any) => s + l.qty, 0);
  expect(shippedUnits).toBe(6);
});
