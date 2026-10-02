-- Sprint 3: the Ready to ship stage between the printed pick and the
-- shipment (decided 1 Oct). Set by the pack check, which prints the packing
-- slip from what was packed; Mark Shipped then ships exactly that.
ALTER TABLE "SalesOrder" ADD COLUMN "readyAt" TIMESTAMP(3),
                         ADD COLUMN "readyBy" TEXT,
                         ADD COLUMN "readyById" TEXT;
-- Picks already on the floor with both documents printed are treated as
-- ready, so nothing in flight gets stuck behind the new step.
UPDATE "SalesOrder" SET "readyAt" = "packingSlipPrintedAt", "readyBy" = 'floor'
WHERE "status" = 'PICK_PACKED' AND "pickListPrintedAt" IS NOT NULL AND "packingSlipPrintedAt" IS NOT NULL;
