-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "weight" DECIMAL(12,4);

-- CreateTable
CREATE TABLE "ItemLink" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "ItemLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemLink_itemId_idx" ON "ItemLink"("itemId");

-- AddForeignKey
ALTER TABLE "ItemLink" ADD CONSTRAINT "ItemLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
