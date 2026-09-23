import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import SearchSelect from "../components/SearchSelect";
import { useCanEdit } from "../lib/authContext";
import { deleteItem, getItem, updateItem } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";
import { listVendors } from "../lib/vendorStore";
import type { Item, ItemComponent, ItemLink, Vendor } from "../types";
import { availableQty, qtyAllocatedOnOrders, qtyOnOpenSalesOrders } from "../types";

export default function ItemProfile() {
  const { id } = useParams<{ id: string }>();
  // Keyed so navigating directly between two items' profiles remounts
  // fresh instead of reusing another item's local edit state.
  return <ItemProfileInner key={id} />;
}

function ItemProfileInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [item, setItem] = useState<Item | undefined>(() => (id ? getItem(id) : undefined));
  const [vendors] = useState<Vendor[]>(() => listVendors());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Item | undefined>(undefined);
  const [vendorQuery, setVendorQuery] = useState("");

  if (!item) {
    return (
      <div className="page">
        <p>Item not found.</p>
        <Link to="/items">&larr; Back to Item Catalog</Link>
      </div>
    );
  }

  const allOrders = listOrders();
  const view = editing && draft ? draft : item;
  const onSalesOrder = qtyOnOpenSalesOrders(item.itemNumber, allOrders);
  const allocated = qtyAllocatedOnOrders(item.itemNumber, allOrders);
  const preferredVendor = vendors.find((v) => v.id === view.preferredVendorId);

  function startEdit() {
    setDraft(item);
    setVendorQuery(preferredVendor?.name ?? "");
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(undefined);
    setEditing(false);
  }

  function set<K extends keyof Item>(key: K, value: Item[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function saveEdit() {
    if (!draft) return;
    updateItem(draft);
    setItem(draft);
    setDraft(undefined);
    setEditing(false);
  }

  function handleDelete() {
    if (!confirm(`Delete item "${item!.itemNumber}"? This can't be undone.`)) return;
    deleteItem(item!.id);
    navigate("/items");
  }

  function addComponent() {
    const component: ItemComponent = { id: crypto.randomUUID(), partNumber: "", description: "" };
    setDraft((d) => (d ? { ...d, components: [...(d.components ?? []), component] } : d));
  }

  function updateComponent(componentId: string, patch: Partial<ItemComponent>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            components: (d.components ?? []).map((c) => (c.id === componentId ? { ...c, ...patch } : c)),
          }
        : d
    );
  }

  function removeComponent(componentId: string) {
    setDraft((d) => (d ? { ...d, components: (d.components ?? []).filter((c) => c.id !== componentId) } : d));
  }

  function addLink() {
    const link: ItemLink = { id: crypto.randomUUID(), label: "", url: "" };
    setDraft((d) => (d ? { ...d, links: [...(d.links ?? []), link] } : d));
  }

  function updateLink(linkId: string, patch: Partial<ItemLink>) {
    setDraft((d) =>
      d ? { ...d, links: (d.links ?? []).map((l) => (l.id === linkId ? { ...l, ...patch } : l)) } : d
    );
  }

  function removeLink(linkId: string) {
    setDraft((d) => (d ? { ...d, links: (d.links ?? []).filter((l) => l.id !== linkId) } : d));
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <Link to="/items" className="link-btn">
          &larr; Back to Item Catalog
        </Link>
        <div className="inline-actions">
          {!editing && (
            <Link to={`/items/${item.id}/quick-report`} className="secondary-btn">
              Quick Report
            </Link>
          )}
          {canEdit && !editing && (
            <>
              <button type="button" className="secondary-btn" onClick={startEdit}>
                Edit Item
              </button>
              <button type="button" className="link-btn danger-link" onClick={handleDelete}>
                Delete
              </button>
            </>
          )}
          {editing && (
            <>
              <button type="button" className="primary-btn" onClick={saveEdit}>
                Save Changes
              </button>
              <button type="button" className="secondary-btn" onClick={cancelEdit}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      <div className="page-header">
        <h1>
          {editing ? (
            <input value={view.itemNumber} onChange={(e) => set("itemNumber", e.target.value)} required />
          ) : (
            view.itemNumber
          )}
        </h1>
        {editing ? (
          <input
            className="item-profile-description-input"
            value={view.description}
            onChange={(e) => set("description", e.target.value)}
            required
          />
        ) : (
          <p className="muted">{view.description}</p>
        )}
      </div>

      <div className="sales-order narrow-form">
        <div className="form-row">
          <label className="form-field">
            U/M
            {editing ? (
              <input value={view.um} onChange={(e) => set("um", e.target.value)} />
            ) : (
              <p>{view.um}</p>
            )}
          </label>
          <label className="form-field">
            Rate
            {editing ? (
              <input
                type="number"
                step="0.01"
                value={view.rate}
                onChange={(e) => set("rate", Number(e.target.value))}
              />
            ) : (
              <p>${view.rate.toFixed(2)}</p>
            )}
          </label>
        </div>

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
              <td>{view.qtyOnHand}</td>
              <td>{onSalesOrder}</td>
              <td>{allocated}</td>
              <td>{view.qtyOnPurchaseOrder}</td>
              <td>{availableQty(view, allocated)}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          To change on hand, use <Link to="/inventory/adjust">Adjust Inventory</Link>. On purchase order
          is calculated automatically from open <Link to="/purchase-orders">purchase orders</Link>.
        </p>

        <h3 className="item-profile-heading">Item Profile</h3>

        {editing ? (
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
        ) : (
          <p>
            <strong>Preferred Vendor:</strong> {preferredVendor?.name ?? "—"}
          </p>
        )}

        <div className="form-row">
          <label className="form-field">
            Reorder Point
            {editing ? (
              <input
                type="number"
                min={0}
                value={view.reorderPoint ?? ""}
                onChange={(e) =>
                  set("reorderPoint", e.target.value === "" ? undefined : Number(e.target.value))
                }
              />
            ) : (
              <p>{view.reorderPoint ?? "—"}</p>
            )}
          </label>
          <label className="form-field">
            Country of Origin
            {editing ? (
              <input
                value={view.countryOfOrigin ?? ""}
                onChange={(e) => set("countryOfOrigin", e.target.value)}
              />
            ) : (
              <p>{view.countryOfOrigin ?? "—"}</p>
            )}
          </label>
          <label className="form-field">
            Weight (lbs)
            {editing ? (
              <input
                type="number"
                min={0}
                step="0.01"
                value={view.weight ?? ""}
                placeholder="For warehouse capacity tracking"
                onChange={(e) => set("weight", e.target.value === "" ? undefined : Number(e.target.value))}
              />
            ) : (
              <p>{view.weight !== undefined ? `${view.weight} lbs` : "—"}</p>
            )}
          </label>
        </div>

        <div className="ship-locations">
          <div className="ship-locations-header">
            <h3>Components</h3>
            {editing && (
              <button type="button" className="secondary-btn" onClick={addComponent}>
                + Add Component
              </button>
            )}
          </div>
          <p className="muted">Part numbers used to make this item - raw materials or sub-components.</p>
          {(view.components ?? []).length === 0 ? (
            <p className="muted">No components listed.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Part #</th>
                  <th>Description</th>
                  {editing && <th></th>}
                </tr>
              </thead>
              <tbody>
                {(view.components ?? []).map((c) =>
                  editing ? (
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
                          className="row-action-outline danger-link"
                          onClick={() => removeComponent(c.id)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={c.id}>
                      <td>{c.partNumber}</td>
                      <td>{c.description ?? "—"}</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="ship-locations">
          <div className="ship-locations-header">
            <h3>Reference Links</h3>
            {editing && (
              <button type="button" className="secondary-btn" onClick={addLink}>
                + Add Link
              </button>
            )}
          </div>
          <p className="muted">Spec sheets, SDS documents, vendor product pages, or anything else useful.</p>
          {(view.links ?? []).length === 0 ? (
            <p className="muted">No reference links.</p>
          ) : editing ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>URL</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(view.links ?? []).map((l) => (
                  <tr key={l.id}>
                    <td>
                      <input
                        placeholder="Spec Sheet"
                        value={l.label}
                        onChange={(e) => updateLink(l.id, { label: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        placeholder="https://..."
                        value={l.url}
                        onChange={(e) => updateLink(l.id, { url: e.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="row-action-outline danger-link"
                        onClick={() => removeLink(l.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <ul className="item-profile-links">
              {(view.links ?? []).map((l) => (
                <li key={l.id}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer">
                    {l.label || l.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="form-field">
          Notes
          {editing ? (
            <textarea
              rows={3}
              value={view.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Anything else worth knowing about this item..."
            />
          ) : (
            <p className="muted">{view.notes || "No notes."}</p>
          )}
        </label>
      </div>
    </div>
  );
}
