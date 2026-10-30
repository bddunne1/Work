-- Sprint 5: the purchase order page shows who wrote the PO.
ALTER TABLE "VendorPurchaseOrder" ADD COLUMN "createdBy" TEXT,
                                  ADD COLUMN "createdById" TEXT;
