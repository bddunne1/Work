import { execSync } from "node:child_process";

// Brings the test database up to the current migrations once per run.
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://erp_app:erp@localhost:5432/erp_test?schema=public";
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
    cwd: new URL("..", import.meta.url).pathname,
  });
}
