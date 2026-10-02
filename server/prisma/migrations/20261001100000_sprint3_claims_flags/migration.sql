-- Sprint 3: a ten-minute claim on an order under review (C-08), and the
-- flag set on a back order when stock for it arrives on a PO (G-06).
ALTER TABLE "SalesOrder" ADD COLUMN "claimedById" TEXT,
                         ADD COLUMN "claimedBy" TEXT,
                         ADD COLUMN "claimedUntil" TIMESTAMP(3),
                         ADD COLUMN "stockArrivedAt" TIMESTAMP(3);
