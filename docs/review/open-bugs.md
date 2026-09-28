# Open bugs

Running log of known defects that are still open. It starts from the
24 Sep 2026 review (`erp-review.html`, finding IDs like H-07) and adds
anything found since (IDs N-xx). When one is fixed, move it to "Recently
closed" with the commit, and update the shared to-do list.

Severity is rated for an internal network with about 15 users.

## Open

| ID | Severity | Area | Problem | Where | Suggested fix |
|---|---|---|---|---|---|
| H-10 | High | Reports | The "Open Sales Orders", "Open POs" and "Open Returns" presets have no status filter, so they include shipped or closed records. | `src/lib/reports/presets.ts` | Add an exclude / multi-select status filter; give each preset its default. |
| M-10 | Medium | Vendors | The Vendors page saves on every keystroke, which causes false "changed by someone else" alerts and lost typing. | `src/pages/Vendors.tsx:36-50` | Keep edits in a draft; save on blur or with a Save button. |
| M-11 | Medium | Customers / Settings | Adding a customer note also saves any half-finished address or terms edits. Clearing the lead-time field saves 0. | `Customers.tsx:77-115`, `Settings.tsx:42-52` | Apply the note to the last saved record; validate Settings before saving on blur. |
| M-12b | Medium | Pick & pack | A line released at 0 keeps its allocation, so after the partial ships the order holds that stock until someone re-allocates. | `PickPackDetail.tsx` release | Release unpicked lines' allocation on ship, or prompt for it. |
| M-13 | Medium | Planning | The backorder forecast counts all incoming PO stock toward every order. The capacity banner calls average load "capacity". | `backorderForecast.ts`, `warehouseCapacity.ts` | Allocate incoming supply in queue order; use a configured maximum capacity. |
| M-15 | Medium | Pricing | An order line is $0.00 when the customer has no override price. PO cost defaults to the sell price. (The credit memo now prices from the invoice; the RA form itself still shows the catalog price.) | `LineItemsTable.tsx:62`, `PurchaseOrderForm.tsx:49`, `ReturnForm.tsx:50` | Fall back to the catalog rate; add item cost. |
| L-02 | Low | Analytics | "Revenue" is bookings: it includes tax and unshipped orders, and returns aren't subtracted. Inventory value uses the sell price. | analytics summary | Rename, or compute from shipments and cost. |
| L-03 | Low | Deployment | Traffic is plain HTTP, CORS allows `*`, and the frontend defaults to `localhost:4000`. | `apiClient.ts:4`, `server/src/index.ts` | Serve from one origin behind TLS and restrict CORS. |
| L-04 | Low | Money | Money math on the sales order screens is floating point, so a printed order's line amounts can differ from its subtotal by cents. (Invoices and credit memos are computed in integer cents on the server.) | `types.ts lineAmount / orderSubtotal` | Calculate in integer cents and round each line. |
| L-06 | Low | Maintainability | Page labels are defined on both client and server (`permissions.ts`, `server/src/lib/pages.ts`), and `GenerateBOL.tsx` is 975 lines. | `permissions.ts`, `pages.ts`, `GenerateBOL.tsx` | Move PAGE_DEFS into a shared package; split the BOL form from its print view. |
| N-01 | Low | Import | The inventory import's "On Purchase Order" column does nothing (on-PO is now computed from open POs). | `importParsers.ts`, Import templates | Drop the column from the template, or warn when it's filled. |
| N-02 | Low | Errors | Server validation errors (400) show as a generic "rejected as invalid" because the zod details aren't passed through. | `src/lib/apiClient.ts` | Turn `error.fieldErrors` into a readable message. |
| N-05 | Medium | Performance | The warehouse capacity banner on Pick & Pack downloads every order shipped in the last 30 days (about 13 MB per person at 150 orders/day). With 15 people opening Pick & Pack together, it takes 6.4 s. | `WarehouseCapacityBanner.tsx`, `warehouseCapacity.ts` | Compute throughput and dwell on the server and return the few numbers the banner shows. |
| N-06 | Low | Customers | The Customers, Routing Guide and Shipping Labels pages and the customers report still load every customer with full price sheets (about 2.3 MB). That's fine at 200 customers but grows with pricing. | `Customers.tsx`, `RoutingGuide*.tsx`, `ShippingLabelCreate.tsx` | Use the summary list and load one customer on selection. |
| R5-07 | Medium | Security | Any signed-in account can download every order with line prices, every item and every customer's addresses. | `routes/salesOrders.ts` list, `items.ts`, `customers.ts` | Dashboard summary endpoint; gate the full list behind an order-view permission; strip rates for accounts without pricing access. |
| R5-08 | Medium | Audit | Audit rows are written after the transaction commits and can be lost; only order edits carry a diff. | `server/src/lib/audit.ts` | Write inside the transaction; add diffs to the remaining update actions. |
| R5-09 | Low | UI | No React error boundary; a rendering error blanks the page. (Failed writes are already surfaced by the global rejection handler in `main.tsx`.) | `src/App.tsx` | Add an error boundary around the router outlet and toasts in place of `alert()`. |
| R5-12 | Medium | Performance | Reservations live in JSON on the order, so the availability check and the allocation pages load every open order. | `lib/inventory.ts`, `AllocationDecision.tsx` | Reservation table or a per-item reserved counter maintained in the same transactions. |
| R5-14 | Low | Data | Items have no cost; inventory value and PO defaults use the sell price. | `schema.prisma` Item | Add `unitCost`, snapshot it on invoice lines, update from PO receipts. |
| R5-15 | Low | Data | Quantities are integers and U/M is free text. | `schema.prisma` | Decide on decimal quantities and a U/M table before invoicing depends on it. |
| R5-19 | - | Tests | Frontend has no automated tests (the server suite exists as of round 5). | `src/` | Playwright smoke over the five core flows. |
| R5-20 | Low | Ops | No request logging or request ids; no deployment/backup runbook. | `server/src/app.ts`, `README.md` | pino-http; a one-page runbook with nightly `pg_dump` and a tested restore. |

## Recently closed

| ID | Closed by | Notes |
|---|---|---|
| C-01, C-02, C-03, H-01, H-02, H-04, H-05, H-06, H-08, M-01 … M-09, L-01 | first review round (`b5a9c4e`, `cbab33d`) | See `erp-review.html`. |
| H-03 | paging merge (`bd6caa5`) + analytics cache | Order history pages are paged; analytics is computed on the server and shared for 60 s. See N-05 and N-06 for the pieces still left. |
| H-09 | import merge (`7dd143c`) | Row-by-row save with results, duplicate detection, server-rule validation, button locked while saving. |
| M-12 | `6ba6f5f` | Returns restock on receipt, and orders can be cancelled (M-12b above is the remaining piece). |
| M-14 | `6ba6f5f` | Lines carry `itemId`; renames follow history; unknown items are rejected on save. |
| H-07, N-03, N-04, R5-01, R5-02, R5-03, R5-04, R5-05, R5-06, R5-10, R5-11, R5-16, R5-17, R5-18, R5-21 | round 5 hardening (`0312973`) | Command endpoints with server-owned status/attribution/history; ship validates against the staged pick and on-hand; password policy with forced change; 10 h tokens and idle logout; trust proxy; case-insensitive item index; date indexes; dead counter route removed; validation bounds. |
| R5-13 | round 5 bridge | `updatedAt` on every business table. |
| R5-19 (server) | round 5 tests (`558e27e`) | 47 tests against Postgres, including race and randomized-workload invariants; GitHub Actions CI. |
