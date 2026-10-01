-- Order search at a year of data (sprint 2, D-08): the latest shipment
-- date kept on the order (maintained by the ship and undo commands), and
-- trigram indexes behind the customer-name and P.O. number searches. The
-- search compares lower() of each, so the indexes are on lower() too
-- (expression indexes, which Prisma leaves alone).
ALTER TABLE "SalesOrder" ADD COLUMN "lastShippedAt" TIMESTAMP(3);
UPDATE "SalesOrder" so
SET "lastShippedAt" = (SELECT max(r."shippedAt") FROM "ShipmentRecord" r WHERE r."soNumber" = so."soNumber");
CREATE INDEX "SalesOrder_lastShippedAt_idx" ON "SalesOrder"("lastShippedAt");

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "SalesOrder_billTo_name_trgm_idx" ON "SalesOrder" USING gin ((lower("billTo"->>'name')) gin_trgm_ops);
CREATE INDEX "SalesOrder_shipTo_name_trgm_idx" ON "SalesOrder" USING gin ((lower("shipTo"->>'name')) gin_trgm_ops);
CREATE INDEX "SalesOrder_poNumber_trgm_idx" ON "SalesOrder" USING gin ((lower("poNumber")) gin_trgm_ops);
