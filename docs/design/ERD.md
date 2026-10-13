# Splice OMS entity relationship diagram

The editable diagram lives in Lucidchart: https://lucid.app/lucidchart/293232f3-6bd0-4ffc-8922-c9250e145fec/edit
(a PNG export, `erd-2026-10.png`, sits beside this file). It is drawn from
`server/prisma/schema.prisma` as of October 2026, after sprint 3.

Groups, left to right: accounts and audit; customers and their ship-tos,
notes, part numbers and price sheet; sales orders with their lines, the
reservation table (`Allocation`) and shipment records; the item catalog
with components, links and the stock ledger; vendors and purchase orders
with receipts. Below: returns and their lines; invoices and credit memos
with their lines; the QuickBooks bridge (connection, external ids, outbox,
log).

Solid crow's-foot lines are foreign keys. Lines labelled "soft ref" are
ids kept as plain columns without a constraint (the ship-to location on an
order, the order on a return, the audit actor, the sales order line on an
invoice line, the return line on a credit memo line). Lines labelled
RESTRICT or SET NULL name the delete rule.

Regenerate after a schema change: create the ERD again from the schema
(the Lucid document was built with the Lucid MCP `lucid_create_erd` tool
and laid out by domain), or edit the entities in place in Lucidchart.
