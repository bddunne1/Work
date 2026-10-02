import type { CustomerPartMapping, CustomerPriceOverride, Item, LineItem } from "../types";

// Resolving what was typed in an order line's Item cell (G-11): our item
// number first, then the customer's own part number for it; the line then
// takes the catalog description and unit, the customer's sheet price if
// there is one (else the catalog rate, unless a rate was already typed),
// and the customer part number. Shared by the Order Entry grid and the
// line table on Sales Order View.
export interface LineLookupContext {
  catalog: Item[];
  partMap?: CustomerPartMapping[];
  priceOverrides?: CustomerPriceOverride[];
}

const norm = (s: string) => s.trim().toLowerCase();

export function findCatalogItem(ctx: LineLookupContext, text: string): Item | undefined {
  const q = norm(text);
  if (!q) return undefined;
  const byNumber = ctx.catalog.find((c) => norm(c.itemNumber) === q);
  if (byNumber) return byNumber;
  const mapped = ctx.partMap?.find((m) => norm(m.customerPartNumber) === q);
  if (mapped) return ctx.catalog.find((c) => norm(c.itemNumber) === norm(mapped.itemNumber));
  const onSheet = ctx.priceOverrides?.find((p) => p.customerPartNumber && norm(p.customerPartNumber) === q);
  if (onSheet) return ctx.catalog.find((c) => norm(c.itemNumber) === norm(onSheet.itemNumber));
  return undefined;
}

export type PriceSource = "sheet" | "catalog";

export function priceSourceFor(ctx: LineLookupContext, itemNumber: string): PriceSource | undefined {
  const q = norm(itemNumber);
  if (!q || !ctx.catalog.some((c) => norm(c.itemNumber) === q)) return undefined;
  return ctx.priceOverrides?.some((p) => norm(p.itemNumber) === q) ? "sheet" : "catalog";
}

// The patch for a line once `item` resolved. A rate already typed on the
// line is left alone unless the customer has a sheet price.
export function lineFromItem(ctx: LineLookupContext, item: Item, current?: Pick<LineItem, "rate">): Partial<LineItem> {
  const q = norm(item.itemNumber);
  const customerPartNumber = ctx.partMap?.find((m) => norm(m.itemNumber) === q)?.customerPartNumber;
  const priceOverride = ctx.priceOverrides?.find((p) => norm(p.itemNumber) === q)?.price;
  const rate = priceOverride ?? (current && current.rate > 0 ? undefined : item.rate);
  return {
    item: item.itemNumber,
    description: item.description,
    um: item.um,
    ...(rate !== undefined ? { rate } : {}),
    ...(customerPartNumber ? { customerPartNumber } : {}),
  };
}

// Units on the shelf not held by another open order.
export function availableNow(item: Pick<Item, "qtyOnHand" | "qtyReserved">): number {
  return item.qtyOnHand - (item.qtyReserved ?? 0);
}

// Lines pasted from a customer's PO or a spreadsheet: one line per row,
// "item<tab>qty", "item, qty" or "item qty"; a bare item takes quantity 1.
// Blank lines and a header row that has no quantity are skipped.
export function parsePastedLines(text: string): { item: string; qty: number }[] {
  const out: { item: string; qty: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\t|,|;|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    let item = parts[0] ?? "";
    let qty = Number(parts[1]);
    if (parts.length === 1) {
      // "ITEM 12" with a single space.
      const m = line.match(/^(\S+)\s+(\d+(?:\.\d+)?)$/);
      if (m) {
        item = m[1];
        qty = Number(m[2]);
      } else {
        qty = 1;
      }
    }
    if (!item || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ item, qty: Math.round(qty) });
  }
  return out;
}
