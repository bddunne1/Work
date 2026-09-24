// Measures page-load cost with a year of history in the database: 15 users
// opening the same page at once (start of shift / after lunch), for the
// request set each page makes. Run once against the original server and
// once against the fixed one.
//   SIM_API=http://localhost:4001 SIM_MODE=baseline node sim/scale-bench.mjs
//   SIM_API=http://localhost:4000 SIM_MODE=fixed    node sim/scale-bench.mjs
import { writeFileSync } from "node:fs";
import { API, post, get, metrics } from "./lib.mjs";
import { STAFF } from "./presets.mjs";

const MODE = process.env.SIM_MODE ?? "fixed";
const OUT = process.env.SIM_OUT ?? new URL(`./scale-${MODE}.json`, import.meta.url).pathname;
const ROUNDS = 3;

// Request set per page, as each version of the frontend issues it.
const PAGES = {
  baseline: {
    Dashboard: ["/api/customers", "/api/items", "/api/sales-orders"],
    "Allocation decision": ["/api/items", "/api/sales-orders", "/api/sales-orders/{so}"],
    "Pick & Pack list": ["/api/sales-orders", "/api/items", "/api/sales-orders"],
    "Order Entry": ["/api/customers", "/api/items", "/api/counters/salesOrder"],
    "Closed Orders": ["/api/sales-orders"],
    "Shipment History": ["/api/sales-orders"],
    Analytics: ["/api/customers", "/api/items", "/api/sales-orders"],
  },
  fixed: {
    Dashboard: ["/api/customers?summary=1", "/api/items", "/api/sales-orders?open=1", "/api/sales-orders?limit=5"],
    "Allocation decision": ["/api/items", "/api/sales-orders?open=1", "/api/sales-orders/{so}"],
    // WarehouseCapacityBanner: open orders + the lookback window's shipments (default 30 days).
    "Pick & Pack list": ["/api/sales-orders?open=1", "/api/items", `/api/sales-orders?open=1&shippedSince=${new Date(Date.now() - 30 * 86400000).toISOString()}`],
    // Round 2: slim customer list; the chosen customer's price sheet loads on selection.
    "Order Entry": ["/api/customers?summary=1", "/api/items", "/api/counters/salesOrder", "/api/customers/{cust}"],
    "Closed Orders": ["/api/sales-orders/search?status=Shipped,Cancelled&page=1&pageSize=50"],
    "Shipment History": ["/api/sales-orders/search?status=Shipped&sort=shippedAt&dir=desc&page=1&pageSize=50"],
    Analytics: ["/api/customers?summary=1", "/api/analytics/summary"],
  },
}[MODE];

async function probeWhile(promise) {
  // /api/health does no DB work - its latency during the load is how long
  // Node's single event loop was blocked serializing other people's JSON.
  const samples = [];
  let done = false;
  promise.finally(() => (done = true));
  while (!done) {
    const t0 = performance.now();
    await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(120_000) }).then((r) => r.text()).catch(() => {});
    samples.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 25));
  }
  return Math.max(0, ...samples);
}

async function main() {
  // 15 sessions (signed in as admin so every page's requests are allowed in
  // both versions - this measures load cost, not permissions).
  const users = [];
  for (const [username] of STAFF.slice(0, 15)) {
    const u = { username, roleLabel: "bench" };
    u.token = (await post(null, "/api/auth/login", { username: "admin", password: "123" })).token;
    users.push(u);
  }
  const anyOpen = (await get(users[0], "/api/sales-orders?limit=1"))[0]?.soNumber ?? "10001";
  const anyCustomer = (await get(users[0], "/api/customers?summary=1"))[0]?.id ?? "";

  const single = {};
  {
    const t0 = performance.now();
    const res = await fetch(`${API}/api/sales-orders`, { headers: { Authorization: `Bearer ${users[0].token}` } });
    const text = await res.text();
    single.allOrders = { ms: Math.round(performance.now() - t0), mb: +(text.length / 1048576).toFixed(1), count: JSON.parse(text).length };
  }

  const pages = {};
  for (const [page, paths] of Object.entries(PAGES)) {
    const runs = [];
    for (let r = 0; r < ROUNDS; r++) {
      metrics.calls.length = 0;
      const t0 = performance.now();
      let failed = 0;
      const load = Promise.all(users.map((u) => Promise.all(paths.map((p) => get(u, p.replace("{so}", anyOpen).replace("{cust}", anyCustomer)).catch(() => failed++)))));
      const [, healthMax] = await Promise.all([load, probeWhile(load)]);
      const wall = performance.now() - t0;
      runs.push({ wallMs: Math.round(wall), healthMaxMs: Math.round(healthMax), mbTransferred: +(metrics.calls.reduce((s, c) => s + c.bytes, 0) / 1048576).toFixed(1), slowestCallMs: Math.round(Math.max(...metrics.calls.map((c) => c.ms))), failedCalls: failed });
    }
    runs.sort((a, b) => a.wallMs - b.wallMs);
    pages[page] = { ...runs[1], rounds: runs.map((r) => r.wallMs) };
    console.log(MODE, page, JSON.stringify(pages[page]));
  }
  writeFileSync(OUT, JSON.stringify({ mode: MODE, api: API, single, pages }, null, 1));
  console.log(JSON.stringify(single));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
