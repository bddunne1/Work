// Staff roster for the simulation, and each role's permissions read straight
// from the app's own presets (src/lib/permissions.ts) so the sim always
// tests exactly what an admin would hand out.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const presets = JSON.parse(
  execFileSync(
    `${root}server/node_modules/.bin/tsx`,
    ["-e", 'import { PERMISSION_PRESETS } from "./src/lib/permissions.ts"; console.log(JSON.stringify(PERMISSION_PRESETS));'],
    { cwd: root, encoding: "utf8" }
  )
);
export const PERMS = Object.fromEntries(presets.map((p) => [p.key, p.permissions]));

// [username, preset key (or ADMIN), role label]
export const STAFF = [
  ["pur.dan", "purchasing", "Purchasing"],
  ["pur.ali", "purchasing", "Purchasing"],
  ["cs.linda", "customer-service", "Customer Service"],
  ["cs.maria", "customer-service", "Customer Service"],
  ["cs.james", "customer-service", "Customer Service"],
  ["cs.priya", "customer-service", "Customer Service"],
  ["oe.tom", "order-entry", "Order Entry"],
  ["oe.rosa", "order-entry", "Order Entry"],
  ["an.derek", "analyst", "Analyst"],
  ["an.sofia", "analyst", "Analyst"],
  ["log.marcus", "logistics", "Logistics"],
  ["dir.sam", "ADMIN", "Director"],
  ["sm.helen", "sales-manager", "Sales Manager"],
  ["sm.kenji", "sales-manager", "Sales Manager"],
  ["sm.grace", "sales-manager", "Sales Manager"],
];
