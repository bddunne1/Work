# Invoicing walkthrough — screenshots (28 Sep 2026)

Taken on the round-5 branch against a fresh database seeded with the
simulation master data (500 SKUs, 200 customers), with the local fake
QuickBooks (`QBO_FAKE=1`). Orders were entered, checked, allocated, released
and printed through the normal commands; everything below follows from the
Mark Shipped and Receive Return steps.

| # | Screen | What it shows |
|---|--------|---------------|
| 01 | Open Picks › S.O. 10007 | Printed order staged to ship. Mark Shipped confirms the actual quantities; the invoice is raised inside that same step. |
| 02 | Order detail › S.O. 10007 | After shipping: shipment history and the new Invoices block linking to INV-20007. |
| 03 | Invoices | One invoice per shipment with due date from terms, status, and the QuickBooks sync pill. |
| 04 | Invoice INV-20007 | The invoice document: shipped quantities at order prices, tax, terms, void action, sync state. |
| 05 | Return RA-3003 before receipt | The return authorization with the Receive Return panel (tick lines going back on the shelf). |
| 06 | Return RA-3003 after receipt | Received by admin; the credit memo raised at receipt is linked in the banner. |
| 07 | Credit memo CM-30003 | Priced from the original invoice line (Billed On column), with its own void action and sync pill. |
| 08 | Settings › QuickBooks | Connection, company, queue counts, last success/failure, Sync now, and reconcile by date range. |
| 09 | Customer editor | The Tax exempt flag that suppresses sales tax on that customer's invoices. |
| 10 | Dashboard | The Accounting lane with the Invoices entry. |

Regenerate: the driver script lives outside the repo; it creates the orders
through the API and screenshots the pages with Playwright against the Vite
dev server. Ask for it if you need to redo the set.
