import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { listItems } from "../lib/itemStore";
import { availableNow, findCatalogItem, lineFromItem, parsePastedLines, priceSourceFor, type LineLookupContext } from "../lib/lineLookup";
import type { Customer, Item, LineItem } from "../types";
import { emptyLineItem } from "../types";
import OrderLineRow, { type GridCell } from "./OrderLineRow";

// The Order Entry line grid, worked from the keyboard (G-11): Enter in the
// Item cell resolves it and jumps to Ordered; Enter in the last cell of a
// complete line adds the next line; our item numbers and the customer's
// part numbers both resolve; pasting "item qty" lines fills several rows;
// each line shows what is available now and where its price came from.
interface Props {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  customer?: Customer;
  pricesHidden?: boolean;
}

const LIST_ID = "order-entry-item-options";

export default function OrderLineGrid({ items, onChange, customer, pricesHidden }: Props) {
  const [catalog, setCatalog] = useState<Item[]>([]);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const pendingFocus = useRef<{ row: number; cell: GridCell } | null>(null);

  useEffect(() => {
    listItems().then(setCatalog).catch(() => {});
  }, []);

  const ctx = useMemo<LineLookupContext>(() => ({ catalog, partMap: customer?.partNumberMap, priceOverrides: customer?.priceOverrides }), [catalog, customer]);
  const byNumber = useMemo(() => new Map(catalog.map((c) => [c.itemNumber.trim().toLowerCase(), c])), [catalog]);

  useEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    focusCell(want.row, want.cell);
  }, [items]);

  function focusCell(row: number, cell: GridCell) {
    const el = bodyRef.current?.querySelector<HTMLInputElement>(`input[data-row="${row}"][data-cell="${cell}"]`);
    if (!el) return;
    el.focus();
    if (el.type !== "number" || el.value !== "") el.select();
    el.scrollIntoView({ block: "nearest" });
  }

  function update(id: string, patch: Partial<LineItem>) {
    onChange(items.map((li) => (li.id === id ? { ...li, ...patch } : li)));
  }

  function resolveLine(line: LineItem, text: string): LineItem {
    const match = findCatalogItem(ctx, text);
    return match ? { ...line, ...lineFromItem(ctx, match, line) } : { ...line, item: text };
  }

  function lookup(id: string, text: string) {
    const line = items.find((li) => li.id === id);
    if (!line) return;
    const resolved = resolveLine(line, text);
    if (resolved !== line) onChange(items.map((li) => (li.id === id ? resolved : li)));
  }

  function addRowAfter(index: number) {
    const next = [...items];
    next.splice(index + 1, 0, emptyLineItem());
    pendingFocus.current = { row: index + 1, cell: "item" };
    onChange(next);
  }

  const complete = (li: LineItem) => Boolean(li.item.trim()) && li.ordered > 0;

  function onKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLInputElement;
    const cell = target.dataset.cell as GridCell | undefined;
    const row = Number(target.dataset.row);
    if (!cell || Number.isNaN(row)) return;
    e.preventDefault();
    e.stopPropagation();
    const line = items[row];
    if (!line) return;
    if (cell === "item") {
      // Resolve now (blur would, but the focus moves first) and go to the quantity.
      const resolved = resolveLine(line, target.value);
      if (resolved !== line) onChange(items.map((li) => (li.id === line.id ? resolved : li)));
      pendingFocus.current = { row, cell: "ordered" };
      if (resolved === line) focusCell(row, "ordered");
      return;
    }
    const lastCell: GridCell = pricesHidden ? "ordered" : "rate";
    if (cell === "ordered" && !pricesHidden) {
      focusCell(row, "rate");
      return;
    }
    if (cell === lastCell) {
      if (row < items.length - 1) {
        focusCell(row + 1, "item");
      } else if (complete(line)) {
        addRowAfter(row);
      }
      return;
    }
    // Any other cell: the next one in the row.
    const order: GridCell[] = ["item", "part", "desc", "um", "ordered", "rate"];
    const next = order[order.indexOf(cell) + 1];
    if (next) focusCell(row, next);
  }

  function onPaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    const parsed = parsePastedLines(text);
    // A single bare item pastes as text the normal way.
    if (parsed.length === 0 || (parsed.length === 1 && !/[\t,;]|\s\d+\s*$/.test(text.trim()))) return;
    e.preventDefault();
    const pasted = parsed.map((p) => resolveLine({ ...emptyLineItem(), ordered: p.qty }, p.item));
    const next = [...items];
    // The row pasted into takes the first line; the rest follow it, and a
    // blank row below is reused rather than left dangling.
    next.splice(index, 1, ...pasted);
    const after = next[index + pasted.length];
    if (after && !after.item.trim()) next.splice(index + pasted.length, 1);
    pendingFocus.current = { row: index + pasted.length - 1, cell: lastCellFor() };
    onChange(next);
  }

  const lastCellFor = (): GridCell => (pricesHidden ? "ordered" : "rate");

  function remove(id: string) {
    const next = items.filter((li) => li.id !== id);
    onChange(next.length > 0 ? next : [emptyLineItem()]);
  }

  return (
    <div className="line-items order-line-grid">
      <datalist id={LIST_ID}>
        {catalog.map((c) => (
          <option key={c.id} value={c.itemNumber}>
            {c.description}
          </option>
        ))}
      </datalist>
      <div className="scroll-window">
        <table className="data-table line-item-table">
          <thead>
            <tr>
              <th className="col-item">Item</th>
              <th className="col-cust-part">Customer Part #</th>
              <th className="col-desc">Description</th>
              <th className="col-um">U/M</th>
              <th className="col-qty">Ordered</th>
              <th className="col-qty">Avail. now</th>
              {!pricesHidden && <th className="col-rate">Rate</th>}
              {!pricesHidden && <th className="col-amount">Amount</th>}
              <th className="col-remove" />
            </tr>
          </thead>
          <tbody ref={bodyRef} onKeyDown={onKeyDown}>
            {items.map((li, index) => {
              const cat = byNumber.get(li.item.trim().toLowerCase());
              return (
                <OrderLineRow
                  key={li.id}
                  index={index}
                  line={li}
                  listId={LIST_ID}
                  pricesHidden={pricesHidden}
                  available={cat ? availableNow(cat) : undefined}
                  priceSource={cat ? priceSourceFor(ctx, li.item) : undefined}
                  resolved={Boolean(cat)}
                  onChange={(patch) => update(li.id, patch)}
                  onItemBlur={(text) => lookup(li.id, text)}
                  onPaste={(e) => onPaste(index, e)}
                  onRemove={() => remove(li.id)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid-help">
        <button type="button" className="secondary-btn" onClick={() => addRowAfter(items.length - 1)}>
          + Add Line Item
        </button>
        <span className="muted">Enter moves Item → Ordered → Rate, and from Rate to the next line. Paste "item, qty" lines into an Item cell to fill several rows.</span>
      </div>
    </div>
  );
}
