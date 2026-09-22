import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import SearchSelect from "../components/SearchSelect";
import { getItem, saveItem, updateItem } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";
import { listVendors } from "../lib/vendorStore";
import type { Item, ItemComponent, Vendor } from "../types";
import { availableQty, emptyItem, qtyAllocatedOnOrders, qtyOnOpenSalesOrders } from "../types";

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
  const [vendors] = useState<Vendor[]>(() => listVendors());
  const [vendorQuery, setVendorQuery] = useState(() => {
    const preferred = vendors.find((v) => v.id === item.preferredVendorId);
    return preferred?.name ?? "";
  });
  const allOrders = isEditing ? listOrders() : [];
  const onSalesOrder = isEditing ? qtyOnOpenSalesOrders(item.itemNumber, allOrders) : 0;
  const allocated = isEditing ? qtyAllocatedOnOrders(item.itemNumber, allOrders) : 0;

  function set<K extends keyof Item>(key: K, value: Item[K]) {
    setItem((i) => ({ ...i, [key]: value }));
  }

  function addComponent() {
    const component: ItemComponent = { id: crypto.randomUUID(), partNumber: "", description: "" };
    setItem((i) => ({ ...i, components: [...(i.components ?? []), component] }));
  }

  function updateComponent(componentId: string, patch: Partial<ItemComponent>) {
    setItem((i) => ({
      ...i,
      components: (i.components ?? []).map((c) => (c.id === componentId ? { ...c, ...patch } : c)),
    }));
  }

  function removeComponent(componentId: string) {
    setItem((i) => ({ ...i, components: (i.components ?? []).filter((c) => c.id !== componentId) }));
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

        {isEditing ? (
          <>
            <table className="meta-table order-details-table">
              <thead>
                <tr>
                  <th>On Hand</th>
                  <th>On Sales Order</th>
                  <th>Allocated</th>
                  <th>On Purchase Order</th>
                  <th>Available</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{item.qtyOnHand}</td>
                  <td>{onSalesOrder}</td>
                  <td>{allocated}</td>
                  <td>{item.qtyOnPurchaseOrder}</td>
                  <td>{availableQty(item, allocated)}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted">
              To change on hand, use <Link to="/inventory/adjust">Adjust Inventory</Link>. On purchase
              order is calculated automatically from open{" "}
              <Link to="/purchase-orders">purchase orders</Link>.
            </p>
          </>
        ) : (
          <label className="form-field">
            Initial Qty On Hand
            <input
              type="number"
              min={0}
              value={item.qtyOnHand}
              onChange={(e) => set("qtyOnHand", Number(e.target.value))}
            />
          </label>
        )}

        <h3 className="item-profile-heading">Item Profile</h3>

        <div className="customer-picker">
          <label htmlFor="item-vendor-search">Preferred Vendor</label>
          <SearchSelect
            id="item-vendor-search"
            options={vendors.map((v) => ({ id: v.id, label: v.name, sublabel: v.contactName }))}
            value={vendorQuery}
            onQueryChange={setVendorQuery}
            onSelect={(vendorId) => set("preferredVendorId", vendorId)}
            placeholder="Search vendors..."
          />
        </div>

        <div className="form-row">
          <label className="form-field">
            Reorder Point
            <input
              type="number"
              min={0}
              value={item.reorderPoint ?? ""}
              onChange={(e) => set("reorderPoint", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </label>
          <label className="form-field">
            Country of Origin
            <input
              value={item.countryOfOrigin ?? ""}
              onChange={(e) => set("countryOfOrigin", e.target.value)}
            />
          </label>
        </div>

        <div className="ship-locations">
          <div className="ship-locations-header">
            <h3>Components</h3>
            <button type="button" className="secondary-btn" onClick={addComponent}>
              + Add Component
            </button>
          </div>
          <p className="muted">Part numbers used to make this item - raw materials or sub-components.</p>
          {(item.components ?? []).length === 0 ? (
            <p className="muted">No components listed.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Part #</th>
                  <th>Description</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(item.components ?? []).map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        value={c.partNumber}
                        onChange={(e) => updateComponent(c.id, { partNumber: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={c.description ?? ""}
                        onChange={(e) => updateComponent(c.id, { description: e.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="link-btn danger-link"
                        onClick={() => removeComponent(c.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

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
