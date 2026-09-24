import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SearchSelect from "../components/SearchSelect";
import { adjustQtyOnHand, listItems } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";
import type { Item, PurchaseOrder } from "../types";
import { availableQty, qtyAllocatedOnOrders, qtyOnOpenSalesOrders } from "../types";

export default function InventoryAdjust() {
  const [items, setItems] = useState<Item[]>([]);
  const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);
  const [query, setQuery] = useState("");
  const [itemId, setItemId] = useState<string | undefined>();
  const [newQty, setNewQty] = useState(0);
  const [saved, setSaved] = useState<{ itemNumber: string; from: number; to: number } | null>(null);

  useEffect(() => {
    listItems().then(setItems);
    listOrders().then(setAllOrders);
  }, []);

  const selectedItem = items.find((i) => i.id === itemId);
  const onSalesOrder = selectedItem ? qtyOnOpenSalesOrders(selectedItem.itemNumber, allOrders) : 0;
  const allocated = selectedItem ? qtyAllocatedOnOrders(selectedItem.itemNumber, allOrders) : 0;

  function handleSelect(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setItemId(id);
    setQuery(`${item.itemNumber} — ${item.description}`);
    setNewQty(item.qtyOnHand);
    setSaved(null);
  }

  async function handleSave() {
    if (!selectedItem || !Number.isFinite(newQty) || newQty < 0) return;
    // A cycle-count correction is a delta against whatever qtyOnHand
    // actually is right now, not a whole-object PUT of a value fetched
    // possibly seconds ago - goes through the same atomic endpoint
    // shipping/receiving use, so it can't race a concurrent shipment or
    // receipt against this same item.
    await adjustQtyOnHand(selectedItem.itemNumber, newQty - selectedItem.qtyOnHand);
    const updated = { ...selectedItem, qtyOnHand: newQty };
    setItems((its) => its.map((i) => (i.id === updated.id ? updated : i)));
    setSaved({ itemNumber: selectedItem.itemNumber, from: selectedItem.qtyOnHand, to: newQty });
  }

  function reset() {
    setItemId(undefined);
    setQuery("");
    setNewQty(0);
    setSaved(null);
  }

  const delta = selectedItem ? newQty - selectedItem.qtyOnHand : 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Adjust Inventory</h1>
        <p className="muted">
          Correct quantity on hand after a cycle count, damage, or found stock. Look up an item, enter its
          new on-hand quantity, and save.
        </p>
      </div>

      <div className="import-panel">
        <div className="customer-picker">
          <label htmlFor="adjust-item-search">Item</label>
          <SearchSelect
            id="adjust-item-search"
            options={items.map((i) => ({ id: i.id, label: i.itemNumber, sublabel: i.description }))}
            value={query}
            onQueryChange={setQuery}
            onSelect={handleSelect}
            placeholder="Search by item # or description..."
          />
        </div>

        {selectedItem && (
          <>
            <table className="meta-table order-details-table">
              <thead>
                <tr>
                  <th>Current On Hand</th>
                  <th>On Sales Order</th>
                  <th>Allocated</th>
                  <th>Available</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{selectedItem.qtyOnHand}</td>
                  <td>{onSalesOrder}</td>
                  <td>{allocated}</td>
                  <td>{availableQty(selectedItem, allocated)}</td>
                </tr>
              </tbody>
            </table>

            <label className="form-field">
              New Quantity On Hand
              <input
                type="number"
                min={0}
                value={newQty}
                onChange={(e) => setNewQty(Number(e.target.value))}
              />
            </label>
            {delta !== 0 && (
              <p className="muted">
                {delta > 0 ? `+${delta}` : delta} from current on hand.
              </p>
            )}

            <div className="button-row">
              <button type="button" className="primary-btn" onClick={handleSave}>
                Save Adjustment
              </button>
              <button type="button" className="secondary-btn" onClick={reset}>
                Adjust Another Item
              </button>
            </div>
          </>
        )}

        {saved && (
          <div className="decision-outcome outcome-success">
            <div className="decision-outcome-label">Adjustment saved</div>
            <div className="decision-outcome-detail">
              {saved.itemNumber}: {saved.from} &rarr; {saved.to}
            </div>
          </div>
        )}
      </div>

      <p>
        <Link to="/inventory">&larr; Back to Inventory</Link>
      </p>
    </div>
  );
}
