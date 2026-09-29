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
- Stock movements that must be atomic run as single server transactions:
  `POST /api/sales-orders/:so/ship`, `POST /api/sales-orders/:so/undo-shipment`,
  `POST /api/vendor-purchase-orders/:po/receive`. Allocation is checked
  against free stock server-side (`server/src/lib/inventory.ts`).

## Setup

```bash
# 1. Database
createuser erp_app --pwprompt && createdb -O erp_app erp_dev
cp server/.env.example server/.env        # set DATABASE_URL and a long random JWT_SECRET

# 2. API
cd server
npm install
npx prisma migrate deploy
npm run seed                              # creates admin / 123 - change it immediately
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
- **Accounts**
  - Accounts are never touched.
  - Orders are stamped with your existing order entry, analyst and receiving
    accounts, or with admin if there are none.
- **Repeatability**
  - The same seed gives the same data set each time.
  - Dates are relative to the day you run it.

## Development

```bash
npm run dev      # start the dev server
npm run build    # typecheck + production build
npm run lint     # oxlint
cd server && npx tsc --noEmit -p .   # typecheck the API
```

## Simulation

`sim/` holds a 15-user workday simulation, a one-year scale benchmark and a
browser check - see `docs/review/` for the latest results and how to run them.
