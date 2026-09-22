import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listItems, updateItem } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";
import type { Item } from "../types";
import { availableQty, qtyOnOpenSalesOrders } from "../types";

export default function Inventory() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>(() => listItems());
  const orders = useMemo(() => listOrders(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.itemNumber.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
    );
  }, [items, query]);

  function setQty(id: string, key: "qtyOnHand" | "qtyOnPurchaseOrder", value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const updated = { ...item, [key]: value };
    updateItem(updated);
    setItems((its) => its.map((i) => (i.id === id ? updated : i)));
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Inventory</h1>
        <p className="muted">
          Quantity on hand and on purchase order are tracked here directly - edit inline, or import a
          spreadsheet to update many items at once. Quantity on sales order is calculated automatically
          from open orders.
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
          <Link to="/import" className="secondary-btn">
            Import Inventory
          </Link>
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
              <th className="col-qty">On Purchase Order</th>
              <th className="col-qty">Available</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => {
              const onSalesOrder = qtyOnOpenSalesOrders(i.itemNumber, orders);
              const available = availableQty(i, onSalesOrder);
              return (
                <tr key={i.id}>
                  <td>{i.itemNumber}</td>
                  <td>{i.description}</td>
                  <td>{i.um}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      className="num-input"
                      value={i.qtyOnHand}
                      onChange={(e) => setQty(i.id, "qtyOnHand", Number(e.target.value))}
                    />
                  </td>
                  <td className="amount-cell">{onSalesOrder}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      className="num-input"
                      value={i.qtyOnPurchaseOrder}
                      onChange={(e) => setQty(i.id, "qtyOnPurchaseOrder", Number(e.target.value))}
                    />
                  </td>
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
