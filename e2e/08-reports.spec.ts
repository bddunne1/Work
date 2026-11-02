import { expect, test } from "@playwright/test";
import { acceptDialogs, api, orderPrinted, seed, signIn, so } from "./helpers";

// The Report Center: Sales by Customer Summary over an invoiced order,
// QuickZoom from its amount into the detail, the order behind a detail
// line, and memorizing the report.
test("sales by customer summary, zoom to detail, open the order, memorize", async ({ page }) => {
  const state = seed();
  // An invoiced sale to report on: packed, shipped and issued through the API.
  let order = await orderPrinted(state, [{ item: state.itemNumbers[0], ordered: 5, rate: 3 }]);
  order = await api("POST", `${so(order)}/ready`, { version: order.version, pickedBy: "E2", checkedBy: "E2" });
  order = await api("POST", `${so(order)}/ship`, { version: order.version, lines: order.pendingShipment });
  const draft = (await api("GET", `/api/invoices?soNumber=${order.soNumber}&status=DRAFT`)).rows[0];
  await api("POST", `/api/invoices/${draft.id}/issue`, { version: draft.version });
  acceptDialogs(page);
  await signIn(page);

  await page.goto("/#/reports");
  await expect(page.getByRole("heading", { name: "Report Center" })).toBeVisible();
  const card = page.getByTestId("report-card-sales-by-customer-summary");
  await card.getByLabel("Sales by Customer Summary date range").selectOption("all");
  await card.getByRole("button", { name: "Run" }).click();

  await expect(page.getByRole("heading", { name: "Sales by Customer Summary" })).toBeVisible();
  const row = page.locator(".report-grid tbody tr", { hasText: state.customerName });
  await expect(row).toBeVisible();
  // This sale (5 x 3.00 = 15.00) is in the customer's row. Other specs and
  // earlier runs invoice the same customer, so the row holds at least that.
  const amount = parseFloat(((await row.locator("td").last().textContent()) ?? "0").replace(/,/g, ""));
  expect(amount).toBeGreaterThanOrEqual(15);
  await expect(page.locator(".report-grid tfoot .report-total")).toBeVisible();

  // QuickZoom: the amount opens the invoice lines behind it.
  await row.locator("td a.report-zoom").last().click();
  await expect(page.getByRole("heading", { name: new RegExp(`Sales by Customer Summary: ${state.customerName}`) })).toBeVisible();
  await expect(page.locator(".report-filter-chip", { hasText: `Customer is ${state.customerName}` })).toBeVisible();
  const detailRow = page.locator(".report-grid-detail tbody tr", { hasText: String(order.soNumber) }).first();
  await expect(detailRow).toBeVisible();
  await expect(detailRow).toContainText(state.itemNumbers[0]);

  // The S.O. # on the line opens the order; Back returns to the detail.
  await detailRow.getByRole("link", { name: String(order.soNumber) }).click();
  await expect(page).toHaveURL(new RegExp(`#/storage/${order.soNumber}`));
  await page.goBack();
  await expect(page.locator(".report-grid-detail tbody tr").first()).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Sales by Customer Summary" })).toBeVisible();

  // Memorize it, and find it under Memorized.
  await page.getByRole("button", { name: "Memorize" }).click();
  const name = `Smoke sales ${Date.now().toString().slice(-6)}`;
  await page.getByLabel("Memorized report name").fill(name);
  await page.getByRole("button", { name: "Memorize report" }).click();
  await expect(page.getByText(`Memorized "${name}".`)).toBeVisible();
  await page.goto("/#/reports");
  await page.getByRole("tab", { name: /Memorized/ }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  const saved = (await api("GET", "/api/saved-reports")).find((r: any) => r.name === name);
  expect(saved.spec).toMatchObject({ source: "invoice-lines", kind: "summary", rows: ["customer"], dateRange: { preset: "all" } });
});
