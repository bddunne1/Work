// Runs in the worker before each test file is imported, so the Prisma client
// and the auth middleware pick these up when their modules load.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://erp_app:erp@localhost:5432/erp_test?schema=public";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-only-secret-0123456789abcdef";
process.env.TOKEN_TTL = "1h";
process.env.NODE_ENV = "test";
