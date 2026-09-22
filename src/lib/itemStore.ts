import type { Item } from "../types";

const ITEMS_KEY = "erp_items";

// Items saved before inventory tracking existed won't have these fields -
// default them on read so the app never sees `undefined` where a number
// is expected.
function normalizeItem(raw: Item): Item {
  return {
    ...raw,
    qtyOnHand: raw.qtyOnHand ?? 0,
    qtyOnPurchaseOrder: raw.qtyOnPurchaseOrder ?? 0,
  };
}

function readItems(): Item[] {
  try {
    const raw = localStorage.getItem(ITEMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Item[];
    return parsed.map(normalizeItem);
  } catch {
    return [];
  }
}

function writeItems(items: Item[]): void {
  try {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  } catch {
    // storage unavailable (private mode, blocked site data, etc.) - no-op
  }
}

export function listItems(): Item[] {
  return readItems().sort((a, b) => a.itemNumber.localeCompare(b.itemNumber));
}

export function getItem(id: string): Item | undefined {
  return readItems().find((i) => i.id === id);
}

export function getItemByNumber(itemNumber: string): Item | undefined {
  const q = itemNumber.trim().toLowerCase();
  if (!q) return undefined;
  return readItems().find((i) => i.itemNumber.trim().toLowerCase() === q);
}

export function saveItem(item: Item): void {
  const items = readItems();
  items.push(item);
  writeItems(items);
}

export function updateItem(item: Item): void {
  const items = readItems().map((i) => (i.id === item.id ? item : i));
  writeItems(items);
}

export function deleteItem(id: string): void {
  writeItems(readItems().filter((i) => i.id !== id));
}
