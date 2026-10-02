# Splice

Splice is the order management system built for Aamstrand Ropes & Twines.

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

## Who sees what, and the activity log

Orders can be read by any login with an order page (Order Entry through
Shipment History, Inventory, Reports, Analytics, Invoices). Prices are shown
only to the office: Order Entry, Sales Order View, Customer Pricing and
Invoices. Any other login gets each order without its rates and tax rate and
with `pricesHidden: true`, lists show a dash for the total, and a save from
such a login leaves the prices as they were. Shipment History withholds
invoice amounts the same way. The Dashboard reads its counts from
`GET /api/dashboard/summary`, so a receiving-only login still sees the day
without reading the order list.

The customer price sheet is saved through `PUT /api/customers/:id/prices`
(Customer Pricing page) and the routing guide through
`PUT /api/customers/:id/routing-guide` (Routing Guide page); the customer PUT
ignores both. Every price that changes, appears or is removed is its own
activity-log entry with the item, the old and the new price. Customer and
item edits are logged field by field, and steps that run in a transaction
(shipping, receiving, stock adjustments, these edits) write their log entry
inside it, so a step that rolls back leaves no entry. Settings accept only
the keys the app knows (`lead_time_days`, `capacity_lookback_days`,
`company_info`), each with its own validation.

## Corrections after checking, and cancelled picks

A change to a Checked order's items, quantities, prices or customer sends it
back to Entered and takes the checker's stamp off, so it is validated again;
header corrections (P.O. number, notes, addresses) keep the stamp. On Sales
Order View the lines of a Checked order are read-only until Re-open lines is
pressed, a refused save keeps the typed values on screen, and analysts can
revise a Backordered or Allocated order's allocation from the same page.

Cancelling an order whose pick list or packing slip has printed leaves its
staged lines listed under Pull from floor on Open Picks (and a count on the
Dashboard) until Logistics marks it pulled; nothing is held in the meantime.
`GET /api/sales-orders?pulls=1` lists them and `POST
/api/sales-orders/:soNumber/acknowledge-pull` clears one.

## Screens: errors, messages and small fixes

A page that fails to render shows a Reload / Try again panel inside the app
shell instead of a blank window; messages that used to be browser alerts are
toasts at the bottom right; the queue pages say when their list did not
load. The BOL compares ship-to addresses ignoring case and spacing and, for
several destinations, prints each order's ship-to in its row. Reports offer
only the data sources the account can read, show the server's refusal, and
ignore a slow answer that arrives after a later run. The import preview
flags order lines whose item is not in the catalog, shows the server's field
errors, and no longer takes an On Purchase Order column (that figure comes
from open vendor POs). Sidebar links appear only where the account has
access; the returns queue counts as Receiving's work. Warehouse capacity
groups shipments by local calendar day, and item responses carry the
preferred vendor's name. The stage between release and shipment reads as
Released on screen (its stored status name is unchanged); a new order line
scrolls into view; the Release Orders tile shows "to release · to print".

## A human at every step

An order is never checked or allocated by the system. The person who
entered an order cannot be the one who checks it (Admin excepted); the
Validation queue marks those "yours" and Review Queue steps past them.
Opening an order on a decision page claims it for ten minutes
(`POST /api/sales-orders/:soNumber/claim`): the queues show who has it and
step past it, the decision or leaving the page ends the claim, and an old
claim runs out on its own.

When a PO receipt lands stock that a back order waits on, the order is
flagged (`stockArrivedAt`) and nothing is allocated. The Back Order Queue
(`GET /api/sales-orders/back-orders`) groups orders as stock arrived (to
review, with what is free per line), covered by an open PO (with the
projected arrival), or not covered; the Dashboard counts the first group.
The next allocation decision, allocate or hold again, clears the flag.

### The pack check and Ready to ship

A released pick has three stops on the floor. Release prints the pick list
("Release and print" does both in one step, or print later from Open
Picks). When the goods are picked and packed, the **pack check**
(`POST /api/sales-orders/:soNumber/ready`) records what was actually
packed per line, shorts included, marks the order Ready to ship
(`readyAt`, `readyBy`) and prints the packing slip from those quantities.
Mark Shipped (`/ship`) then requires the order to be ready and ships
exactly the packed quantities; a short leaves the balance on back order.
"Back to the floor" (`/unready`) reopens the pack check.

