import { useEffect, useState } from "react";
import AddressFields from "./AddressFields";
import { listItems } from "../lib/itemStore";
import type { Customer, CustomerPartMapping, Item, ShippingLocation } from "../types";
import { emptyShippingLocation } from "../types";

const ITEM_DATALIST_ID = "customer-editor-item-options";

interface Props {
  customer: Customer;
  onChange: (customer: Customer) => void;
  readOnly?: boolean;
}

export default function CustomerEditor({ customer, onChange, readOnly }: Props) {
  const [catalog, setCatalog] = useState<Item[]>([]);

  useEffect(() => {
    listItems().then(setCatalog);
  }, []);

  function set<K extends keyof Customer>(key: K, value: Customer[K]) {
    onChange({ ...customer, [key]: value });
  }

  function addPartMapping() {
    const mapping: CustomerPartMapping = { id: crypto.randomUUID(), itemNumber: "", customerPartNumber: "" };
    onChange({ ...customer, partNumberMap: [...(customer.partNumberMap ?? []), mapping] });
  }

  function updatePartMapping(id: string, patch: Partial<CustomerPartMapping>) {
    onChange({
      ...customer,
      partNumberMap: (customer.partNumberMap ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  }

  function applyPartMappingItemLookup(id: string, itemNumber: string) {
    const q = itemNumber.trim().toLowerCase();
    const match = catalog.find((c) => c.itemNumber.trim().toLowerCase() === q);
    if (!match) return;
    updatePartMapping(id, { itemNumber: match.itemNumber });
  }

  function removePartMapping(id: string) {
    onChange({ ...customer, partNumberMap: (customer.partNumberMap ?? []).filter((m) => m.id !== id) });
  }

  function updateLocation(locId: string, patch: Partial<ShippingLocation>) {
    onChange({
      ...customer,
      shipToLocations: customer.shipToLocations.map((loc) =>
        loc.id === locId ? { ...loc, ...patch } : loc
      ),
    });
  }

  function addLocation() {
    onChange({ ...customer, shipToLocations: [...customer.shipToLocations, emptyShippingLocation()] });
  }

  function removeLocation(locId: string) {
    onChange({
      ...customer,
      shipToLocations: customer.shipToLocations.filter((loc) => loc.id !== locId),
    });
  }

  function copyBillToAddress(locId: string) {
    const current = customer.shipToLocations.find((loc) => loc.id === locId);
    onChange({
      ...customer,
      shipToLocations: customer.shipToLocations.map((loc) =>
        loc.id === locId ? { ...loc, address: { ...customer.billTo, notes: current?.address.notes } } : loc
      ),
    });
  }

  return (
    <>
      <table className="meta-table customer-details-table">
        <thead>
          <tr>
            <th>Customer Name</th>
            <th>Account #</th>
            <th>Terms</th>
            <th>Rep</th>
            <th>FOB</th>
            <th>Ship Via</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <input
                value={customer.name}
                disabled={readOnly}
                onChange={(e) => set("name", e.target.value)}
                required
              />
            </td>
            <td>
              <input
                value={customer.accountNumber}
                disabled={readOnly}
                onChange={(e) => set("accountNumber", e.target.value)}
              />
            </td>
            <td>
              <input value={customer.terms} disabled={readOnly} onChange={(e) => set("terms", e.target.value)} />
            </td>
            <td>
              <input value={customer.rep} disabled={readOnly} onChange={(e) => set("rep", e.target.value)} />
            </td>
            <td>
              <input value={customer.fob} disabled={readOnly} onChange={(e) => set("fob", e.target.value)} />
            </td>
            <td>
              <input
                value={customer.shipVia}
                disabled={readOnly}
                onChange={(e) => set("shipVia", e.target.value)}
              />
            </td>
          </tr>
        </tbody>
      </table>

      <AddressFields
        label="Bill To"
        value={customer.billTo}
        onChange={(addr) => set("billTo", addr)}
        readOnly={readOnly}
      />

      <label className="checkbox-line shipcomplete-toggle">
        <input
          type="checkbox"
          checked={customer.shipCompleteOnly}
          disabled={readOnly}
          onChange={(e) => set("shipCompleteOnly", e.target.checked)}
        />
        Ship-complete only — hold the whole order if it can't be fully allocated (no partial shipments)
      </label>

      <label className="form-field">
        Private Label Brand Name (optional)
        <input
          placeholder="Leave blank to use our own brand on product labels"
          value={customer.privateLabelName ?? ""}
          disabled={readOnly}
          onChange={(e) => set("privateLabelName", e.target.value || undefined)}
        />
      </label>

      <div className="ship-locations">
        <div className="ship-locations-header">
          <h3>Shipping Locations</h3>
          {!readOnly && (
            <button type="button" className="secondary-btn" onClick={addLocation}>
              + Add Shipping Location
            </button>
          )}
        </div>

        {customer.shipToLocations.map((loc, idx) => (
          <div key={loc.id} className="ship-location-card">
            <div className="ship-location-name">
              <input
                placeholder="Location name (e.g. Main Warehouse)"
                value={loc.label}
                disabled={readOnly}
                onChange={(e) => updateLocation(loc.id, { label: e.target.value })}
              />
              {!readOnly && (
                <div className="ship-location-actions">
                  <button type="button" className="row-action-outline" onClick={() => copyBillToAddress(loc.id)}>
                    Copy from Bill To
                  </button>
                  {customer.shipToLocations.length > 1 && (
                    <button
                      type="button"
                      className="row-action-outline danger-link"
                      onClick={() => removeLocation(loc.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
            <AddressFields
              label={`Ship To ${idx + 1}`}
              value={loc.address}
              onChange={(addr) => updateLocation(loc.id, { address: addr })}
              showNotes
              readOnly={readOnly}
            />
          </div>
        ))}
      </div>

      <div className="ship-locations customer-catalog-section">
        <div className="ship-locations-header">
          <h3>Customer Catalog</h3>
          {!readOnly && (
            <button type="button" className="secondary-btn" onClick={addPartMapping}>
              + Add Mapping
            </button>
          )}
        </div>
        <p className="muted">
          Map our item numbers to this customer's own part numbers, so Order Entry can auto-fill their part
          # once the item is selected on a line.
        </p>

        {(customer.partNumberMap ?? []).length === 0 ? (
          <p className="muted">No part number mappings yet.</p>
        ) : (
          <>
          <datalist id={ITEM_DATALIST_ID}>
            {catalog.map((c) => (
              <option key={c.id} value={c.itemNumber}>
                {c.description}
              </option>
            ))}
          </datalist>
          <table className="data-table">
            <thead>
              <tr>
                <th>Our Item #</th>
                <th>Customer Part #</th>
                {!readOnly && <th></th>}
              </tr>
            </thead>
            <tbody>
              {(customer.partNumberMap ?? []).map((m) => (
                <tr key={m.id}>
                  <td>
                    <input
                      value={m.itemNumber}
                      disabled={readOnly}
                      list={readOnly ? undefined : ITEM_DATALIST_ID}
                      onChange={(e) => updatePartMapping(m.id, { itemNumber: e.target.value })}
                      onBlur={(e) => applyPartMappingItemLookup(m.id, e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      value={m.customerPartNumber}
                      disabled={readOnly}
                      onChange={(e) => updatePartMapping(m.id, { customerPartNumber: e.target.value })}
                    />
                  </td>
                  {!readOnly && (
                    <td>
                      <button
                        type="button"
                        className="row-action-outline danger-link"
                        onClick={() => removePartMapping(m.id)}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>
    </>
  );
}
