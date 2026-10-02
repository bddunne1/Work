import type { ClipboardEvent } from "react";
import type { LineItem } from "../types";
import { lineAmount } from "../types";
import type { PriceSource } from "../lib/lineLookup";

// One line of the Order Entry grid (G-11). Cells carry data-row/data-cell
// so the grid can move focus by keyboard; the row itself only renders.
export type GridCell = "item" | "part" | "desc" | "um" | "ordered" | "rate";

interface Props {
  index: number;
  line: LineItem;
  listId: string;
  pricesHidden?: boolean;
  // From the catalog once the item resolved.
  available?: number;
  priceSource?: PriceSource;
  resolved: boolean;
  onChange: (patch: Partial<LineItem>) => void;
  onItemBlur: (text: string) => void;
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}

export default function OrderLineRow({ index, line, listId, pricesHidden, available, priceSource, resolved, onChange, onItemBlur, onPaste, onRemove }: Props) {
  const short = available !== undefined && line.ordered > available;
  return (
    <tr className={line.item.trim() && !resolved ? "line-unresolved" : undefined}>
      <td>
        <input
          value={line.item}
          list={listId}
          data-row={index}
          data-cell="item"
          aria-label={`Line ${index + 1} item`}
          onChange={(e) => onChange({ item: e.target.value })}
          onBlur={(e) => onItemBlur(e.target.value)}
          onPaste={onPaste}
          placeholder={index === 0 ? "Item # or customer part #" : undefined}
        />
      </td>
      <td>
        <input value={line.customerPartNumber ?? ""} data-row={index} data-cell="part" onChange={(e) => onChange({ customerPartNumber: e.target.value })} />
      </td>
      <td>
        <input value={line.description} data-row={index} data-cell="desc" onChange={(e) => onChange({ description: e.target.value })} />
      </td>
      <td>
        <input className="col-um-input" value={line.um} data-row={index} data-cell="um" onChange={(e) => onChange({ um: e.target.value })} />
      </td>
      <td>
        <input
          type="number"
          min={1}
          step={1}
          className={`num-input ${short ? "short" : ""}`}
          value={line.ordered}
          data-row={index}
          data-cell="ordered"
          aria-label={`Line ${index + 1} ordered`}
          onChange={(e) => onChange({ ordered: Number(e.target.value) })}
        />
      </td>
      <td className={`amount-cell avail-cell ${short ? "short" : ""}`} title="On hand less what other open orders hold">
        {available === undefined ? "—" : available}
      </td>
      {!pricesHidden && (
        <td className="rate-cell">
          <input type="number" step="0.01" className="num-input" value={line.rate} data-row={index} data-cell="rate" aria-label={`Line ${index + 1} rate`} onChange={(e) => onChange({ rate: Number(e.target.value) })} />
          {priceSource && <span className={`price-source price-source-${priceSource}`}>{priceSource === "sheet" ? "sheet" : "catalog"}</span>}
        </td>
      )}
      {!pricesHidden && <td className="amount-cell">${lineAmount(line).toFixed(2)}</td>}
      <td>
        <button type="button" className="icon-btn" onClick={onRemove} aria-label="Remove line" tabIndex={-1}>
          &times;
        </button>
      </td>
    </tr>
  );
}
