// Replaces a child collection (e.g. a customer's shipping locations) with
// exactly what the caller sent: rows whose id is missing from the payload
// are deleted, rows the caller sent are updated (only if something actually
// changed) or created. This matches the old localStorage model where the
// frontend always sent the full parent object with its full child arrays on
// every save - including a client-generated id for a row the user just
// added client-side, which doesn't exist in the DB yet.
//
// Only rows that differ are written: a key account's price sheet runs to
// hundreds of rows, and changing one price used to issue one upsert per row
// (hundreds of queries inside one transaction). An id that already belongs
// to a *different* parent is never "upserted" onto it - it falls through to
// create, where the primary key rejects it.
//
// `data` methods are intentionally loosely typed (not the specific Prisma
// per-model input types) since this helper is shared across several
// unrelated child tables - each call site's `toData` still returns a
// properly shaped object for its own model.
interface ChildDelegate {
  findMany(args: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  update(args: { where: { id: string }; data: any }): Promise<unknown>;
  createMany(args: { data: any[] }): Promise<unknown>;
}

// Normalizes a stored column value and an incoming value to something
// comparable: Prisma Decimals and numbers compare numerically, Dates by
// timestamp, JSON columns structurally.
function comparable(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && v !== null && "toNumber" in v && typeof (v as { toNumber: unknown }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

function changed(existing: Record<string, unknown>, data: Record<string, unknown>): boolean {
  return Object.keys(data).some((k) => comparable(existing[k]) !== comparable(data[k]));
}

export async function syncChildren<TItem extends { id?: string }>(
  delegate: ChildDelegate,
  parentId: string | number,
  parentField: string,
  items: TItem[],
  toData: (item: TItem) => Record<string, unknown>
): Promise<void> {
  const existing = await delegate.findMany({ where: { [parentField]: parentId } });
  const existingById = new Map(existing.map((row) => [row.id as string, row]));
  const keepIds = new Set(items.filter((i) => i.id && existingById.has(i.id)).map((i) => i.id as string));

  const toDelete = existing.filter((row) => !keepIds.has(row.id as string)).map((row) => row.id as string);
  if (toDelete.length > 0) {
    await delegate.deleteMany({ where: { [parentField]: parentId, id: { in: toDelete } } });
  }

  const toCreate: Record<string, unknown>[] = [];
  for (const item of items) {
    const data = toData(item);
    const current = item.id ? existingById.get(item.id) : undefined;
    if (current) {
      if (changed(current, data)) await delegate.update({ where: { id: item.id as string }, data });
    } else {
      toCreate.push({ ...data, ...(item.id ? { id: item.id } : {}), [parentField]: parentId });
    }
  }
  if (toCreate.length > 0) await delegate.createMany({ data: toCreate });
}
