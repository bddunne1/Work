-- Item cost (E-05): the last purchase cost, editable on the catalog and
-- updated by every PO receipt. Null until a cost is known.
ALTER TABLE "Item" ADD COLUMN "cost" DECIMAL(12,4);
