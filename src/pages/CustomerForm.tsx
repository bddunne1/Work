import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AddressFields from "../components/AddressFields";
import { getCustomer, saveCustomer, updateCustomer } from "../lib/customerStore";
import type { Customer } from "../types";
import { emptyCustomer } from "../types";

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
  const [sameAsBillTo, setSameAsBillTo] = useState(false);

  function set<K extends keyof Customer>(key: K, value: Customer[K]) {
    setCustomer((c) => ({ ...c, [key]: value }));
  }

  function handleBillToChange(addr: Customer["billTo"]) {
    setCustomer((c) => ({
      ...c,
      billTo: addr,
      shipTo: sameAsBillTo ? { ...addr, notes: c.shipTo.notes } : c.shipTo,
    }));
  }

  function toggleSameAsBillTo(checked: boolean) {
    setSameAsBillTo(checked);
    if (checked) {
      setCustomer((c) => ({ ...c, shipTo: { ...c.billTo, notes: c.shipTo.notes } }));
    }
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
          Saved preferences auto-fill billing, shipping, terms, and ship via on new orders.
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

        <div className="so-addresses">
          <AddressFields label="Bill To" value={customer.billTo} onChange={handleBillToChange} />
          <div>
            <AddressFields
              label="Ship To"
              value={customer.shipTo}
              onChange={(addr) => set("shipTo", addr)}
              showNotes
            />
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={sameAsBillTo}
                onChange={(e) => toggleSameAsBillTo(e.target.checked)}
              />
              Same as Bill To
            </label>
          </div>
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
