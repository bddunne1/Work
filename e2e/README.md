# Browser smoke tests

Six Playwright specs walk the core flows against the dev servers on their
own ports (API 4100, client 5174) and a seeded database:

1. sign in and the forced password change
2. enter an order
3. validate, allocate and release it
4. pack check, ship it and issue the invoice
5. issue and receive a return, then issue the credit memo
6. the dock's pack check with a short and initials, then ship what was packed

```bash
# once: a database with the migrations and an admin account
createdb erp_e2e   # or CREATE DATABASE erp_e2e as erp_app
cd server && DATABASE_URL=postgresql://erp_app:erp@localhost:5432/erp_e2e?schema=public npx prisma migrate deploy
ADMIN_PASSWORD=E2E-Director-2026 DATABASE_URL=... npm run seed
cd .. && npm run test:e2e
```

`playwright.config.ts` starts the API and Vite itself (or reuses ones already
listening on those ports), and `e2e/global-setup.ts` seeds the items,
customer, staff account and shared floor login the specs use through the API. CI runs the suite
after the server tests (`.github/workflows/ci.yml`).
