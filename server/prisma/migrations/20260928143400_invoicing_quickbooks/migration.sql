-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'VOID');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "taxExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ReturnAuthorization" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "VendorPurchaseOrder" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "Invoice" (
    "invoiceNumber" TEXT NOT NULL,
    "soNumber" INTEGER NOT NULL,
    "shipmentRecordId" TEXT,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "billTo" JSONB NOT NULL,
    "shipTo" JSONB NOT NULL,
    "poNumber" TEXT NOT NULL DEFAULT '',
    "terms" TEXT NOT NULL DEFAULT '',
    "rep" TEXT NOT NULL DEFAULT '',
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("invoiceNumber")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "salesOrderLineId" TEXT,
    "itemId" TEXT,
    "item" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "um" TEXT NOT NULL DEFAULT 'EA',
    "qty" INTEGER NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditMemo" (
    "creditMemoNumber" TEXT NOT NULL,
    "raNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "billTo" JSONB NOT NULL,
    "soNumber" TEXT,
    "memoDate" DATE NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditMemo_pkey" PRIMARY KEY ("creditMemoNumber")
);

-- CreateTable
CREATE TABLE "CreditMemoLine" (
    "id" TEXT NOT NULL,
    "creditMemoNumber" TEXT NOT NULL,
    "returnLineId" TEXT,
    "invoiceNumber" TEXT,
    "itemId" TEXT,
    "item" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "um" TEXT NOT NULL DEFAULT 'EA',
    "qty" INTEGER NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "CreditMemoLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalRef" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "syncToken" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncOutbox" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SyncOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "message" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "system" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "connectedBy" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "config" JSONB,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("system")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_shipmentRecordId_key" ON "Invoice"("shipmentRecordId");

-- CreateIndex
CREATE INDEX "Invoice_soNumber_idx" ON "Invoice"("soNumber");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_invoiceDate_idx" ON "Invoice"("invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceNumber_idx" ON "InvoiceLine"("invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceLine_itemId_idx" ON "InvoiceLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditMemo_raNumber_key" ON "CreditMemo"("raNumber");

-- CreateIndex
CREATE INDEX "CreditMemo_customerId_idx" ON "CreditMemo"("customerId");

-- CreateIndex
CREATE INDEX "CreditMemo_memoDate_idx" ON "CreditMemo"("memoDate");

-- CreateIndex
CREATE INDEX "CreditMemoLine_creditMemoNumber_idx" ON "CreditMemoLine"("creditMemoNumber");

-- CreateIndex
CREATE INDEX "ExternalRef_system_entityType_externalId_idx" ON "ExternalRef"("system", "entityType", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRef_system_entityType_entityId_key" ON "ExternalRef"("system", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "SyncOutbox_system_status_nextAttemptAt_idx" ON "SyncOutbox"("system", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SyncOutbox_entityType_entityId_idx" ON "SyncOutbox"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "SyncLog_createdAt_idx" ON "SyncLog"("createdAt");

-- CreateIndex
CREATE INDEX "SyncLog_entityType_entityId_idx" ON "SyncLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_soNumber_fkey" FOREIGN KEY ("soNumber") REFERENCES "SalesOrder"("soNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_shipmentRecordId_fkey" FOREIGN KEY ("shipmentRecordId") REFERENCES "ShipmentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceNumber_fkey" FOREIGN KEY ("invoiceNumber") REFERENCES "Invoice"("invoiceNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMemo" ADD CONSTRAINT "CreditMemo_raNumber_fkey" FOREIGN KEY ("raNumber") REFERENCES "ReturnAuthorization"("raNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMemo" ADD CONSTRAINT "CreditMemo_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMemoLine" ADD CONSTRAINT "CreditMemoLine_creditMemoNumber_fkey" FOREIGN KEY ("creditMemoNumber") REFERENCES "CreditMemo"("creditMemoNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMemoLine" ADD CONSTRAINT "CreditMemoLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
