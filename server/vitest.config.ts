import { defineConfig } from "vitest/config";

// The suite runs against a real Postgres database (TEST_DATABASE_URL, default
// erp_test on localhost) because what it tests is transactions, row locks and
// the advisory lock - none of which a mocked client would exercise. Every
// test file truncates the schema first, so files run one at a time.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    setupFiles: ["test/setupEnv.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "test-results/junit.xml" },
  },
});
