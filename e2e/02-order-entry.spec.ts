import { expect, test } from "@playwright/test";
import { api, makeOrder, seed, signIn } from "./helpers";

// Enter an order from a customer PO on the keyboard grid (G-11): pick the
// customer, see the duplicate P.O. warning, then five lines typed with
// Enter only, and save.
test("enter a five-line order by keyboard, with a duplicate P.O. warning", async ({ page }) => {
  const state = seed();
  const earlier = await makeOrder(state, [{ item: state.itemNumbers[0], ordered: 1 }]);
  await signIn(page);
  await page.goto("/#/order-entry");
  await page.locator("#customer-search").fill(state.customerName);
  await page.locator(".search-select-menu li", { hasText: state.customerName }).first().click();
  await expect(page.locator("#customer-search")).toHaveValue(new RegExp(state.customerName));
  // The side panel shows the customer; the due date came from the lead time.
  await expect(page.locator(".order-side-panel")).toContainText(state.customerName);
  const dueDate = await page.locator('input[type="date"]').nth(1).inputValue();
  expect(dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // A P.O. already entered for this customer warns, and the warning goes
  // when the number changes.
  const poInput = page.getByLabel("P.O. No.");
  await poInput.fill(earlier.poNumber);
  await expect(page.locator(".field-warning")).toContainText(`S.O. #${earlier.soNumber}`);
  await expect(page.locator(".side-card-warning")).toContainText(earlier.poNumber);
  await poInput.fill("PO-SMOKE-KB");
  await expect(page.locator(".field-warning")).toHaveCount(0);

  // Five lines on the keyboard: item, Enter, quantity, Enter (rate), Enter (next line).
  // (The item is filled rather than typed: headless Chromium's datalist popup
  // swallows keystrokes, which a real browser does not.)
  await page.getByLabel("Line 1 item").click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByLabel(`Line ${i + 1} item`)).toBeFocused();
    await page.getByLabel(`Line ${i + 1} item`).fill(state.itemNumbers[i % 2]);
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(`Line ${i + 1} ordered`)).toBeFocused();
    await page.keyboard.type(String(10 + i));
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(`Line ${i + 1} rate`)).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByLabel("Line 6 item")).toBeFocused();
  // The lines resolved: description, catalog rate, availability shown.
  const firstRow = page.locator(".line-item-table tbody tr").first();
  await expect(firstRow.locator("input[data-cell=desc]")).toHaveValue(/Smoke test rope/);
  await expect(page.getByLabel("Line 1 rate")).toHaveValue("2.5");
  await expect(firstRow.locator(".avail-cell")).not.toHaveText("—");
  await expect(firstRow.locator(".price-source")).toHaveText("catalog");

  await page.getByRole("button", { name: "Save Order" }).click();
  await expect(page.getByRole("heading", { name: /Order S\.O\. #\d+ saved/ })).toBeVisible();
  // The order is on the server with its five lines; the blank sixth was dropped.
  const list = await api("GET", `/api/sales-orders/search?customerId=${state.customerId}&sort=soNumber&dir=desc&pageSize=1`);
  const order = list.rows[0];
  expect(order.poNumber).toBe("PO-SMOKE-KB");
  expect(order.status).toBe("Entered");
  expect(order.lineItems.map((l: any) => l.ordered)).toEqual([10, 11, 12, 13, 14]);
  expect(order.lineItems[0]).toMatchObject({ item: state.itemNumbers[0], rate: "2.5" });
  expect(order.dueDate.slice(0, 10)).toBe(dueDate);
});
