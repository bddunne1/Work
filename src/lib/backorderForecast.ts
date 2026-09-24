// Estimates when a backordered sales order could ship, based on the
// expected arrival dates of open vendor POs that will restock its short
// items - the same reasoning a planner does by hand: "we're short 20 of
// RP-100, the next PO for it lands the 14th, so that's the earliest we
// could ship."
import type { Item, PurchaseOrder, VendorPurchaseOrder } from "../types";
import { availableQty, qtyAllocatedOnOrders, remainingToShip, vendorPoLineOutstanding } from "../types";

export interface LineShortfall {
  lineItemId: string;
  itemNumber: string;
  shortfallQty: number;
  // The date enough open-PO stock will have arrived to cover this line's
  // shortfall, or undefined if no open PO covers it yet.
  estimatedDate?: string;
}

export interface BackorderEstimate {
  lines: LineShortfall[];
  // The latest of every short line's estimated date - an order can't ship
  // until all of its short items are in. Undefined if any short line has
  // no open PO to cover it (so no estimate can be made).
  estimatedShipDate?: string;
}

// Only these vendor PO statuses still have stock coming.
const OPEN_VENDOR_PO_STATUSES = new Set(["Open", "Partially Received"]);

export function estimateBackorderShipDate(
  order: Pick<PurchaseOrder, "lineItems" | "shipmentHistory">,
  items: Item[],
  vendorPos: VendorPurchaseOrder[],
  allOrders: PurchaseOrder[]
): BackorderEstimate {
  const itemsByNumber = new Map(items.map((i) => [i.itemNumber.trim().toLowerCase(), i]));
  const lines: LineShortfall[] = [];
  let latest: string | undefined;
  let anyUnknown = false;

  for (const li of order.lineItems) {
    const remaining = remainingToShip(order, li);
    if (remaining <= 0) continue;

    const item = itemsByNumber.get(li.item.trim().toLowerCase());
    const allocated = item ? qtyAllocatedOnOrders(item.itemNumber, allOrders) : 0;
    const available = item ? availableQty(item, allocated) : 0;
    const shortfall = Math.max(0, remaining - Math.max(0, available));
    if (shortfall <= 0) continue;

    const incoming = vendorPos
      .filter((p) => OPEN_VENDOR_PO_STATUSES.has(p.status))
      .flatMap((p) =>
        p.lines
          .filter((l) => l.itemNumber.trim().toLowerCase() === li.item.trim().toLowerCase())
          .map((l) => ({ expectedDate: p.expectedDate, outstanding: vendorPoLineOutstanding(l) }))
      )
      .filter((c) => c.outstanding > 0)
      .sort((a, b) => (a.expectedDate ?? "9999-12-31").localeCompare(b.expectedDate ?? "9999-12-31"));

    let covered = 0;
    let estimatedDate: string | undefined;
    for (const c of incoming) {
      covered += c.outstanding;
      if (covered >= shortfall) {
        estimatedDate = c.expectedDate;
        break;
      }
    }

    lines.push({ lineItemId: li.id, itemNumber: li.item, shortfallQty: shortfall, estimatedDate });
    if (!estimatedDate) anyUnknown = true;
    else if (!latest || estimatedDate > latest) latest = estimatedDate;
  }

  return { lines, estimatedShipDate: anyUnknown ? undefined : latest };
}
