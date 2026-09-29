# Sprint 2 — screenshots

| # | Screen | What changed |
|---|--------|--------------|
| 01 | Hamburger menu | Preferences and Settings entries alongside Change Password. |
| 02 | Preferences | Theme choice: follow the system, light, dark. Kept per browser. |
| 03 | Dashboard, dark | The dark theme applied. |
| 04 | Open Picks, dark | The dark theme on a working screen. |
| 05 | Dashboard | The Invoices tile carries the count of drafts waiting for review. |
| 06 | Invoices | The review queue: drafts oldest first, no number yet, "Not issued" in the QuickBooks column. |
| 07 | Draft invoice | Review mode: rates editable, Taxed per line, charges can be added, notes, Save draft and Approve and issue. |
| 08 | Draft with freight | A Freight charge added (not taxed), totals recomputed live. |
| 09 | Issued invoice | After Approve and issue: the number is assigned, the document is queued for QuickBooks and can only be voided. |
| 10 | Inventory | Allocated and Available come from the item row (`qtyReserved`, kept by the server), not a walk over open orders. |
| 11 | Open Picks | Pull from floor: an order cancelled after its pick list printed stays listed, with what was staged, until Logistics marks it pulled. |
| 12 | Sales Order View, Checked | Editing a checked order: header fields open, lines read-only until Re-open lines (which sends the order back to Validation on save). |
| 13 | Warehouse Capacity | Load, throughput, dwell and the estimate computed on the server in one request. |
| 14 | Reports | Only the data sources the account can read are offered; a refusal shows in place of the rows. |
| 15 | Dashboard, dock login | A login with Open Picks, Shipment History and Receiving only: queue counts and today's figures from the summary endpoint, links only where it has access, no Find-an-order beyond its pages. |
| 16 | Open Picks detail, dock login | The pick as the dock sees it: quantities to confirm, no rates and no total. |
| 17 | Shipment History, dock login | Invoice amounts withheld for a login without a pricing page. |
