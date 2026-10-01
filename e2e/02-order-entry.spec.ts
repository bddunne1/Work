import { expect, test } from "@playwright/test";
import { api, seed, signIn } from "./helpers";

// Enter an order from a customer PO: pick the customer, add a line, save.
test("enter an order", async ({ page }) => {
  const state = seed();
  await signIn(page);
  await page.goto("/#/order-entry");
  await page.locator("#customer-search").fill(state.customerName);
  await page.locator(".search-select-menu li", { hasText: state.customerName }).first().click();
  await expect(page.locator("#customer-search")).toHaveValue(new RegExp(state.customerName));
  const firstRow = page.locator(".line-item-table tbody tr").first();
  const itemInput = firstRow.locator("input").first();
  await itemInput.fill(state.itemNumbers[0]);
  await itemInput.blur();
  await expect(firstRow.locator("input").nth(2)).toHaveValue(/Smoke test rope/);
  await firstRow.locator("input[type=number]").first().fill("12");
  // The catalog rate filled in with the item.
  await expect(firstRow.locator("input[type=number]").nth(1)).toHaveValue("2.5");
  await page.locator(".order-details-table input").first().fill("PO-SMOKE-1");
  await page.getByRole("button", { name: "Save Order" }).click();
  await expect(page.getByRole("heading", { name: /Order S\.O\. #\d+ saved/ })).toBeVisible();
  // The order is on the server with its line.
  const list = await api("GET", `/api/sales-orders/search?customerId=${state.customerId}&sort=soNumber&dir=desc&pageSize=1`);
  expect(list.rows[0].lineItems[0]).toMatchObject({ item: state.itemNumbers[0], ordered: 12, rate: "2.5" });
  expect(list.rows[0].poNumber).toBe("PO-SMOKE-1");
  expect(list.rows[0].status).toBe("Entered");
});
