import { useState } from "react";
import { listItems } from "../lib/itemStore";
import type { LineItem } from "../types";
import { lineAmount, emptyLineItem } from "../types";

interface Props {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  readOnly?: boolean;
}

const ITEM_DATALIST_ID = "item-catalog-options";

export default function LineItemsTable({ items, onChange, readOnly }: Props) {
  const [catalog] = useState(() => listItems());

  function update(id: string, patch: Partial<LineItem>) {
    onChange(items.map((li) => (li.id === id ? { ...li, ...patch } : li)));
  }

  function remove(id: string) {
    onChange(items.filter((li) => li.id !== id));
  }

  function addRow() {
    onChange([...items, emptyLineItem()]);
  }

  function applyItemLookup(id: string, itemNumber: string) {
    const match = catalog.find((c) => c.itemNumber.trim().toLowerCase() === itemNumber.trim().toLowerCase());
    if (match) {
      update(id, { item: match.itemNumber, description: match.description, um: match.um });
    }
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
      <table className="data-table line-item-table">
        <thead>
          <tr>
            <th className="col-item">Item</th>
            <th className="col-desc">Description</th>
            <th className="col-um">U/M</th>
            <th className="col-qty">Ordered</th>
            <th className="col-rate">Rate</th>
            <th className="col-amount">Amount</th>
            {!readOnly && <th className="col-remove" />}
          </tr>
        </thead>
        <tbody>
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
                  className="num-input"
                  value={li.ordered}
                  disabled={readOnly}
                  onChange={(e) => update(li.id, { ordered: Number(e.target.value) })}
                />
              </td>
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
              <td className="amount-cell">${lineAmount(li).toFixed(2)}</td>
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
      {!readOnly && (
        <button type="button" className="secondary-btn" onClick={addRow}>
          + Add Line Item
        </button>
      )}
    </div>
  );
}
