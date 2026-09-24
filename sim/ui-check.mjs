// Browser check of the patched frontend against a running API + Vite:
//  1. a Warehouse-preset user ships an order from Open Picks (used to 403),
//  2. a Receiving user receives a vendor PO (used to 403),
//  3. a stale Allocation page refuses to re-allocate a shipped order,
//  4. every main page loads for each role without console/page errors.
//   SIM_API=http://localhost:4002 SIM_UI=http://localhost:5173 node sim/ui-check.mjs
import { chromium } from "playwright";
import { API, post, get, put, mapOrder, mapPo } from "./lib.mjs";

const UI = process.env.SIM_UI ?? "http://localhost:5173";
const results = [];
const note = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
};

async function login(page, username, password) {
  await page.goto(`${UI}/#/login`);
  await page.locator('input:not([type="password"])').first().fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.locator("button.login-submit").click();
  await page.waitForURL((u) => !u.hash.startsWith("#/login"), { timeout: 10_000 });
}

async function main() {
  const admin = { token: (await post(null, "/api/auth/login", { username: "admin", password: "123" })).token };
  admin.account = (await get(admin, "/api/auth/me")).account;

  // Stage an order at "Pick & Packed, documents printed" through the API.
  const items = await get(admin, "/api/items");
  const item = items.find((i) => i.qtyOnHand >= 50);
  const customers = await get(admin, "/api/customers?summary=1");
  const c = customers[0];
  let o = mapOrder(await post(admin, "/api/sales-orders", { poNumber: "UI-CHECK", orderDate: "2026-09-24", dueDate: "2026-09-30", customerId: c.id, billTo: c.billTo, shipTo: c.billTo, lineItems: [{ item: item.itemNumber, description: "ui", um: "EA", ordered: 7, rate: 1 }] }));
  const li = o.lineItems[0];
  o = mapOrder(await put(admin, `/api/sales-orders/${o.soNumber}`, { ...o, status: "Checked" }));
  o = mapOrder(await put(admin, `/api/sales-orders/${o.soNumber}`, { ...o, status: "Allocated", allocation: { lines: [{ lineItemId: li.id, allocatedQty: 7 }], fullyAllocated: true, decidedAt: new Date().toISOString() } }));
  const now = new Date().toISOString();
  o = mapOrder(await put(admin, `/api/sales-orders/${o.soNumber}`, { ...o, status: "Pick & Packed", pickPackStatus: "Complete", pickedAt: now, pendingShipment: [{ lineItemId: li.id, qty: 7 }], allocation: { ...o.allocation, lines: [{ lineItemId: li.id, allocatedQty: 0 }] }, pickListPrintedAt: now, packingSlipPrintedAt: now }));
  const before = (await get(admin, `/api/items/${item.id}`)).qtyOnHand;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const newPage = async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${page.url()} pageerror ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()} console ${m.text()}`));
    page.on("dialog", (d) => d.accept());
    return page;
  };

  // 1. Warehouse preset ships from Open Picks
  {
    const page = await newPage();
    await login(page, "wh.marcus", "Sim-pass-1");
    await page.goto(`${UI}/#/open-picks/${o.soNumber}`);
    await page.getByRole("button", { name: "Mark Shipped" }).click();
    await page.waitForURL((u) => u.hash === `#/storage/${o.soNumber}`, { timeout: 10_000 }).catch(() => {});
    const after = (await get(admin, `/api/items/${item.id}`)).qtyOnHand;
    const shipped = mapOrder(await get(admin, `/api/sales-orders/${o.soNumber}`));
    note("warehouse user can ship from Open Picks", shipped.status === "Shipped" && after === before - 7, `status=${shipped.status} qty ${before}->${after}`);
    await page.context().close();
  }

  // 2. Receiving user receives a PO
  {
    const pos = (await get(admin, "/api/vendor-purchase-orders")).map(mapPo);
    const po = pos.find((p) => p.status === "Open");
    const line = po.lines[0];
    const itemBefore = items.find((i) => i.itemNumber === line.itemNumber);
    const qtyBefore = (await get(admin, `/api/items/${itemBefore.id}`)).qtyOnHand;
    const page = await newPage();
    await login(page, "rcv.dan", "Sim-pass-1");
    await page.goto(`${UI}/#/purchase-orders/${po.poNumber}`);
    const input = page.locator("table input").first();
    await input.fill("5");
    await page.getByRole("button", { name: "Receive" }).click();
    await page.waitForTimeout(1500);
    const qtyAfter = (await get(admin, `/api/items/${itemBefore.id}`)).qtyOnHand;
    const poAfter = mapPo(await get(admin, `/api/vendor-purchase-orders/${po.poNumber}`));
    note("receiving user can receive a PO", qtyAfter === qtyBefore + 5 && poAfter.lines[0].receivedQty === 5, `qty ${qtyBefore}->${qtyAfter}, line received ${poAfter.lines[0].receivedQty}`);
    await page.context().close();
  }

  // 3. Stale allocation page refuses
  {
    const page = await newPage();
    await login(page, "val.derek", "Sim-pass-1");
    await page.goto(`${UI}/#/allocation/${o.soNumber}`);
    const notice = await page.locator(".stale-status-notice").textContent({ timeout: 10_000 }).catch(() => null);
    note("stale Allocation page refuses a shipped order", Boolean(notice), notice?.slice(0, 60) ?? "no notice");
    await page.context().close();
  }

  // 4. Page sweep per role
  const sweep = {
    admin: ["/", "/order-entry", "/validation", "/allocation", "/back-orders", "/pick-pack", "/open-picks", "/inventory", "/inventory/adjust", "/purchase-orders", "/receiving", "/customers/pricing", "/customers", "/items", "/import", "/returns", "/reports", "/analytics", "/settings", "/accounts", "/audit-log", "/schedule", "/bol", "/shipment-history"],
    "wh.marcus": ["/", "/pick-pack", "/open-picks", "/schedule", "/bol", "/back-orders", "/labels", "/warehouse-capacity"],
    "oe.maria": ["/", "/order-entry", "/open-orders", "/inventory"],
    "val.derek": ["/", "/validation", "/allocation", "/back-orders"],
    "rcv.dan": ["/", "/receiving", "/purchase-orders"],
  };
  for (const [user, paths] of Object.entries(sweep)) {
    const page = await newPage();
    await login(page, user, user === "admin" ? "123" : "Sim-pass-1");
    for (const p of paths) {
      const before = errors.length;
      await page.goto(`${UI}/#${p}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(400);
      note(`${user} loads ${p}`, errors.length === before, errors.slice(before).join(" | ").slice(0, 200));
    }
    await page.context().close();
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
