-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "checkedByColor" TEXT,
ADD COLUMN     "writtenBy" TEXT,
ADD COLUMN     "writtenByColor" TEXT,
ADD COLUMN     "writtenById" TEXT,
ALTER COLUMN "soNumber" DROP DEFAULT;
DROP SEQUENCE "SalesOrder_soNumber_seq";
