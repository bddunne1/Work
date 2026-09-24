// Seeds master data for the simulation through the real API as the admin:
// 15 staff accounts (using the app's own permission presets where one fits),
// 12 vendors, 500 SKUs, 200 customers (Pareto: top 10% place ~80% of
// orders), a set of open vendor POs, and a pre-day backlog of orders
// entered yesterday so every role has work from the first minute.
import { writeFileSync } from "node:fs";
import { makeRng, post, get, patch, today } from "./lib.mjs";

const rng = makeRng(Number(process.env.SIM_SEED ?? 42));
const OUT = new URL("./seed-state.json", import.meta.url);

import { PERMS, STAFF } from "./presets.mjs";

const STATES = ["OH", "MI", "IN", "PA", "IL", "WI", "KY", "NY", "TX", "GA"];
const CITIES = ["Columbus", "Detroit", "Indianapolis", "Pittsburgh", "Chicago", "Milwaukee", "Louisville", "Buffalo", "Dallas", "Atlanta"];
const addr = (name) => {
  const i = rng.int(0, 9);
  return { name, addressLine1: `${rng.int(100, 9999)} ${rng.pick(["Industrial", "Commerce", "Market", "Main", "Park"])} ${rng.pick(["Pkwy", "Dr", "St", "Ave"])}`, addressLine2: "", city: CITIES[i], state: STATES[i], zip: String(rng.int(10000, 99999)), notes: "" };
};

