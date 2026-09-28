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
