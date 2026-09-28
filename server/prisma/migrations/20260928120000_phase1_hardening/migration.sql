-- Round 5 hardening (docs/review/erp-review-5.html).

-- R5-04: forced password change after seeding or an admin reset.
ALTER TABLE "Account" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- R5-10: item numbers are looked up case- and whitespace-insensitively
-- everywhere, so they must be unique that way too. Fails if two such
-- spellings already exist - resolve them first (rename one under Items).
CREATE UNIQUE INDEX "Item_itemNumber_ci_key" ON "Item" (lower(btrim("itemNumber")));

-- R5-16: the columns every list sorts and filters on.
CREATE INDEX "SalesOrder_createdAt_idx" ON "SalesOrder"("createdAt");
CREATE INDEX "SalesOrder_orderDate_idx" ON "SalesOrder"("orderDate");
CREATE INDEX "SalesOrder_dueDate_idx" ON "SalesOrder"("dueDate");
CREATE INDEX "ShipmentRecord_shippedAt_idx" ON "ShipmentRecord"("shippedAt");
