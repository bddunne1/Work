-- Invoice review queue (sprint 2), part 1: the new enum values. Postgres
-- refuses to use an enum value added in the same transaction, so the
-- columns that default to DRAFT come in the next migration.
CREATE TYPE "DocLineKind" AS ENUM ('ITEM', 'CHARGE');
ALTER TYPE "InvoiceStatus" ADD VALUE 'DRAFT';
