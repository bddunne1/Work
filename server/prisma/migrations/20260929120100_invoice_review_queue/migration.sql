-- Invoice review queue (sprint 2), part 2. Invoices and credit memos get a
-- uuid primary key so a draft can exist before its number is assigned at
-- approval; their lines follow the new key. Existing rows keep their
-- numbers and their ISSUED / VOID status.

-- Invoice: new id, backfilled
ALTER TABLE "Invoice" ADD COLUMN "id" TEXT;
UPDATE "Invoice" SET "id" = gen_random_uuid()::text;
ALTER TABLE "Invoice" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "InvoiceLine" ADD COLUMN "invoiceId" TEXT;
UPDATE "InvoiceLine" l SET "invoiceId" = i."id" FROM "Invoice" i WHERE l."invoiceNumber" = i."invoiceNumber";
ALTER TABLE "InvoiceLine" ALTER COLUMN "invoiceId" SET NOT NULL;
ALTER TABLE "InvoiceLine" DROP CONSTRAINT "InvoiceLine_invoiceNumber_fkey";
DROP INDEX "InvoiceLine_invoiceNumber_idx";
ALTER TABLE "InvoiceLine" DROP COLUMN "invoiceNumber";

ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_pkey",
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ALTER COLUMN "invoiceNumber" DROP NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'DRAFT',
  ADD CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
-- Everything issued so far was approved implicitly at creation.
UPDATE "Invoice" SET "approvedAt" = "createdAt", "approvedBy" = 'system' WHERE "status" <> 'DRAFT';

ALTER TABLE "InvoiceLine"
  ADD COLUMN "kind" "DocLineKind" NOT NULL DEFAULT 'ITEM',
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxable" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Credit memo: the same shape
ALTER TABLE "CreditMemo" ADD COLUMN "id" TEXT;
UPDATE "CreditMemo" SET "id" = gen_random_uuid()::text;
ALTER TABLE "CreditMemo" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "CreditMemoLine" ADD COLUMN "creditMemoId" TEXT;
UPDATE "CreditMemoLine" l SET "creditMemoId" = m."id" FROM "CreditMemo" m WHERE l."creditMemoNumber" = m."creditMemoNumber";
ALTER TABLE "CreditMemoLine" ALTER COLUMN "creditMemoId" SET NOT NULL;
ALTER TABLE "CreditMemoLine" DROP CONSTRAINT "CreditMemoLine_creditMemoNumber_fkey";
DROP INDEX "CreditMemoLine_creditMemoNumber_idx";
ALTER TABLE "CreditMemoLine" DROP COLUMN "creditMemoNumber";

ALTER TABLE "CreditMemo" DROP CONSTRAINT "CreditMemo_pkey",
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ALTER COLUMN "creditMemoNumber" DROP NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'DRAFT',
  ADD CONSTRAINT "CreditMemo_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "CreditMemo_creditMemoNumber_key" ON "CreditMemo"("creditMemoNumber");
UPDATE "CreditMemo" SET "approvedAt" = "createdAt", "approvedBy" = 'system' WHERE "status" <> 'DRAFT';

ALTER TABLE "CreditMemoLine"
  ADD COLUMN "kind" "DocLineKind" NOT NULL DEFAULT 'ITEM',
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxable" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "CreditMemoLine_creditMemoId_idx" ON "CreditMemoLine"("creditMemoId");
ALTER TABLE "CreditMemoLine" ADD CONSTRAINT "CreditMemoLine_creditMemoId_fkey" FOREIGN KEY ("creditMemoId") REFERENCES "CreditMemo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
