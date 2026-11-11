import { expect, test, type Page } from "@playwright/test";
import { api, makeVendor, seed } from "./helpers";

// Keyboard only: every step below is page.keyboard (plus focus() to start a
// walk from a known control); nothing is clicked.
const focusedText = (page: Page) => page.evaluate(() => (document.activeElement?.textContent ?? "").trim());
const focusedTag = (page: Page) => page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? "");

async function signInByKeyboard(page: Page) {
  await page.goto("/#/login");
  // The username field is autofocused; type straight into it.
  await expect(page.getByLabel("Username")).toBeFocused();
  await page.keyboard.type("admin");
  await page.keyboard.press("Tab");
  await page.keyboard.type(process.env.E2E_ADMIN_PASSWORD ?? "E2E-Director-2026");
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/#\/login/);
}

// Tab until the focused element matches, within a bounded number of stops.
async function tabTo(page: Page, matches: (text: string, tag: string) => boolean, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (matches(await focusedText(page), await focusedTag(page))) return;
  }
  throw new Error("Tab never reached the control");
}

test("skip link is the first tab stop and jumps to the main content", async ({ page }) => {
  await signInByKeyboard(page);
  await page.goto("/#/open-orders");
  await expect(page.getByRole("heading", { name: /Open Orders/ })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  // The next Tab lands inside the page, past the sidebar and top bar.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("#main-content")))).toBe(true);
});

test("enter an order with the customer picked by keyboard", async ({ page }) => {
  const state = seed();
  await signInByKeyboard(page);
  await page.goto("/#/order-entry");
  const customer = page.locator("#customer-search");
  await customer.focus();
  await page.keyboard.type(state.customerName);
  await expect(customer).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  const option = page.getByRole("option", { name: new RegExp(state.customerName) });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(customer).toHaveValue(new RegExp(state.customerName));
  await expect(customer).toHaveAttribute("aria-expanded", "false");
  // Focus stayed on the picker; the side panel shows the customer.
  await expect(customer).toBeFocused();
  await expect(page.locator(".order-side-panel")).toContainText(state.customerName);

  // P.O. number, then one line on the keyboard grid. (The item is filled,
  // not typed: headless Chromium's datalist popup swallows keystrokes.)
  const po = page.getByLabel("P.O. No.");
  await po.focus();
  await page.keyboard.type(`PO-KEYS-${Date.now().toString().slice(-5)}`);
  await page.getByLabel("Line 1 item").focus();
  await page.getByLabel("Line 1 item").fill(state.itemNumbers[0]);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Line 1 ordered")).toBeFocused();
  await page.keyboard.type("7");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Line 1 rate")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Line 2 item")).toBeFocused();

  await page.getByRole("button", { name: "Save Order" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /Order S\.O\. #\d+ saved/ })).toBeVisible();
  const order = (await api("GET", `/api/sales-orders/search?customerId=${state.customerId}&sort=soNumber&dir=desc&pageSize=1`)).rows[0];
  expect(order.lineItems.map((l: any) => l.ordered)).toEqual([7]);
});

test("items and purchase orders open from their lists by keyboard", async ({ page }) => {
  const state = seed();
  const vendor = await makeVendor();
  const po = await api("POST", "/api/vendor-purchase-orders", { vendorId: vendor.id, vendorName: vendor.name, orderDate: new Date().toISOString().slice(0, 10), lines: [{ itemNumber: state.itemNumbers[0], description: "x", orderedQty: 5, cost: 1 }] });
  await signInByKeyboard(page);

  await page.goto("/#/items");
  await expect(page.locator("tr.clickable-row").first()).toBeVisible();
  await tabTo(page, (text, tag) => tag === "a" && text === state.itemNumbers[0]);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/items\/[0-9a-f-]{36}$/);
  await expect(page.getByText(state.itemNumbers[0]).first()).toBeVisible();

  await page.goto("/#/purchase-orders");
  await expect(page.locator("tr.clickable-row").first()).toBeVisible();
  await tabTo(page, (text, tag) => tag === "a" && text === po.poNumber);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/purchase-orders/${po.poNumber}$`));
});

test("the Customize drawer takes focus, traps Tab, closes on Escape and gives focus back", async ({ page }) => {
  await signInByKeyboard(page);
  await page.goto("/#/reports/preset/customer-contact-list");
  const customize = page.getByRole("button", { name: "Customize" });
  await expect(customize).toBeEnabled();
  await customize.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Customize Report" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  // Focus moved inside, and stays inside through a full cycle of Tabs.
  const inside = () => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
  expect(await inside()).toBe(true);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(await inside()).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await inside()).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(customize).toBeFocused();
});

test("the More menu closes on Escape and gives focus back to its button", async ({ page }) => {
  await signInByKeyboard(page);
  const more = page.getByRole("button", { name: "More" });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  // Focus moved to the first item; arrows walk the items.
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(more).toBeFocused();
});

test("a vendor is picked by keyboard on a new purchase order", async ({ page }) => {
  const vendor = await makeVendor();
  await signInByKeyboard(page);
  await page.goto("/#/purchase-orders/new");
  const picker = page.locator("#po-vendor-search");
  await picker.focus();
  await page.keyboard.type(vendor.name);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await expect(page.getByRole("option", { name: new RegExp(vendor.name) })).toHaveAttribute("aria-selected", "true");
  // Escape closes without picking; the typed text stays.
  await page.keyboard.press("Escape");
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  await expect(picker).toHaveValue(vendor.name);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(picker).toHaveValue(vendor.name);
  await expect(picker).toBeFocused();
});
