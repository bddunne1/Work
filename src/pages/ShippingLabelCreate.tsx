import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AddressFields from "../components/AddressFields";
import SearchSelect from "../components/SearchSelect";
import { companyAddressLine, getCompanyInfo } from "../lib/companyStore";
import { listCustomers } from "../lib/customerStore";
import { listItems } from "../lib/itemStore";
import { getOrder } from "../lib/orderStore";
import type { Address, Customer } from "../types";
import { emptyAddress, orderWeight, pendingShipmentWeight, weightIndex } from "../types";

export default function ShippingLabelCreate() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    listCustomers().then(setCustomers);
  }, []);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [locationId, setLocationId] = useState<string | undefined>();
  const [shipTo, setShipTo] = useState<Address>(emptyAddress());
  const [soNumber, setSoNumber] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [shipVia, setShipVia] = useState("");
  const [proNumber, setProNumber] = useState("");
  const [weight, setWeight] = useState("");
  const [orderNote, setOrderNote] = useState("");

  // Typing an S.O. # fills the label from the order (G-07): ship-to, P.O.,
  // the carrier saved at the BOL step or Mark Shipped, its PRO, and the
  // weight of what is staged (or ordered) from the item weights.
  async function fillFromOrder() {
    const so = soNumber.trim();
    if (!so) return;
    const order = await getOrder(so).catch(() => undefined);
    if (!order) {
      setOrderNote(`No order #${so}.`);
      return;
    }
    setOrderNote("");
    setManual(true);
    setCustomerId(undefined);
    setLocationId(undefined);
    setShipTo({ ...order.shipTo });
    setPoNumber(order.poNumber);
    setShipVia(order.carrier || order.shipVia || "");
    setProNumber(order.proNumber ?? "");
    const weights = weightIndex(await listItems().catch(() => []));
    const lbs = (order.pendingShipment?.length ?? 0) > 0 ? pendingShipmentWeight(order, weights) : orderWeight(order, weights);
    setWeight(lbs > 0 ? String(Math.round(lbs)) : "");
  }

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const company = getCompanyInfo();

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
              <th>Carrier / Ship Via (optional)</th>
              <th>PRO # (optional)</th>
              <th>Weight, lbs (optional)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input value={soNumber} onChange={(e) => setSoNumber(e.target.value)} onBlur={fillFromOrder} onKeyDown={(e) => e.key === "Enter" && fillFromOrder()} placeholder="fills the label from the order" />
              </td>
              <td>
                <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
              </td>
              <td>
                <input value={shipVia} onChange={(e) => setShipVia(e.target.value)} />
              </td>
              <td>
                <input value={proNumber} onChange={(e) => setProNumber(e.target.value)} />
              </td>
              <td>
                <input type="number" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} />
              </td>
            </tr>
          </tbody>
        </table>
        {orderNote && <p className="muted">{orderNote}</p>}
      </div>

      <div className="shipping-label print-only">
        <div className="label-from">
          <span className="muted">From</span>
          {company.name} · {companyAddressLine(company)}
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
          {proNumber && (
            <div>
              <span className="muted">PRO #</span>
              <div className="label-meta-value">{proNumber}</div>
            </div>
          )}
          {weight && (
            <div>
              <span className="muted">Weight</span>
              <div className="label-meta-value">{weight} lbs</div>
            </div>
          )}
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
