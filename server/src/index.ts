import "dotenv/config";
import { createApp } from "./app.js";
import { prisma } from "./prisma.js";

const app = createApp();
const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

// Finish in-flight requests and release the database pool on a stop signal,
// so a deploy never cuts a ship/receive transaction off mid-way.
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received - shutting down`);
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
