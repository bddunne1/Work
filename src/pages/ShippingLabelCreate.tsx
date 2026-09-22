import { useState } from "react";
import { Link } from "react-router-dom";
import AddressFields from "../components/AddressFields";
import SearchSelect from "../components/SearchSelect";
import { listCustomers } from "../lib/customerStore";
import type { Address, Customer } from "../types";
import { emptyAddress } from "../types";

export default function ShippingLabelCreate() {
  const [customers] = useState<Customer[]>(() => listCustomers());
  const [manual, setManual] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [locationId, setLocationId] = useState<string | undefined>();
  const [shipTo, setShipTo] = useState<Address>(emptyAddress());
  const [soNumber, setSoNumber] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [shipVia, setShipVia] = useState("");

  const selectedCustomer = customers.find((c) => c.id === customerId);

  function handleSelectCustomer(id: string) {
    const customer = customers.find((c) => c.id === id);
    if (!customer) return;
    setCustomerId(id);
    setCustomerQuery(customer.name);
    setShipVia(customer.shipVia);
    const defaultLocation = customer.shipToLocations[0];
    setLocationId(defaultLocation?.id);
    setShipTo(defaultLocation ? { ...defaultLocation.address } : emptyAddress());
  }

  function handleSelectLocation(locId: string) {
    const location = selectedCustomer?.shipToLocations.find((l) => l.id === locId);
    if (!location) return;
    setLocationId(locId);
    setShipTo({ ...location.address });
  }

  function toggleManual(next: boolean) {
    setManual(next);
    if (next) {
      setCustomerId(undefined);
      setCustomerQuery("");
      setLocationId(undefined);
      setShipTo(emptyAddress());
    }
  }

  const hasAddress = shipTo.name.trim() && shipTo.addressLine1.trim();

  return (
    <div className="page">
      <div className="page-header no-print">
        <Link to="/labels" className="link-btn">
          &larr; Back to Create Labels
        </Link>
        <h1>Shipping Label</h1>
        <button type="button" className="secondary-btn print-btn" onClick={() => window.print()} disabled={!hasAddress}>
          Print Label
        </button>
      </div>

      <div className="sales-order no-print">
        <label className="checkbox-line">
          <input type="checkbox" checked={manual} onChange={(e) => toggleManual(e.target.checked)} />
          Enter address manually instead of using a saved customer &amp; location
        </label>

        {!manual && (
          <>
            <div className="customer-picker">
              <label htmlFor="label-customer-search">Customer</label>
              <SearchSelect
                id="label-customer-search"
                options={customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.accountNumber }))}
                value={customerQuery}
                onQueryChange={setCustomerQuery}
                onSelect={handleSelectCustomer}
                placeholder="Search customers by name or account #..."
              />
            </div>

            {selectedCustomer && selectedCustomer.shipToLocations.length > 0 && (
              <div className="customer-picker">
                <label htmlFor="label-location-select">Ship To Location</label>
                <select
                  id="label-location-select"
                  className="ship-location-select"
                  value={locationId ?? ""}
                  onChange={(e) => handleSelectLocation(e.target.value)}
                >
                  {selectedCustomer.shipToLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.label || "Unnamed location"}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        <AddressFields label="Ship To" value={shipTo} onChange={setShipTo} showNotes />

        <table className="meta-table order-details-table">
          <thead>
            <tr>
              <th>S.O. # (optional)</th>
              <th>P.O. # (optional)</th>
              <th>Ship Via (optional)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input value={soNumber} onChange={(e) => setSoNumber(e.target.value)} />
              </td>
              <td>
                <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
              </td>
              <td>
                <input value={shipVia} onChange={(e) => setShipVia(e.target.value)} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="shipping-label print-only">
        <div className="label-from">
          <span className="muted">From</span>
          Aamstrand Ropes &amp; Twines · 711 N Grove St, Manteno, IL 60950
        </div>

        <div className="label-to">
          <span className="muted">Ship To</span>
          <div className="label-to-name">{shipTo.name}</div>
          <div className="label-to-line">{shipTo.addressLine1}</div>
          {shipTo.addressLine2 && <div className="label-to-line">{shipTo.addressLine2}</div>}
          <div className="label-to-line">
            {shipTo.city}, {shipTo.state} {shipTo.zip}
          </div>
        </div>

        <div className="label-meta">
          <div>
            <span className="muted">S.O. #</span>
            <div className="label-meta-value">{soNumber || "—"}</div>
          </div>
          <div>
            <span className="muted">P.O. #</span>
            <div className="label-meta-value">{poNumber || "—"}</div>
          </div>
          <div>
            <span className="muted">Ship Via</span>
            <div className="label-meta-value">{shipVia || "—"}</div>
          </div>
        </div>

        {shipTo.notes && (
          <div className="label-notes">
            <span className="muted">Notes</span> {shipTo.notes}
          </div>
        )}
      </div>
    </div>
  );
}
