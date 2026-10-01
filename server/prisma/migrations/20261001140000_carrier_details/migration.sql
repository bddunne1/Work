-- Carrier details saved on the order and on each shipment (G-07, decided
-- 1 Oct): carrier, SCAC, PRO and the pickup date, entered at the BOL step
-- or at Mark Shipped. The PRO is searchable from Open Orders.
ALTER TABLE "SalesOrder"
  ADD COLUMN "carrier" TEXT,
  ADD COLUMN "scac" TEXT,
  ADD COLUMN "proNumber" TEXT,
  ADD COLUMN "pickupDate" DATE;
ALTER TABLE "ShipmentRecord"
  ADD COLUMN "carrier" TEXT,
  ADD COLUMN "scac" TEXT,
  ADD COLUMN "proNumber" TEXT,
  ADD COLUMN "pickupDate" DATE;
CREATE INDEX "SalesOrder_proNumber_trgm_idx" ON "SalesOrder" USING gin ((lower("proNumber")) gin_trgm_ops);
