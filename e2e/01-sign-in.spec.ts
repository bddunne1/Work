import { expect, test } from "@playwright/test";
import { STAFF_PASSWORD, seed } from "./helpers";

// A new account signs in with its temporary password, is made to choose a
// new one, and lands on the Dashboard.
test("sign in and the forced password change", async ({ page }) => {
  const state = seed();
  await page.goto("/#/login");
  await page.getByLabel("Username").fill(state.staffUsername);
  await page.getByLabel("Password", { exact: true }).fill(STAFF_PASSWORD);
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page).toHaveURL(/#\/change-password/);
  const fresh = `${STAFF_PASSWORD}-changed`;
  await page.locator("#current-password").fill(STAFF_PASSWORD);
  await page.locator("#new-password").fill(fresh);
  await page.locator("#confirm-password").fill(fresh);
  await page.locator("form button[type=submit]").click();
  await expect(page).not.toHaveURL(/#\/change-password/);
  await expect(page.getByRole("heading", { name: new RegExp(`Hello ${state.staffUsername}`) })).toBeVisible();
  // The old password no longer works.
  await page.getByRole("button", { name: "Log Out" }).click();
  await page.getByLabel("Username").fill(state.staffUsername);
  await page.getByLabel("Password", { exact: true }).fill(STAFF_PASSWORD);
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page.locator(".login-error")).toBeVisible();
});
