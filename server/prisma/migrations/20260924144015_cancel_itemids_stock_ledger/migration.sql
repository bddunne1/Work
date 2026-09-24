-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "ReturnAuthorization" ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedBy" TEXT;

-- AlterTable
ALTER TABLE "ReturnLine" ADD COLUMN     "itemId" TEXT,
ADD COLUMN     "restock" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT;

-- AlterTable
ALTER TABLE "SalesOrderLine" ADD COLUMN     "itemId" TEXT;

-- AlterTable
ALTER TABLE "VendorPoLine" ADD COLUMN     "itemId" TEXT;

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "qtyAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "actorId" TEXT,
    "actorUsername" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMovement_itemId_createdAt_idx" ON "StockMovement"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_refType_refId_idx" ON "StockMovement"("refType", "refId");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ReturnLine_itemId_idx" ON "ReturnLine"("itemId");

-- CreateIndex
CREATE INDEX "SalesOrderLine_itemId_idx" ON "SalesOrderLine"("itemId");

-- CreateIndex
CREATE INDEX "VendorPoLine_itemId_idx" ON "VendorPoLine"("itemId");

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPoLine" ADD CONSTRAINT "VendorPoLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: link existing order / PO / return lines to catalog items by
-- item number (case- and whitespace-insensitive, same rule the app uses).
UPDATE "SalesOrderLine" l SET "itemId" = i."id"
FROM "Item" i WHERE l."itemId" IS NULL AND lower(trim(l."item")) = lower(i."itemNumber");
UPDATE "VendorPoLine" l SET "itemId" = i."id"
FROM "Item" i WHERE l."itemId" IS NULL AND lower(trim(l."itemNumber")) = lower(i."itemNumber");
UPDATE "ReturnLine" l SET "itemId" = i."id"
FROM "Item" i WHERE l."itemId" IS NULL AND lower(trim(l."itemNumber")) = lower(i."itemNumber");
