// Replaces a child collection (e.g. a customer's shipping locations) with
// exactly what the caller sent: rows whose id is missing from the payload
// are deleted, and every row the caller sent is upserted by that id. This
// matches the old localStorage model where the frontend always sent the
// full parent object with its full child arrays on every save - including
// a client-generated id for a row the user just added client-side, which
// doesn't exist in the DB yet. Upsert (not update) is what makes that
// first save work: a plain `update` 404s (Prisma P2025) on a row that
// isn't there yet.
//
// `data` methods are intentionally loosely typed (not the specific Prisma
// per-model input types) since this helper is shared across several
// unrelated child tables - each call site's `toData` still returns a
// properly shaped object for its own model.
interface ChildDelegate {
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  upsert(args: { where: { id: string }; create: any; update: any }): Promise<unknown>;
  create(args: { data: any }): Promise<unknown>;
}

export async function syncChildren<TItem extends { id?: string }>(
  delegate: ChildDelegate,
  parentId: string | number,
  parentField: string,
  items: TItem[],
  toData: (item: TItem) => Record<string, unknown>
): Promise<void> {
  const keepIds = items.filter((i) => i.id).map((i) => i.id as string);
  await delegate.deleteMany({
    where: keepIds.length
      ? { [parentField]: parentId, id: { notIn: keepIds } }
      : { [parentField]: parentId },
  });
  for (const item of items) {
    const data = toData(item);
    if (item.id) {
      await delegate.upsert({
        where: { id: item.id },
        create: { ...data, id: item.id, [parentField]: parentId },
        update: data,
      });
    } else {
      await delegate.create({ data: { ...data, [parentField]: parentId } });
    }
  }
}
