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

## Invoicing and QuickBooks

A draft invoice is raised for every confirmed shipment and a draft credit
memo for every received return (`server/src/lib/documents.ts`), at the prices
on the order, in integer cents. Accounting works the review queue under
Invoices (drafts, oldest first): check the prices, add freight, handling or
other charges (each with its own taxable flag; a deduction on a credit
memo), write a note, then approve and issue. Issuing assigns the number
(INV-20001, CM-30001) and queues the push; a draft never reaches QuickBooks,
and undoing a shipment while its invoice is still a draft removes the draft
without burning a number. Issued documents can only be voided.

Issued documents are pushed to QuickBooks Online by the sync worker
(`server/src/integrations/sync.ts`): an outbox row is written in the same
transaction as the issue, and the worker retries with backoff until it
lands, creating the customer and items (as non-inventory; charge lines as
items named FREIGHT, HANDLING, OTHER) in QuickBooks as needed. QuickBooks stays the record for receivables, payments, tax filing and
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

## Stock reservations

What an open order is holding against stock lives in the `Allocation` table:
one row per order line that is allocated but not yet released, or released
(staged for a pick) but not yet shipped. The API rewrites an order's rows at
the end of every step that can change what it holds (allocate, unallocate,
release, trim at print, ship, undo, cancel), in the same transaction, and
keeps `Item.qtyReserved` as the sum. Available on every screen is
`qtyOnHand - qtyReserved`; the allocation screens subtract the order's own
hold first (`reservedElsewhere` in `src/types.ts`). An allocation that would
hold more than is free is refused with 409 under a row lock on the item.

A partial shipment sends the remainder back to Back Orders with nothing held
(the allocation is released), so the stock can go to whichever order needs
it first. The migration `20260929140000_reservation_table` backfills the
table from the `allocation` / `pendingShipment` JSON an upgraded database
carries, and `qtyOnPurchaseOrder` is recomputed by catalog link rather than
item number text, so renaming an item no longer leaves its total stale.

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
