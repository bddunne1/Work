import { expect, test } from "@playwright/test";
import { acceptDialogs, api, orderReadyToShip, seed, signIn, so } from "./helpers";

// Logistics confirms the shipment; Accounting finds the draft invoice in
// the review queue and issues it.
test("ship an order and issue its invoice", async ({ page }) => {
  const state = seed();
  const order = await orderReadyToShip(state, [{ item: state.itemNumbers[0], ordered: 3, rate: 4 }]);
  acceptDialogs(page);
  await signIn(page);

  await page.goto(`/#/open-picks/${order.soNumber}`);
  await page.getByRole("button", { name: "Mark Shipped" }).click();
  await expect.poll(async () => (await api("GET", so(order))).status).toBe("Shipped");

  await page.goto("/#/invoices");
  const row = page.locator("tr.clickable-row", { hasText: String(order.soNumber) }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Draft");
  await row.click();
  await expect(page.getByRole("button", { name: "Approve and issue" })).toBeVisible();
  await page.getByRole("button", { name: "Approve and issue" }).click();
  await expect(page.getByText(/INV-\d+/).first()).toBeVisible();
  const issued = (await api("GET", `/api/invoices?soNumber=${order.soNumber}&status=ISSUED`)).rows[0];
  expect(issued.invoiceNumber).toMatch(/^INV-/);
  expect(Number(issued.total)).toBe(12);
});
