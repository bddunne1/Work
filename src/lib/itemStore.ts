import { api } from "./apiClient";
import type { Item } from "../types";

// Prisma serializes Decimal fields as strings over JSON - convert rate and
// weight back to numbers so the rest of the app keeps treating them as
// numbers, same as it did when everything lived in localStorage.
function mapItem(i: Item): Item {
  return {
    ...i,
    rate: Number(i.rate),
    weight: i.weight !== undefined && i.weight !== null ? Number(i.weight) : undefined,
  };
}

export async function listItems(q?: string): Promise<Item[]> {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  const items = await api.get<Item[]>(`/api/items${query}`);
  return items.map(mapItem);
}

// A one-time lookup by item # (case/whitespace-insensitive) for callers
// that need to look up several items in a loop - fetch listItems() once,
// build this, then look up synchronously instead of awaiting per line.
export function itemsIndex(items: Item[]): Map<string, Item> {
  const map = new Map<string, Item>();
  for (const i of items) map.set(i.itemNumber.trim().toLowerCase(), i);
  return map;
}

export async function getItem(id: string): Promise<Item | undefined> {
  try {
    return mapItem(await api.get<Item>(`/api/items/${id}`));
  } catch {
    return undefined;
  }
}

// No dedicated lookup endpoint - the catalog is small enough that fetching
// the full list and finding by number client-side is simpler than adding
// one, and callers that need this in a loop should fetch listItems() once
// and build their own Map instead of calling this repeatedly.
export async function getItemByNumber(itemNumber: string): Promise<Item | undefined> {
  const q = itemNumber.trim().toLowerCase();
  if (!q) return undefined;
  const items = await listItems();
  return items.find((i) => i.itemNumber.trim().toLowerCase() === q);
}

export async function saveItem(item: Item): Promise<Item> {
  return mapItem(await api.post<Item>("/api/items", item));
}

export async function updateItem(item: Item): Promise<Item> {
  return mapItem(await api.put<Item>(`/api/items/${item.id}`, item));
}

export async function deleteItem(id: string): Promise<void> {
  await api.del(`/api/items/${id}`);
}

// Sets qtyOnHand to `newQty` (a cycle-count correction) only if it is still
// `expectedQty` - what the person was looking at when they counted. If a
// shipment or receipt posted in between, the server answers 409 with the
// current figure instead of the correction silently undoing that movement.
export async function setQtyOnHandIfUnchanged(itemNumber: string, expectedQty: number, newQty: number): Promise<Item> {
  return mapItem(
    await api.patch<Item>(`/api/items/by-number/${encodeURIComponent(itemNumber)}/qty`, {
      setQtyOnHand: newQty,
      expectedQtyOnHand: expectedQty,
    })
  );
}
