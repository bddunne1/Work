-- Item.itemNumber already has a unique index (and a case-insensitive one);
-- the plain index beside them was a duplicate (PF-12).
DROP INDEX IF EXISTS "Item_itemNumber_idx";
