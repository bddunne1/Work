-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('ENTERED', 'CHECKED', 'ALLOCATED', 'BACKORDERED', 'PICK_PACKED', 'SHIPPED');

-- CreateEnum
CREATE TYPE "PickPackStatus" AS ENUM ('PARTIAL', 'COMPLETE');

-- CreateEnum
CREATE TYPE "VendorPoStatus" AS ENUM ('OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "permissions" JSONB,
    "initials" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL DEFAULT '',
    "billTo" JSONB NOT NULL,
    "terms" TEXT NOT NULL DEFAULT '',
    "shipVia" TEXT NOT NULL DEFAULT '',
    "fob" TEXT NOT NULL DEFAULT '',
    "rep" TEXT NOT NULL DEFAULT '',
    "shipCompleteOnly" BOOLEAN NOT NULL DEFAULT false,
    "privateLabelName" TEXT,
    "routingGuide" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingLocation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "address" JSONB NOT NULL,

    CONSTRAINT "ShippingLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPartMapping" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "customerPartNumber" TEXT NOT NULL,

    CONSTRAINT "CustomerPartMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPriceOverride" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "price" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "CustomerPriceOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "um" TEXT NOT NULL DEFAULT 'EA',
    "rate" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "qtyOnHand" INTEGER NOT NULL DEFAULT 0,
    "qtyOnPurchaseOrder" INTEGER NOT NULL DEFAULT 0,
    "reorderPoint" INTEGER,
    "countryOfOrigin" TEXT,
    "preferredVendorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemComponent" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "ItemComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "soNumber" SERIAL NOT NULL,
    "poNumber" TEXT NOT NULL DEFAULT '',
    "orderDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "customerId" TEXT,
    "shipToLocationId" TEXT,
    "billTo" JSONB NOT NULL,
    "shipTo" JSONB NOT NULL,
    "fob" TEXT NOT NULL DEFAULT '',
    "shipVia" TEXT NOT NULL DEFAULT '',
    "terms" TEXT NOT NULL DEFAULT '',
    "rep" TEXT NOT NULL DEFAULT '',
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "OrderStatus" NOT NULL DEFAULT 'ENTERED',
    "checkedAt" TIMESTAMP(3),
    "checkedBy" TEXT,
    "allocation" JSONB,
    "labelPrintedAt" TIMESTAMP(3),
    "pickedAt" TIMESTAMP(3),
    "pendingShipment" JSONB,
    "pickListPrintedAt" TIMESTAMP(3),
    "packingSlipPrintedAt" TIMESTAMP(3),
    "estimatedShipDate" DATE,
    "pickPackStatus" "PickPackStatus",
    "bol" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("soNumber")
);

-- CreateTable
CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "soNumber" INTEGER NOT NULL,
    "item" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "um" TEXT NOT NULL DEFAULT 'EA',
    "ordered" INTEGER NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,
    "customerPartNumber" TEXT,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentRecord" (
    "id" TEXT NOT NULL,
    "soNumber" INTEGER NOT NULL,
    "shippedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lines" JSONB NOT NULL,

    CONSTRAINT "ShipmentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPurchaseOrder" (
    "poNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "expectedDate" DATE,
    "status" "VendorPoStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorPurchaseOrder_pkey" PRIMARY KEY ("poNumber")
);

-- CreateTable
CREATE TABLE "VendorPoLine" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "orderedQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "VendorPoLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorReceivingRecord" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lines" JSONB NOT NULL,

    CONSTRAINT "VendorReceivingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "ShippingLocation_customerId_idx" ON "ShippingLocation"("customerId");

-- CreateIndex
CREATE INDEX "CustomerNote_customerId_idx" ON "CustomerNote"("customerId");

-- CreateIndex
CREATE INDEX "CustomerPartMapping_customerId_idx" ON "CustomerPartMapping"("customerId");

-- CreateIndex
CREATE INDEX "CustomerPartMapping_itemNumber_idx" ON "CustomerPartMapping"("itemNumber");

-- CreateIndex
CREATE INDEX "CustomerPriceOverride_customerId_idx" ON "CustomerPriceOverride"("customerId");

-- CreateIndex
CREATE INDEX "CustomerPriceOverride_itemNumber_idx" ON "CustomerPriceOverride"("itemNumber");

-- CreateIndex
CREATE INDEX "Vendor_name_idx" ON "Vendor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Item_itemNumber_key" ON "Item"("itemNumber");

-- CreateIndex
CREATE INDEX "Item_itemNumber_idx" ON "Item"("itemNumber");

-- CreateIndex
CREATE INDEX "Item_preferredVendorId_idx" ON "Item"("preferredVendorId");

-- CreateIndex
CREATE INDEX "ItemComponent_itemId_idx" ON "ItemComponent"("itemId");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");

-- CreateIndex
CREATE INDEX "SalesOrder_status_idx" ON "SalesOrder"("status");

-- CreateIndex
CREATE INDEX "SalesOrderLine_soNumber_idx" ON "SalesOrderLine"("soNumber");

-- CreateIndex
CREATE INDEX "SalesOrderLine_item_idx" ON "SalesOrderLine"("item");

-- CreateIndex
CREATE INDEX "ShipmentRecord_soNumber_idx" ON "ShipmentRecord"("soNumber");

-- CreateIndex
CREATE INDEX "VendorPurchaseOrder_vendorId_idx" ON "VendorPurchaseOrder"("vendorId");

-- CreateIndex
CREATE INDEX "VendorPurchaseOrder_status_idx" ON "VendorPurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "VendorPoLine_poNumber_idx" ON "VendorPoLine"("poNumber");

-- CreateIndex
CREATE INDEX "VendorPoLine_itemNumber_idx" ON "VendorPoLine"("itemNumber");

-- CreateIndex
CREATE INDEX "VendorReceivingRecord_poNumber_idx" ON "VendorReceivingRecord"("poNumber");

-- AddForeignKey
ALTER TABLE "ShippingLocation" ADD CONSTRAINT "ShippingLocation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPartMapping" ADD CONSTRAINT "CustomerPartMapping_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPriceOverride" ADD CONSTRAINT "CustomerPriceOverride_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_preferredVendorId_fkey" FOREIGN KEY ("preferredVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemComponent" ADD CONSTRAINT "ItemComponent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_soNumber_fkey" FOREIGN KEY ("soNumber") REFERENCES "SalesOrder"("soNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentRecord" ADD CONSTRAINT "ShipmentRecord_soNumber_fkey" FOREIGN KEY ("soNumber") REFERENCES "SalesOrder"("soNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPurchaseOrder" ADD CONSTRAINT "VendorPurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPoLine" ADD CONSTRAINT "VendorPoLine_poNumber_fkey" FOREIGN KEY ("poNumber") REFERENCES "VendorPurchaseOrder"("poNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorReceivingRecord" ADD CONSTRAINT "VendorReceivingRecord_poNumber_fkey" FOREIGN KEY ("poNumber") REFERENCES "VendorPurchaseOrder"("poNumber") ON DELETE CASCADE ON UPDATE CASCADE;
