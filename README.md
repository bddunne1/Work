# Aamstrand ERP

Purchase-order / fulfillment ERP built around the order workflow:
order entry → validation → allocation → pick & pack → open picks (ship) →
BOL / shipment history, plus vendor purchase orders and receiving, returns,
customers and pricing, inventory, reports and administration.

## Stack

- **Frontend**: React + TypeScript + Vite, HashRouter (`src/`). Each
  `src/lib/*Store.ts` module talks to the API through `src/lib/apiClient.ts`.
- **API**: Express + Prisma (`server/`), PostgreSQL. JWT sessions; per-page
  permissions (`src/lib/permissions.ts`) are enforced server-side via
  `requirePermission` / `requireAnyPermission` in `server/src/middleware/auth.ts`.
- Every order workflow step is a command endpoint with one permission and a
  narrow input (`check`, `allocate`, `unallocate`, `release`, `mark-printed`,
  `set-ship-date`, `set-bol`, `ship`, `undo-shipment`, `cancel` - see the
  header of `server/src/routes/salesOrders.ts`). Status, who entered/checked
  an order, the staged pick and shipment history are server-owned; the plain
  `PUT` edits header fields and lines only. Stock moves inside the same
  transaction as the document that caused them and every move is a
  `StockMovement` row. Allocation is checked against free stock server-side
  (`server/src/lib/inventory.ts`).
- Passwords are at least 10 characters; a seeded or admin-reset password must
  be replaced at the next sign-in. Sessions last `TOKEN_TTL` (default 10h) and
  the browser signs out after `VITE_IDLE_MINUTES` (default 45) of inactivity.
  Behind a reverse proxy set `TRUST_PROXY=1` and `CORS_ORIGIN=https://erp.example`.

## Setup

```bash
# 1. Database
createuser erp_app --pwprompt && createdb -O erp_app erp_dev
cp server/.env.example server/.env        # set DATABASE_URL and a long random JWT_SECRET

# 2. API
cd server
npm install
npx prisma migrate deploy
npm run seed                              # creates "admin" with a random password, printed once;
                                          # or ADMIN_PASSWORD=... npm run seed to choose it
npm run dev                               # http://localhost:4000

# 3. Frontend (in another shell, from the repo root)
npm install
VITE_API_URL=http://<api-host>:4000 npm run dev
```

`VITE_API_URL` defaults to `http://localhost:4000`, which only works on the
machine running the API - set it at build time for anyone else on the network.

## Test data

`server/scripts/generate-test-data.mjs` fills the database with a realistic
data set for trying the system out: 1,500 customers, 300 SKUs, 20 vendors and
20,000 sales orders covering the last ~6 months, ending today.

```bash
cd server
npm run seed:testdata              # refuses if the database already has customers, items or orders
npm run seed:testdata -- --reset   # deletes business data first; keeps accounts and settings
# options: --customers 1500 --skus 300 --orders 20000 --seed 42
```

Restart the API afterwards. It takes about a minute to run. What you get:

- **Orders**
  - Most orders are shipped, with a live pipeline at every stage today:
    entered, checked, allocated, back ordered, released (printed and not yet
    printed), a few partial shipments, and cancellations.
  - The top 10% of customers place about 80% of orders.
  - Order sizes follow the operation: 10% have 20+ lines with hundreds of
    units per line, 40% have 8-14 lines, and the rest are small.
- **Customers**
  - Customers have ship-to locations and notes.
  - Key accounts also have price overrides, customer part numbers and
    routing guides.
  - Order lines pick up those prices and part numbers.
- **Stock**
  - Vendor POs replenish stock every couple of weeks. Some recent POs are
    overdue or part received.
  - Returns are in every state (issued, received, closed).
  - The stock ledger adds up to every item's on-hand, and no item ever goes
    negative.
  - About 8% of items are deliberately short, so back orders are genuine.
- **Invoices and credit memos**
  - Every shipment has its invoice, priced from the order line with tax
    unless the customer is tax exempt.
  - Every received return has its credit memo.
  - None of them are queued for QuickBooks, so test history never reaches a
    connected company file.
- **Accounts**
  - Accounts are never touched.
  - Orders are stamped with your existing order entry, analyst and receiving
    accounts, or with admin if there are none.
- **Repeatability**
  - The same seed gives the same data set each time.
  - Dates are relative to the day you run it.

## Invoicing and QuickBooks

An invoice is raised for every confirmed shipment and a credit memo for every
received return (`server/src/lib/documents.ts`), at the prices on the order,
in integer cents. They are pushed to QuickBooks Online by the sync worker
(`server/src/integrations/sync.ts`): an outbox row is written in the same
transaction as the document, and the worker retries with backoff until it
lands, creating the customer and items (as non-inventory) in QuickBooks as
needed. QuickBooks stays the record for receivables, payments, tax filing and
the ledger; this system stays the record for stock. See Settings > QuickBooks
for status, retries and a reconciliation of a date range.

```bash
# server/.env
QBO_CLIENT_ID=...                     # from https://developer.intuit.com
QBO_CLIENT_SECRET=...
QBO_REDIRECT_URI=http://<api-host>:4000/api/integrations/quickbooks/callback
QBO_ENVIRONMENT=sandbox               # or production
QBO_INCOME_ACCOUNT="Sales"            # optional; default: first income account
TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)   # encrypts the OAuth tokens at rest
FRONTEND_URL=http://<web-host>:5173   # where the browser lands after connecting
QBO_SYNC_INTERVAL_MS=60000            # 0 disables the background worker
# QBO_FAKE=1                          # in-memory QuickBooks for local development
```

Then connect the company from Settings > QuickBooks. Turn inventory tracking
off for the items QuickBooks receives, and reconcile the first month's
invoices against QuickBooks before trusting the tax figure (a company with
Automated Sales Tax may recompute it).

## Development

```bash
npm run dev      # start the dev server
npm run build    # typecheck + production build
npm run lint     # oxlint
cd server && npx tsc --noEmit -p .   # typecheck the API
npm test         # server test suite against Postgres (TEST_DATABASE_URL, default erp_test)
```

The tests (`server/test/`) drive the real Express app against a throwaway
database: authentication and the password policy, every order command and
its permission, race conditions on ship / allocate / receive, invoicing and
the QuickBooks bridge against an in-memory fake, and a randomized concurrent
workload that then checks the stock ledger, the documents and every order
state agree. `.github/workflows/ci.yml` runs all of it on every push.

## Simulation

`sim/` holds a 15-user workday simulation, a one-year scale benchmark and a
browser check - see `docs/review/` for the latest results and how to run them.
