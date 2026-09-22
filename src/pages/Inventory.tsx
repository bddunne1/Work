import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCanEdit } from "../lib/authContext";
import { listItems } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";
import type { Item } from "../types";
import { availableQty, qtyAllocatedOnOrders, qtyOnOpenSalesOrders } from "../types";

export default function Inventory() {
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [items] = useState<Item[]>(() => listItems());
  const orders = useMemo(() => listOrders(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.itemNumber.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
    );
  }, [items, query]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Inventory</h1>
        <p className="muted">
          On hand and on purchase order are reference figures here - adjust on hand from the dedicated
          screen, or import a spreadsheet to update many items at once. On purchase order will
          auto-populate once outbound POs are tracked. On Sales Order is every unit still owed on an
          order regardless of stage; Allocated is only what's actually reserved (allocated or packed but
          not yet shipped) - Available is On Hand minus Allocated.
        </p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by item # or description..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="inline-actions">
          {canEdit && (
            <>
              <Link to="/inventory/adjust" className="primary-btn">
                Adjust Inventory
              </Link>
              <Link to="/import" className="secondary-btn">
                Import Inventory
              </Link>
            </>
          )}
          <Link to="/items" className="secondary-btn">
            Item Catalog
          </Link>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="muted">No items found.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Item #</th>
              <th>Description</th>
              <th>U/M</th>
              <th className="col-qty">On Hand</th>
              <th className="col-qty">On Sales Order</th>
              <th className="col-qty">Allocated</th>
              <th className="col-qty">On Purchase Order</th>
              <th className="col-qty">Available</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => {
              const onSalesOrder = qtyOnOpenSalesOrders(i.itemNumber, orders);
              const allocated = qtyAllocatedOnOrders(i.itemNumber, orders);
              const available = availableQty(i, allocated);
              return (
                <tr key={i.id}>
                  <td>{i.itemNumber}</td>
                  <td>{i.description}</td>
                  <td>{i.um}</td>
                  <td className="amount-cell">{i.qtyOnHand}</td>
                  <td className="amount-cell">{onSalesOrder}</td>
                  <td className="amount-cell">{allocated}</td>
                  <td className="amount-cell">{i.qtyOnPurchaseOrder}</td>
                  <td className={`amount-cell ${available < 0 ? "qty-negative" : ""}`}>{available}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
