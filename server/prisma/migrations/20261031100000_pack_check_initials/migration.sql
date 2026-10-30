-- Sprint 5: the pack check records who picked and who checked. readyBy
-- stays the checker for anything that reads it; the shipment keeps a copy
-- because Mark Shipped clears the order's ready fields.
ALTER TABLE "SalesOrder" ADD COLUMN "pickedByInitials" TEXT,
                         ADD COLUMN "checkedByInitials" TEXT;
ALTER TABLE "ShipmentRecord" ADD COLUMN "pickedBy" TEXT,
                             ADD COLUMN "checkedBy" TEXT;
-- Orders already on the dock were packed and checked by the one person recorded.
UPDATE "SalesOrder" SET "pickedByInitials" = "readyBy", "checkedByInitials" = "readyBy" WHERE "readyAt" IS NOT NULL;
