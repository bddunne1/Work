-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('ISSUED', 'RECEIVED', 'CLOSED');

-- CreateTable
CREATE TABLE "ReturnAuthorization" (
    "raNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "soNumber" TEXT,
    "billTo" JSONB NOT NULL,
    "requestDate" DATE NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" "ReturnStatus" NOT NULL DEFAULT 'ISSUED',
    "notes" TEXT NOT NULL DEFAULT '',
    "writtenBy" TEXT,
    "writtenById" TEXT,
    "writtenByColor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnAuthorization_pkey" PRIMARY KEY ("raNumber")
);

-- CreateTable
CREATE TABLE "ReturnLine" (
    "id" TEXT NOT NULL,
    "raNumber" TEXT NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "um" TEXT NOT NULL DEFAULT 'EA',
    "qty" INTEGER NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnAuthorization_customerId_idx" ON "ReturnAuthorization"("customerId");

-- CreateIndex
CREATE INDEX "ReturnAuthorization_status_idx" ON "ReturnAuthorization"("status");

-- CreateIndex
CREATE INDEX "ReturnLine_raNumber_idx" ON "ReturnLine"("raNumber");

-- CreateIndex
CREATE INDEX "ReturnLine_itemNumber_idx" ON "ReturnLine"("itemNumber");

-- AddForeignKey
ALTER TABLE "ReturnAuthorization" ADD CONSTRAINT "ReturnAuthorization_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_raNumber_fkey" FOREIGN KEY ("raNumber") REFERENCES "ReturnAuthorization"("raNumber") ON DELETE CASCADE ON UPDATE CASCADE;
