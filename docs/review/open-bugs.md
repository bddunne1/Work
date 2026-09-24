# Open bugs

Running log of known defects that are still open. It starts from the
24 Sep 2026 review (`erp-review.html`, finding IDs like H-07) and adds
anything found since (IDs N-xx). When one is fixed, move it to "Recently
closed" with the commit, and update the shared to-do list.

Severity is rated for an internal network with about 15 users.

## Open

| ID | Severity | Area | Problem | Where | Suggested fix |
|---|---|---|---|---|---|
| H-07 | High | Security | The seeded `admin` / `123` account still exists, with no password policy and no forced change on first login. Sign-in is now throttled. | `server/src/seed.ts`, `routes/accounts.ts` | Change the password now; enforce at least 10 characters and a change on first login. |
| H-10 | High | Reports | The "Open Sales Orders", "Open POs" and "Open Returns" presets have no status filter, so they include shipped or closed records. | `src/lib/reports/presets.ts` | Add an exclude / multi-select status filter; give each preset its default. |
| M-10 | Medium | Vendors | The Vendors page saves on every keystroke, which causes false "changed by someone else" alerts and lost typing. | `src/pages/Vendors.tsx:36-50` | Keep edits in a draft; save on blur or with a Save button. |
| M-11 | Medium | Customers / Settings | Adding a customer note also saves any half-finished address or terms edits. Clearing the lead-time field saves 0. | `Customers.tsx:77-115`, `Settings.tsx:42-52` | Apply the note to the last saved record; validate Settings before saving on blur. |
| M-12b | Medium | Pick & pack | A line released at 0 keeps its allocation, so after the partial ships the order holds that stock until someone re-allocates. | `PickPackDetail.tsx` release | Release unpicked lines' allocation on ship, or prompt for it. |
| M-13 | Medium | Planning | The backorder forecast counts all incoming PO stock toward every order. The capacity banner calls average load "capacity". | `backorderForecast.ts`, `warehouseCapacity.ts` | Allocate incoming supply in queue order; use a configured maximum capacity. |
| M-15 | Medium | Pricing | An order line is $0.00 when the customer has no override price. PO cost defaults to the sell price. Return credit uses the catalog price, not the price charged. | `LineItemsTable.tsx:62`, `PurchaseOrderForm.tsx:49`, `ReturnForm.tsx:50` | Fall back to the catalog rate; add item cost; credit from the S.O. line. |
| L-02 | Low | Analytics | "Revenue" is bookings: it includes tax and unshipped orders, and returns aren't subtracted. Inventory value uses the sell price. | analytics summary | Rename, or compute from shipments and cost. |
| L-03 | Low | Deployment | Traffic is plain HTTP, CORS allows `*`, and the frontend defaults to `localhost:4000`. | `apiClient.ts:4`, `server/src/index.ts` | Serve from one origin behind TLS and restrict CORS. |
| L-04 | Low | Money | Money math is floating point, so printed line amounts can differ from the subtotal by cents. | `types.ts lineAmount / orderSubtotal` | Calculate in integer cents and round each line. |
| L-06 | Low | Maintainability | Permissions are defined in three places, and `GenerateBOL.tsx` is 972 lines. | `permissions.ts`, server routes, `GenerateBOL.tsx` | Share one page-to-API map with a test per preset; split the BOL form from its print view. |
| N-01 | Low | Import | The inventory import's "On Purchase Order" column does nothing (on-PO is now computed from open POs). | `importParsers.ts`, Import templates | Drop the column from the template, or warn when it's filled. |
| N-02 | Low | Errors | Server validation errors (400) show as a generic "rejected as invalid" because the zod details aren't passed through. | `src/lib/apiClient.ts` | Turn `error.fieldErrors` into a readable message. |
| N-03 | Low | Permissions | Order and RA detail pages let the person who entered a record edit it, but the server requires page edit access, so the save is refused. | `OrderDetail.tsx`, `ReturnDetail.tsx` | Either allow the writer on the server or remove the carve-out in the UI. |
| N-05 | Medium | Performance | The warehouse capacity banner on Pick & Pack downloads every order shipped in the last 30 days (about 13 MB per person at 150 orders/day). With 15 people opening Pick & Pack together, it takes 6.4 s. | `WarehouseCapacityBanner.tsx`, `warehouseCapacity.ts` | Compute throughput and dwell on the server and return the few numbers the banner shows. |
| N-06 | Low | Customers | The Customers, Routing Guide and Shipping Labels pages and the customers report still load every customer with full price sheets (about 2.3 MB). That's fine at 200 customers but grows with pricing. | `Customers.tsx`, `RoutingGuide*.tsx`, `ShippingLabelCreate.tsx` | Use the summary list and load one customer on selection. |
| N-04 | Low | Errors | Some permission messages name internal page keys ("needs edit access to validation") instead of page names. | `server/src/routes/salesOrders.ts` | Map keys to the labels in `PAGE_DEFS`. |

## Recently closed

| ID | Closed by | Notes |
|---|---|---|
| C-01, C-02, C-03, H-01, H-02, H-04, H-05, H-06, H-08, M-01 … M-09, L-01 | first review round (`b5a9c4e`, `cbab33d`) | See `erp-review.html`. |
| H-03 | paging merge (`bd6caa5`) + analytics cache | Order history pages are paged; analytics is computed on the server and shared for 60 s. See N-05 and N-06 for the pieces still left. |
| H-09 | import merge (`7dd143c`) | Row-by-row save with results, duplicate detection, server-rule validation, button locked while saving. |
| M-12 | `6ba6f5f` | Returns restock on receipt, and orders can be cancelled (M-12b above is the remaining piece). |
| M-14 | `6ba6f5f` | Lines carry `itemId`; renames follow history; unknown items are rejected on save. |
