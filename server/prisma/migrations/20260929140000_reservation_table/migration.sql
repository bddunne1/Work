-- Reservation table (sprint 2, A-25): what each open order line is holding
-- against stock, and the per-item total, maintained by the API in the same
-- transaction as every order step.

ALTER TABLE "Item" ADD COLUMN "qtyReserved" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "soNumber" INTEGER NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Allocation_lineItemId_key" ON "Allocation"("lineItemId");
CREATE INDEX "Allocation_soNumber_idx" ON "Allocation"("soNumber");
CREATE INDEX "Allocation_itemId_idx" ON "Allocation"("itemId");

ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_soNumber_fkey" FOREIGN KEY ("soNumber") REFERENCES "SalesOrder"("soNumber") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "SalesOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- backfill: one row per line of every open order that is holding stock,
-- from the allocation / pendingShipment JSON the app maintained until now
-- (allocated-not-released plus released-not-shipped), then the item totals.
INSERT INTO "Allocation" ("id", "soNumber", "lineItemId", "itemId", "qty")
SELECT gen_random_uuid()::text, o."soNumber", l."id", l."itemId", h.qty
FROM "SalesOrder" o
JOIN "SalesOrderLine" l ON l."soNumber" = o."soNumber"
JOIN LATERAL (
    SELECT COALESCE((
            SELECT SUM((a->>'allocatedQty')::int)
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o."allocation"->'lines') = 'array' THEN o."allocation"->'lines' ELSE '[]'::jsonb END) a
            WHERE a->>'lineItemId' = l."id"), 0)
         + COALESCE((
            SELECT SUM((p->>'qty')::int)
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o."pendingShipment") = 'array' THEN o."pendingShipment" ELSE '[]'::jsonb END) p
            WHERE p->>'lineItemId' = l."id"), 0) AS qty
) h ON true
WHERE o."status" IN ('ALLOCATED', 'BACKORDERED', 'PICK_PACKED')
  AND l."itemId" IS NOT NULL
  AND h.qty > 0;

UPDATE "Item" i
SET "qtyReserved" = s.total
FROM (SELECT "itemId", SUM("qty") AS total FROM "Allocation" GROUP BY "itemId") s
WHERE s."itemId" = i."id";