async function main() {
  const admin = { username: "admin" };
  const login = await post(null, "/api/auth/login", { username: "admin", password: "123" });
  admin.token = login.token;

  // ---- accounts
  const existing = await get(admin, "/api/accounts");
  for (const [username, preset] of STAFF) {
    if (existing.some((a) => a.username === username)) continue;
    const body = preset === "ADMIN"
      ? { username, password: "Sim-pass-1", role: "ADMIN" }
      : { username, password: "Sim-pass-1", role: "CUSTOM", permissions: PERMS[preset] };
    body.color = `#${rng.int(0x202020, 0xdfdfdf).toString(16).padStart(6, "0")}`;
    await post(admin, "/api/accounts", body);
  }

  // ---- vendors
  const vendors = [];
  for (let i = 1; i <= 12; i++) {
    vendors.push(await post(admin, "/api/vendors", { name: `Vendor ${String(i).padStart(2, "0")} Supply Co`, contactName: `Rep ${i}`, phone: "555-0100", email: `rep${i}@vendor${i}.example`, address: addr(`Vendor ${i}`) }));
  }

  // ---- items: Zipf-ish popularity; stock sized to expected demand so the
  // day produces a realistic mix of full allocations and backorders.
  const items = [];
  const popularity = [];
  for (let i = 0; i < 500; i++) popularity.push(1 / Math.pow(i + 1, 0.9));
  const popSum = popularity.reduce((a, b) => a + b, 0);
  const DAILY_UNITS = 270_000; // see README: ~150 orders/day with the stated line-count mix
  for (let i = 0; i < 500; i++) {
    const share = popularity[i] / popSum;
    const expected = share * DAILY_UNITS;
    const onHand = rng.chance(0.04) ? 0 : Math.round(expected * (0.6 + rng.next() * 2.2));
    const itemNumber = `${rng.pick(["BR", "FS", "HX", "CL", "PN", "GS", "TB"])}-${String(1000 + i)}`;
    const item = await post(admin, "/api/items", {
      itemNumber,
      description: `${rng.pick(["Steel", "Zinc", "Brass", "Nylon", "Aluminum"])} ${rng.pick(["bracket", "fastener", "hinge", "clamp", "spacer", "gasket", "tube"])} ${rng.int(1, 12)}"`,
      um: "EA",
      rate: Math.round((0.15 + rng.next() * 40) * 100) / 100,
      qtyOnHand: onHand,
      reorderPoint: Math.round(expected * 0.5),
      weight: Math.round((0.05 + rng.next() * 4) * 100) / 100,
      preferredVendorId: rng.pick(vendors).id,
      components: [],
      links: [],
    });
    items.push({ itemNumber: item.itemNumber, id: item.id, share, rate: Number(item.rate), startQty: onHand });
  }

  // ---- customers: top 20 are the heavy accounts
  const customers = [];
  for (let i = 0; i < 200; i++) {
    const top = i < 20;
    const name = `${top ? "Key Acct" : "Customer"} ${String(i + 1).padStart(3, "0")} ${rng.pick(["Manufacturing", "Distribution", "Industries", "Fabrication", "Supply"])}`;
    const overrideItems = top ? rng.sample(items, rng.int(120, 300)) : rng.chance(0.3) ? rng.sample(items, rng.int(5, 40)) : [];
    const c = await post(admin, "/api/customers", {
      name,
      accountNumber: `C${10000 + i}`,
      billTo: addr(name),
      terms: rng.pick(["Net 30", "Net 45", "Net 60", "2% 10 Net 30"]),
      shipVia: rng.pick(["UPS Ground", "FedEx Freight", "Customer Pickup", "R+L Carriers", "Estes"]),
      fob: "Origin",
      rep: rng.pick(["JB", "KL", "MS"]),
      shipCompleteOnly: rng.chance(0.2),
      routingGuide: top ? { preferredCarrier: "FedEx Freight", routingAccountNumber: `RA${i}`, appointmentRequired: rng.chance(0.5), labelingRequirements: "GS1-128 on each carton", notes: "" } : null,
      shipToLocations: Array.from({ length: top ? rng.int(3, 8) : rng.int(1, 2) }, (_, k) => ({ label: `DC ${k + 1}`, address: addr(`${name} DC ${k + 1}`) })),
      notes: [],
      partNumberMap: overrideItems.map((it) => ({ itemNumber: it.itemNumber, customerPartNumber: `CP-${i}-${it.itemNumber}` })),
      priceOverrides: overrideItems.map((it) => ({ itemNumber: it.itemNumber, customerPartNumber: `CP-${i}-${it.itemNumber}`, description: "", price: Math.round(it.rate * (0.8 + rng.next() * 0.15) * 100) / 100 })),
    });
    customers.push({ id: c.id, name: c.name, top, shipCompleteOnly: c.shipCompleteOnly, overrides: overrideItems.length });
  }

  // ---- open vendor POs (so receiving has work and backorder forecasts have ETAs)
  const pos = [];
  for (let i = 0; i < 40; i++) {
    const v = rng.pick(vendors);
    const lines = rng.sample(items.slice(0, 250), rng.int(3, 18)).map((it) => ({ itemNumber: it.itemNumber, description: "restock", orderedQty: rng.int(200, 3000), receivedQty: 0, cost: Math.round(it.rate * 0.55 * 100) / 100 }));
    const expected = new Date(Date.now() + rng.int(-3, 20) * 86400000).toISOString().slice(0, 10);
    const po = await post(admin, "/api/vendor-purchase-orders", { vendorId: v.id, vendorName: v.name, orderDate: today(), expectedDate: expected, notes: "", lines });
    pos.push(po.poNumber);
  }
  // The frontend recomputes qtyOnPurchaseOrder client-side after saving a
  // PO (vendorPoStore.recomputeQtyOnPurchaseOrder); the seed does the same
  // in one pass so the catalog starts consistent.
  const allPos = await get(admin, "/api/vendor-purchase-orders");
  const onPo = new Map();
  for (const po of allPos) for (const l of po.lines) onPo.set(l.itemNumber, (onPo.get(l.itemNumber) ?? 0) + l.orderedQty - l.receivedQty);
  for (const [itemNumber, qty] of onPo) await call_patch(admin, itemNumber, qty);

  writeFileSync(OUT, JSON.stringify({ items, customers, vendors: vendors.map((v) => ({ id: v.id, name: v.name })), staff: STAFF }, null, 1));
  console.log(`seeded: ${STAFF.length} staff, ${vendors.length} vendors, ${items.length} items, ${customers.length} customers, ${pos.length} vendor POs`);
}

async function call_patch(admin, itemNumber, qty) {
  await patch(admin, `/api/items/by-number/${encodeURIComponent(itemNumber)}/qty`, { qtyOnPurchaseOrder: qty });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
