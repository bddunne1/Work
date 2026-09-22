import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getItem, saveItem, updateItem } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";
import type { Item } from "../types";
import { availableQty, emptyItem, qtyOnOpenSalesOrders } from "../types";

export default function ItemForm() {
  const { id } = useParams<{ id: string }>();
  // Keyed so navigating directly between "new" and two different items'
  // edit pages remounts fresh instead of reusing another record's form state.
  return <ItemFormInner key={id ?? "new"} />;
}

function ItemFormInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditing = Boolean(id);
  const [item, setItem] = useState<Item>(() => {
    if (id) {
      const existing = getItem(id);
      if (existing) return existing;
    }
    return emptyItem();
  });
  const onSalesOrder = isEditing ? qtyOnOpenSalesOrders(item.itemNumber, listOrders()) : 0;

  function set<K extends keyof Item>(key: K, value: Item[K]) {
    setItem((i) => ({ ...i, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEditing) {
      updateItem(item);
    } else {
      saveItem(item);
    }
    navigate("/items");
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{isEditing ? "Edit Item" : "New Item"}</h1>
        <p className="muted">Typing this item # on an order will auto-fill description and U/M.</p>
      </div>

      <form className="sales-order narrow-form" onSubmit={handleSubmit}>
        <label className="form-field">
          Item #
          <input value={item.itemNumber} onChange={(e) => set("itemNumber", e.target.value)} required />
        </label>
        <label className="form-field">
          Description
          <input value={item.description} onChange={(e) => set("description", e.target.value)} required />
        </label>
        <div className="form-row">
          <label className="form-field">
            U/M
            <input value={item.um} onChange={(e) => set("um", e.target.value)} />
          </label>
          <label className="form-field">
            Rate
            <input
              type="number"
              step="0.01"
              value={item.rate}
              onChange={(e) => set("rate", Number(e.target.value))}
            />
          </label>
        </div>

        <div className="form-row">
          <label className="form-field">
            Qty On Hand
            <input
              type="number"
              value={item.qtyOnHand}
              onChange={(e) => set("qtyOnHand", Number(e.target.value))}
            />
          </label>
          <label className="form-field">
            Qty On Purchase Order
            <input
              type="number"
              value={item.qtyOnPurchaseOrder}
              onChange={(e) => set("qtyOnPurchaseOrder", Number(e.target.value))}
            />
          </label>
        </div>

        {isEditing && (
          <p className="muted">
            {onSalesOrder} on open sales orders · {availableQty(item, onSalesOrder)} available to promise.
          </p>
        )}

        <div className="button-row">
          <button type="submit" className="primary-btn">
            Save Item
          </button>
          <button type="button" className="secondary-btn" onClick={() => navigate("/items")}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
