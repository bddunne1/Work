-- AlterTable
ALTER TABLE "CustomerPriceOverride" ADD COLUMN     "customerPartNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "length" DECIMAL(12,4),
ADD COLUMN     "pricePerFt" DECIMAL(12,4),
ADD COLUMN     "weight" DECIMAL(12,4);
