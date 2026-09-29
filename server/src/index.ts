import "dotenv/config";
import { createApp } from "./app.js";
import { secretsEncrypted } from "./integrations/secrets.js";
import { startSyncScheduler } from "./integrations/sync.js";
import { prisma } from "./prisma.js";

// A misconfigured secret used to surface as a 500 on the first request that
// touched it; check everything once here and refuse to start instead.
function checkEnvironment(): void {
  const problems: string[] = [];
  const warnings: string[] = [];
  if ((process.env.JWT_SECRET ?? "").length < 16) warnings.push("JWT_SECRET is shorter than 16 characters - use a long random value in production.");
  try {
    secretsEncrypted();
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
  }
  const ttl = process.env.TOKEN_TTL;
  if (ttl && !/^\d+(ms|s|m|h|d)?$/.test(ttl)) problems.push(`TOKEN_TTL "${ttl}" is not a duration (use e.g. 10h or 36000).`);
  for (const key of ["QBO_SYNC_INTERVAL_MS", "PORT"]) {
    const v = process.env[key];
    if (v && !/^\d+$/.test(v)) problems.push(`${key} "${v}" is not a whole number.`);
  }
  const qbo = ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI"].filter((k) => process.env[k]);
  if (qbo.length > 0 && qbo.length < 3) problems.push(`QuickBooks needs all of QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_REDIRECT_URI (have ${qbo.join(", ")}).`);
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (problems.length > 0) {
    console.error("Refusing to start - fix the environment first:\n - " + problems.join("\n - "));
    process.exit(1);
  }
}
checkEnvironment();

const app = createApp();
const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
// Pushes invoices and credit memos to QuickBooks in the background.
const stopSync = startSyncScheduler();

// Finish in-flight requests and release the database pool on a stop signal,
// so a deploy never cuts a ship/receive transaction off mid-way.
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received - shutting down`);
  stopSync?.();
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
