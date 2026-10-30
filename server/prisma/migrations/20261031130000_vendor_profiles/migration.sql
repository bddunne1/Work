-- Sprint 5: vendor profiles. Account number, terms, lead time, website, a
-- free-text notes field, an active flag, and dated notes with an author.
ALTER TABLE "Vendor" ADD COLUMN "accountNumber" TEXT,
                     ADD COLUMN "terms" TEXT,
                     ADD COLUMN "leadTimeDays" INTEGER,
                     ADD COLUMN "website" TEXT,
                     ADD COLUMN "notes" TEXT NOT NULL DEFAULT '',
                     ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "VendorNote" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "author" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VendorNote_vendorId_idx" ON "VendorNote"("vendorId");

ALTER TABLE "VendorNote" ADD CONSTRAINT "VendorNote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
