// Bulk-loads N months of shipped order history (default 12 months at ~150
// orders/business day ≈ 37,500 orders) straight into Postgres with COPY, so
// the scale test can measure how the app behaves after a year in service.
// Uses the same order-size mix and customer skew as day.mjs.
//   node sim/scale-seed.mjs [months]   (needs psql on PATH, PG* env or defaults)
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { makeRng } from "./lib.mjs";

const months = Number(process.argv[2] ?? 12);
const perDay = 150;
const businessDays = Math.round(months * 21);
const rng = makeRng(99);
const seed = JSON.parse(readFileSync(new URL("./seed-state.json", import.meta.url), "utf8"));
const top = seed.customers.filter((c) => c.top);
const rest = seed.customers.filter((c) => !c.top);
let acc = 0;
const cdf = seed.items.map((i) => (acc += i.share));
const pickItem = () => {
  const r = rng.next() * acc;
  return seed.items[cdf.findIndex((c) => c >= r)];
};

const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const orders = [];
const lines = [];
const ships = [];
let so = 1000; // history numbers sit below the live counter (10001+)
const start = Date.now() - (months * 30 + 1) * 86400000;
for (let d = 0; d < businessDays; d++) {
  const day = new Date(start + d * (months * 30 / businessDays) * 86400000);
  const date = day.toISOString().slice(0, 10);
  for (let k = 0; k < perDay; k++) {
    so++;
    const c = rng.chance(0.8) ? rng.pick(top) : rng.pick(rest);
    const r = rng.next();
    const [n, q] = r < 0.1 ? [rng.int(20, 40), () => rng.int(100, 900)] : r < 0.5 ? [rng.int(8, 14), () => rng.int(10, 150)] : rng.chance(0.35) ? [rng.int(1, 2), () => rng.int(3, 4)] : [rng.int(3, 7), () => rng.int(5, 60)];
    const chosen = new Map();
    while (chosen.size < n) { const it = pickItem(); chosen.set(it.itemNumber, it); }
    const addr = JSON.stringify({ name: c.name, addressLine1: "100 Main St", addressLine2: "", city: "Columbus", state: "OH", zip: "43004", notes: "" });
    const shipLines = [];
    for (const it of chosen.values()) {
      const id = randomUUID();
      const qty = q();
      lines.push([id, so, it.itemNumber, "hist", "EA", qty, it.rate].map(esc).join(","));
      shipLines.push({ lineItemId: id, qty });
    }
    const alloc = JSON.stringify({ lines: shipLines.map((l) => ({ lineItemId: l.lineItemId, allocatedQty: 0 })), fullyAllocated: true, decidedAt: `${date}T15:00:00Z` });
    orders.push([so, `HPO-${so}`, date, date, c.id, addr, addr, "SHIPPED", alloc, "[]", `${date}T14:00:00Z`, `${date}T15:00:00Z`, `${date}T15:00:00Z`, `${date}T15:00:00Z`, "COMPLETE", "JB", `${date}T13:00:00Z`].map(esc).join(","));
    ships.push([randomUUID(), so, `${date}T20:00:00Z`, JSON.stringify(shipLines)].map(esc).join(","));
  }
}
const dir = mkdtempSync(join(tmpdir(), "erp-scale-"));
writeFileSync(join(dir, "orders.csv"), orders.join("\n"));
writeFileSync(join(dir, "lines.csv"), lines.join("\n"));
writeFileSync(join(dir, "ships.csv"), ships.join("\n"));
const sql = `
\\copy "SalesOrder" ("soNumber","poNumber","orderDate","dueDate","customerId","billTo","shipTo","status","allocation","pendingShipment","checkedAt","pickedAt","pickListPrintedAt","packingSlipPrintedAt","pickPackStatus","rep","createdAt") FROM '${dir}/orders.csv' CSV
\\copy "SalesOrderLine" ("id","soNumber","item","description","um","ordered","rate") FROM '${dir}/lines.csv' CSV
\\copy "ShipmentRecord" ("id","soNumber","shippedAt","lines") FROM '${dir}/ships.csv' CSV
ANALYZE "SalesOrder";
ANALYZE "SalesOrderLine";
ANALYZE "ShipmentRecord";
`;
writeFileSync(join(dir, "load.sql"), sql);
execFileSync("psql", ["-h", process.env.PGHOST ?? "localhost", "-U", process.env.PGUSER ?? "erp_app", "-d", process.env.PGDATABASE ?? "erp_dev", "-v", "ON_ERROR_STOP=1", "-q", "-f", join(dir, "load.sql")], { stdio: "inherit", env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "erp_dev_pw" } });
console.log(`loaded ${orders.length} historical orders, ${lines.length} lines, ${ships.length} shipments (${months} months)`);
