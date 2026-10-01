import { useEffect, useRef, useState } from "react";
import { listItems } from "../lib/itemStore";
import { findCatalogItem, lineFromItem } from "../lib/lineLookup";
import type { CustomerPartMapping, CustomerPriceOverride, Item, LineItem, ShipmentRecord } from "../types";
import { lineAmount, emptyLineItem, shippedQtyFor } from "../types";

interface Props {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  readOnly?: boolean;
  // When set (and non-empty), adds read-only Shipped/Open columns so a
  // partially-shipped or backordered order shows what's left to fulfill
  // per line, not just what was originally ordered.
  shipmentHistory?: ShipmentRecord[];
  // The selected customer's part-number map and price overrides, if any -
  // when an item is looked up, its customer part # and any override price
  // auto-fill from these instead of leaving the operator to enter them.
  customerPartMap?: CustomerPartMapping[];
  customerPriceOverrides?: CustomerPriceOverride[];
  // The server left the prices out for this login (B-10): no Rate or
  // Amount columns rather than a row of zeros.
  pricesHidden?: boolean;
}

const ITEM_DATALIST_ID = "item-catalog-options";

export default function LineItemsTable({
  items,
  onChange,
  readOnly,
  shipmentHistory,
  customerPartMap,
  customerPriceOverrides,
  pricesHidden,
}: Props) {
  const [catalog, setCatalog] = useState<Item[]>([]);
  const showShipped = Boolean(shipmentHistory && shipmentHistory.length > 0);
  // A new line is scrolled into view and gets focus, so a long order's
  // "+ Add Line" doesn't leave the person hunting below the fold (C-17).
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const focusLast = useRef(false);
  useEffect(() => {
    if (!focusLast.current) return;
    focusLast.current = false;
    const row = bodyRef.current?.lastElementChild as HTMLElement | null;
    row?.scrollIntoView({ block: "nearest" });
    row?.querySelector("input")?.focus();
  }, [items.length]);

  useEffect(() => {
    listItems().then(setCatalog);
  }, []);

  function update(id: string, patch: Partial<LineItem>) {
    onChange(items.map((li) => (li.id === id ? { ...li, ...patch } : li)));
  }

  function remove(id: string) {
    onChange(items.filter((li) => li.id !== id));
  }

  function addRow() {
    onChange([...items, emptyLineItem()]);
    focusLast.current = true;
  }

  // Our item # or the customer's part # (shared with the Order Entry grid):
  // the customer's price if they have one, else the catalog rate, but a
  // rate someone already typed on the line is left alone.
  function applyItemLookup(id: string, itemNumber: string) {
    const ctx = { catalog, partMap: customerPartMap, priceOverrides: customerPriceOverrides };
    const match = findCatalogItem(ctx, itemNumber);
    if (!match) return;
    update(id, lineFromItem(ctx, match, items.find((li) => li.id === id)));
  }

  return (
    <div className="line-items">
      {!readOnly && (
        <datalist id={ITEM_DATALIST_ID}>
          {catalog.map((c) => (
            <option key={c.id} value={c.itemNumber}>
              {c.description}
            </option>
          ))}
        </datalist>
      )}
      <div className="scroll-window">
        <table className="data-table line-item-table">
          <thead>
            <tr>
              <th className="col-item">Item</th>
              <th className="col-cust-part">Customer Part #</th>
              <th className="col-desc">Description</th>
              <th className="col-um">U/M</th>
              <th className="col-qty">Ordered</th>
              {showShipped && <th className="col-qty">Shipped</th>}
              {showShipped && <th className="col-qty">Open</th>}
              {!pricesHidden && <th className="col-rate">Rate</th>}
              {!pricesHidden && <th className="col-amount">Amount</th>}
              {!readOnly && <th className="col-remove" />}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {items.map((li) => (
              <tr key={li.id}>
                <td>
                  <input
                    value={li.item}
                    disabled={readOnly}
                    list={readOnly ? undefined : ITEM_DATALIST_ID}
                    onChange={(e) => update(li.id, { item: e.target.value })}
                    onBlur={(e) => applyItemLookup(li.id, e.target.value)}
                  />
                </td>
                <td>
                  <input
                    value={li.customerPartNumber ?? ""}
                    disabled={readOnly}
                    onChange={(e) => update(li.id, { customerPartNumber: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={li.description}
                    disabled={readOnly}
                    onChange={(e) => update(li.id, { description: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="col-um-input"
                    value={li.um}
                    disabled={readOnly}
                    onChange={(e) => update(li.id, { um: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="num-input"
                    value={li.ordered}
                    disabled={readOnly}
                    onChange={(e) => update(li.id, { ordered: Number(e.target.value) })}
                  />
                </td>
                {showShipped &&
                  (() => {
                    const shipped = shippedQtyFor({ shipmentHistory }, li.id);
                    return (
                      <>
                        <td className="amount-cell">{shipped}</td>
                        <td className="amount-cell">{Math.max(0, li.ordered - shipped)}</td>
                      </>
                    );
                  })()}
                {!pricesHidden && (
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      className="num-input"
                      value={li.rate}
                      disabled={readOnly}
                      onChange={(e) => update(li.id, { rate: Number(e.target.value) })}
                    />
                  </td>
                )}
                {!pricesHidden && <td className="amount-cell">${lineAmount(li).toFixed(2)}</td>}
                {!readOnly && (
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => remove(li.id)}
                      aria-label="Remove line"
                    >
                      &times;
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <button type="button" className="secondary-btn" onClick={addRow}>
          + Add Line Item
        </button>
      )}
    </div>
  );
}
