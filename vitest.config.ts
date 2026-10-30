import { defineConfig } from "vitest/config";

// Client unit tests (src/**/*.test.ts). The server suite has its own vitest
// config under server/, and the browser suite is Playwright under e2e/.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
