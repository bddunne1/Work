# Sprint 1 — screenshots (29 Sep 2026)

Taken on the sprint 1 branch against the demo database with the local fake
QuickBooks, after shipping three orders (one partial) and entering five
orders with mixed due dates.

| # | Screen | What changed |
|---|--------|--------------|
| 01 | Shipment History | One row per shipment with the invoice, partial shipments marked, a ship-date range (today by default), totals over the range, CSV export and Undo on an order's latest shipment only (C-09). |
| 02 | Validation | Oldest due date first with a Due Date column; skipped orders can be shown or hidden (C-08). |
| 03 | Validation decision | The Skip button next to the order summary parks the order for the session and moves to the next one (C-08). |
| 04 | Report runner | Opening a preset shows its filters and waits for Run instead of downloading the history; the Open presets default to the new Open status filter (D-05, B-18). |
| 05 | Purchase Orders | Searched and paged on the server (D-06). |
| 06 | Customer editor | The Inactive flag that replaces deleting a customer with history (A-14). |