The warehouse works from the **Dock** page (`/dock`, page key `dock`,
preset Warehouse): being picked, Ready to ship, shipped today and picks to
pull, with no prices anywhere. The shared floor login types the packer's
initials at the pack check. Logistics can do the same pack check from Open
Picks under its own name. The Dashboard splits the floor into "to pack"
and "on the dock", and the Ready to ship pill marks orders waiting for the
carrier.

### Carrier details and the BOL

Carrier, SCAC, PRO number and pickup date live on the order and on each
shipment record. Generate BOL saves them with the BOL (`set-bol` takes a
`carrier` object) and Mark Shipped saves or corrects them at pickup
(`ship` takes the same object; the pickup date defaults to the ship
date). They show on the Sales Order View, in Shipment History (and its
CSV) and on the pack check, and a PRO number is searchable from Open
Orders and Shipment History.

Generate BOL prefills each order from what it carries: the staged (or
ordered) quantities times the item weights, turned into package and
handling-unit counts by the BOL defaults in Settings (units per package,
packages per handling unit, the unit names, freight class and NMFC). The
carrier comes from an earlier BOL or shipment, else the customer's routing
guide, else the order's Ship Via. The shipping label fills itself the same
way when an S.O. # is typed.

### Receiving, cost and margin

On a purchase order, "Receive all outstanding" fills every line with what
is still owed so only the exceptions need typing before Receive. Each
receipt sets the item's last purchase cost (`Item.cost`), which the
catalog editor can also set by hand; a new PO line starts from it.

Cost is shown only to accounts that may see it: Purchasing (view on
Purchase Orders or Receiving), catalog editors, the Sales Manager (edit on
Analytics), Director and Admin. The server leaves `cost` off the item for
everyone else, and the pages follow. Where cost is visible: the Item
Profile shows cost and margin per unit, the Item Quick Report adds cost,
on-hand value at cost and margin per line, the Sales Order Lines and
Inventory reports gain cost and margin columns, and Analytics shows
on-hand value at cost and the gross margin on issued invoices (lines
whose item has no cost yet are counted in revenue and reported as
uncosted).

### Order Entry as a keyboard grid

The line grid on Order Entry is worked without the mouse: Enter in the
Item cell resolves it (our item number or the customer's own part number)
and jumps to Ordered, Enter again goes to Rate, and Enter on a complete
line adds the next one. Pasting "item, qty" lines from a customer's PO or
a spreadsheet into an Item cell fills a row per line. Each line shows what
is available now (on hand less what other open orders hold, red when the
order exceeds it) and whether the price came from the customer's sheet or
the catalog. The due date starts from the order date plus the lead time
until it is typed over. A P.O. number already entered for the customer
shows a warning (not a block) beside the field and in the side panel,
which also carries the customer's terms and flags, routing guide and
latest notes.

## Development

```bash
npm run dev      # start the dev server
npm run build    # typecheck + production build
npm run lint     # oxlint
cd server && npx tsc --noEmit -p .   # typecheck the API
npm test         # server test suite against Postgres (TEST_DATABASE_URL, default erp_test)
```

In production the API serves gzip-compressed JSON (`compression`); serve the
built client from `dist/` with any static server (nginx, Caddy, `npx serve
dist`) and point it at the API, or put both behind one host with `/api`
proxied to the API port. The client's heavy pages (Analytics, Reports, BOL,
Labels, Import) load on first visit rather than in the main bundle.

The tests (`server/test/`) drive the real Express app against a throwaway
database: authentication and the password policy, every order command and
its permission, race conditions on ship / allocate / receive, invoicing and
the QuickBooks bridge against an in-memory fake, and a randomized concurrent
workload that then checks the stock ledger, the documents and every order
state agree. `.github/workflows/ci.yml` runs all of it on every push.

## Simulation

`sim/` holds a 15-user workday simulation, a one-year scale benchmark and a
browser check - see `docs/review/` for the latest results and how to run them.
