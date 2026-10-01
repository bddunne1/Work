import { writeFileSync } from "node:fs";
import { ADMIN_PASSWORD, API, STAFF_PASSWORD, WAREHOUSE_PASSWORD, api, apiToken } from "./helpers";

// Seeds what the specs need through the API: a few stocked items, a
// customer with a ship-to, and a staff account that must change its
// password on first sign-in. Idempotent, so a local rerun is fine.
export default async function globalSetup() {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(`${API}/api/health`)).ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const token = await apiToken("admin", ADMIN_PASSWORD);
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const itemNumbers = [`E2E-${stamp}-A`, `E2E-${stamp}-B`];
  for (const itemNumber of itemNumbers) {
    await api("POST", "/api/items", { itemNumber, description: `Smoke test rope ${itemNumber}`, um: "EA", rate: 2.5, qtyOnHand: 500, weight: 1.5, components: [], links: [] }, token);
  }
  const customerName = `Smoke Test Customer ${stamp}`;
  const address = { name: customerName, addressLine1: "1 Test Dock", addressLine2: "", city: "Manteno", state: "IL", zip: "60950", notes: "" };
  const customer = await api("POST", "/api/customers", { name: customerName, accountNumber: `E2E-${stamp}`, billTo: address, terms: "Net 30", shipToLocations: [{ label: "Dock", address }] }, token);
  const staffUsername = `smoke_${stamp.toLowerCase()}`;
  await api(
    "POST",
    "/api/accounts",
    {
      username: staffUsername,
      password: STAFF_PASSWORD,
      role: "CUSTOM",
      permissions: { "order-entry": "edit", "open-orders": "view", "order-detail": "view" },
      initials: "SM",
    },
    token
  );
  // The shared floor login for the dock screen (G-09). Its first-sign-in
  // password change is done here so the dock spec signs straight in.
  const warehouseUsername = `dock_${stamp.toLowerCase()}`;
  const temp = `${WAREHOUSE_PASSWORD}-temp`;
  await api("POST", "/api/accounts", { username: warehouseUsername, password: temp, role: "CUSTOM", permissions: { dock: "edit" }, initials: "FL" }, token);
  const floor = await apiToken(warehouseUsername, temp);
  await api("POST", "/api/auth/change-password", { currentPassword: temp, newPassword: WAREHOUSE_PASSWORD }, floor);
  writeFileSync(new URL("./.state.json", import.meta.url), JSON.stringify({ itemNumbers, customerId: customer.id, customerName, staffUsername, warehouseUsername }, null, 2));
}
