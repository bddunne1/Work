import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AddressFields from "../components/AddressFields";
import { getCustomer, saveCustomer, updateCustomer } from "../lib/customerStore";
import type { Customer, ShippingLocation } from "../types";
import { emptyCustomer, emptyShippingLocation } from "../types";

export default function CustomerForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditing = Boolean(id);
  const [customer, setCustomer] = useState<Customer>(() => {
    if (id) {
      const existing = getCustomer(id);
      if (existing) return existing;
    }
    return emptyCustomer();
  });

  function set<K extends keyof Customer>(key: K, value: Customer[K]) {
    setCustomer((c) => ({ ...c, [key]: value }));
  }

  function updateLocation(locId: string, patch: Partial<ShippingLocation>) {
    setCustomer((c) => ({
      ...c,
      shipToLocations: c.shipToLocations.map((loc) => (loc.id === locId ? { ...loc, ...patch } : loc)),
    }));
  }

  function addLocation() {
    setCustomer((c) => ({ ...c, shipToLocations: [...c.shipToLocations, emptyShippingLocation()] }));
  }

  function removeLocation(locId: string) {
    setCustomer((c) => ({
      ...c,
      shipToLocations: c.shipToLocations.filter((loc) => loc.id !== locId),
    }));
  }

  function copyBillToAddress(locId: string) {
    setCustomer((c) => {
      const current = c.shipToLocations.find((loc) => loc.id === locId);
      return {
        ...c,
        shipToLocations: c.shipToLocations.map((loc) =>
          loc.id === locId ? { ...loc, address: { ...c.billTo, notes: current?.address.notes } } : loc
        ),
      };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEditing) {
      updateCustomer(customer);
    } else {
      saveCustomer(customer);
    }
    navigate("/customers");
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{isEditing ? "Edit Customer" : "New Customer"}</h1>
        <p className="muted">
          Saved preferences auto-fill billing, terms, and ship via on new orders. Add multiple shipping
          locations if this customer receives at more than one address.
        </p>
      </div>

      <form className="sales-order" onSubmit={handleSubmit}>
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
                <input value={customer.name} onChange={(e) => set("name", e.target.value)} required />
              </td>
              <td>
                <input value={customer.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} />
              </td>
              <td>
                <input value={customer.terms} onChange={(e) => set("terms", e.target.value)} />
              </td>
              <td>
                <input value={customer.rep} onChange={(e) => set("rep", e.target.value)} />
              </td>
              <td>
                <input value={customer.fob} onChange={(e) => set("fob", e.target.value)} />
              </td>
              <td>
                <input value={customer.shipVia} onChange={(e) => set("shipVia", e.target.value)} />
              </td>
            </tr>
          </tbody>
        </table>

        <AddressFields label="Bill To" value={customer.billTo} onChange={(addr) => set("billTo", addr)} />

        <div className="ship-locations">
          <div className="ship-locations-header">
            <h3>Shipping Locations</h3>
            <button type="button" className="secondary-btn" onClick={addLocation}>
              + Add Shipping Location
            </button>
          </div>

          {customer.shipToLocations.map((loc, idx) => (
            <div key={loc.id} className="ship-location-card">
              <div className="ship-location-name">
                <input
                  placeholder={`Location name (e.g. Main Warehouse)`}
                  value={loc.label}
                  onChange={(e) => updateLocation(loc.id, { label: e.target.value })}
                />
                <div className="ship-location-actions">
                  <button type="button" className="link-btn" onClick={() => copyBillToAddress(loc.id)}>
                    Copy from Bill To
                  </button>
                  {customer.shipToLocations.length > 1 && (
                    <button
                      type="button"
                      className="link-btn danger-link"
                      onClick={() => removeLocation(loc.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <AddressFields
                label={`Ship To ${idx + 1}`}
                value={loc.address}
                onChange={(addr) => updateLocation(loc.id, { address: addr })}
                showNotes
              />
            </div>
          ))}
        </div>

        <div className="button-row">
          <button type="submit" className="primary-btn">
            Save Customer
          </button>
          <button type="button" className="secondary-btn" onClick={() => navigate("/customers")}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
