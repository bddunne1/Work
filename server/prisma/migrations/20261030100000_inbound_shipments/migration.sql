-- Sprint 4: inbound shipments. One record per container or inbound shipment
-- from a vendor, linked to the vendor PO lines it carries. Lines go with the
-- shipment when it is deleted; a PO line that an inbound line references
-- cannot be deleted.
CREATE TYPE "InboundStatus" AS ENUM ('BOOKED', 'IN_TRANSIT', 'AT_PORT', 'ARRIVED', 'RECEIVED', 'CANCELLED');

CREATE TABLE "InboundShipment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "carrier" TEXT NOT NULL DEFAULT '',
    "vendorId" TEXT,
    "status" "InboundStatus" NOT NULL DEFAULT 'BOOKED',
    "etd" DATE,
    "eta" DATE,
    "arrivedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InboundShipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InboundShipmentLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "vendorPoLineId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "InboundShipmentLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InboundShipment_status_idx" ON "InboundShipment"("status");
CREATE INDEX "InboundShipment_eta_idx" ON "InboundShipment"("eta");
CREATE INDEX "InboundShipment_vendorId_idx" ON "InboundShipment"("vendorId");
CREATE INDEX "InboundShipmentLine_shipmentId_idx" ON "InboundShipmentLine"("shipmentId");
CREATE INDEX "InboundShipmentLine_vendorPoLineId_idx" ON "InboundShipmentLine"("vendorPoLineId");

ALTER TABLE "InboundShipment" ADD CONSTRAINT "InboundShipment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InboundShipmentLine" ADD CONSTRAINT "InboundShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "InboundShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundShipmentLine" ADD CONSTRAINT "InboundShipmentLine_vendorPoLineId_fkey" FOREIGN KEY ("vendorPoLineId") REFERENCES "VendorPoLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
