// Replaces a child collection (e.g. a customer's shipping locations) with
// exactly what the caller sent: rows whose id is missing from the payload
// are deleted, rows with an id are updated in place (preserving that id),
// and rows without an id are created. This matches the old localStorage
// model where the frontend always sent the full parent object with its
// full child arrays on every save.
//
// `data` methods are intentionally loosely typed (not the specific Prisma
// per-model input types) since this helper is shared across several
// unrelated child tables - each call site's `toData` still returns a
// properly shaped object for its own model.
interface ChildDelegate {
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  update(args: { where: { id: string }; data: any }): Promise<unknown>;
  create(args: { data: any }): Promise<unknown>;
}

export async function syncChildren<TItem extends { id?: string }>(
  delegate: ChildDelegate,
  parentId: string,
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
      await delegate.update({ where: { id: item.id }, data });
    } else {
      await delegate.create({ data: { ...data, [parentField]: parentId } });
    }
  }
}
