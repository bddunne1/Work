import { useState } from "react";
import { useNavigate } from "react-router-dom";
import SearchSelect from "../components/SearchSelect";
import { saveItem } from "../lib/itemStore";
import { listVendors } from "../lib/vendorStore";
import type { Item, Vendor } from "../types";
import { emptyItem } from "../types";

export default function ItemForm() {
  const navigate = useNavigate();
  const [item, setItem] = useState<Item>(() => emptyItem());
  const [vendors] = useState<Vendor[]>(() => listVendors());
  const [vendorQuery, setVendorQuery] = useState("");

  function set<K extends keyof Item>(key: K, value: Item[K]) {
    setItem((i) => ({ ...i, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    saveItem(item);
    navigate(`/items/${item.id}`);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>New Item</h1>
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
            Initial Qty On Hand
            <input
              type="number"
              min={0}
              value={item.qtyOnHand}
              onChange={(e) => set("qtyOnHand", Number(e.target.value))}
            />
          </label>
          <label className="form-field">
            Weight (lbs)
            <input
              type="number"
              min={0}
              step="0.01"
              value={item.weight ?? ""}
              placeholder="For warehouse capacity tracking"
              onChange={(e) => set("weight", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </label>
        </div>

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

        <p className="muted">
          Components, reference links, and notes can be added once the item is saved, from its profile
          page.
        </p>

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
