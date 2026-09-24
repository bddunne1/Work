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
