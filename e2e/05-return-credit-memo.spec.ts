import { expect, test } from "@playwright/test";
import { acceptDialogs, api, orderReadyToShip, seed, signIn, so } from "./helpers";

// Customer service issues a return against a shipped order; receiving
// takes the goods back, which raises the credit memo Accounting issues.
test("issue and receive a return, then issue its credit memo", async ({ page }) => {
  const state = seed();
  let order = await orderReadyToShip(state, [{ item: state.itemNumbers[1], ordered: 4, rate: 3 }]);
  order = await api("POST", `${so(order)}/ship`, { version: order.version, lines: order.pendingShipment });
  const draft = (await api("GET", `/api/invoices?soNumber=${order.soNumber}&status=DRAFT`)).rows[0];
  await api("POST", `/api/invoices/${draft.id}/issue`, { version: draft.version });
  acceptDialogs(page);
  await signIn(page);

  await page.goto("/#/returns/new");
  await page.locator("#return-customer-search").fill(state.customerName);
  await page.locator(".search-select-menu li", { hasText: state.customerName }).first().click();
  await page.getByPlaceholder("e.g. 10042 (optional)").fill(String(order.soNumber));
  await page.getByPlaceholder(/Damaged in transit/).fill("Smoke test return");
  const rows = page.locator(".line-items tbody tr");
  if ((await rows.count()) === 0) await page.getByRole("button", { name: "+ Add Line Item" }).click();
  const row = rows.first();
  const itemInput = row.locator("input").first();
  await itemInput.fill(state.itemNumbers[1]);
  await itemInput.blur();
  await row.locator("input[type=number]").first().fill("2");
  await page.getByRole("button", { name: "Save Return Authorization" }).click();
  await expect(page.getByText(/RA-\d+/).first()).toBeVisible();
  const listed = await api("GET", `/api/returns?q=${order.soNumber}`);
  const ra = (Array.isArray(listed) ? listed : listed.rows ?? listed.returns ?? []).find((r: any) => r.soNumber === String(order.soNumber));
  expect(ra, "the new RA is listed").toBeTruthy();

  await page.goto(`/#/returns/${ra.raNumber}`);
  await page.getByRole("button", { name: "Receive Return" }).click();
  await expect(page.getByText(/awaiting review|Credit Memo/i).first()).toBeVisible();
  const memo = (await api("GET", `/api/invoices/credit-memos?q=${ra.raNumber}&status=DRAFT`)).rows.find((m: any) => m.raNumber === ra.raNumber);
  expect(memo).toBeTruthy();

  await page.goto(`/#/invoices/credit-memos/${memo.id}`);
  await page.getByRole("button", { name: "Approve and issue" }).click();
  await expect(page.getByText(/CM-\d+/).first()).toBeVisible();
  const issued = await api("GET", `/api/invoices/credit-memos/${memo.id}`);
  expect(issued.creditMemoNumber).toMatch(/^CM-/);
  expect(Number(issued.total)).toBe(6);
});
