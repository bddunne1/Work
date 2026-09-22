import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AddressFields from "../components/AddressFields";
import LineItemsTable from "../components/LineItemsTable";
import SearchSelect from "../components/SearchSelect";
import { listCustomers } from "../lib/customerStore";
import { addBusinessDays } from "../lib/dateUtils";
import { nextSalesOrderNumber, saveOrder } from "../lib/orderStore";
import { getLeadTimeDays } from "../lib/settingsStore";
import type { Customer, PurchaseOrder } from "../types";
import { emptyAddress, emptyLineItem, orderSubtotal, orderTax, orderTotal } from "../types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function blankOrder(soNumber: string): PurchaseOrder {
  return {
    soNumber,
    poNumber: "",
    orderDate: today(),
    dueDate: today(),
    billTo: emptyAddress(),
    shipTo: emptyAddress(),
    fob: "",
    shipVia: "",
    terms: "",
    rep: "",
    taxRate: 0,
    notes: "Thank you for your order!",
    lineItems: [emptyLineItem()],
    status: "Entered",
    createdAt: new Date().toISOString(),
  };
}

export default function OrderEntry() {
  const navigate = useNavigate();
  const [order, setOrder] = useState<PurchaseOrder>(() => blankOrder(nextSalesOrderNumber()));
  const [sameAsBillTo, setSameAsBillTo] = useState(false);
  const [saved, setSaved] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>(() => listCustomers());
  const [customerQuery, setCustomerQuery] = useState("");

  function set<K extends keyof PurchaseOrder>(key: K, value: PurchaseOrder[K]) {
    setOrder((o) => ({ ...o, [key]: value }));
  }

  const selectedCustomer = customers.find((c) => c.id === order.customerId);

  function handleSelectCustomer(id: string) {
    const customer = customers.find((c) => c.id === id);
    if (!customer) return;
    setCustomerQuery(customer.name);
    setSameAsBillTo(false);
    const defaultLocation = customer.shipToLocations[0];
    setOrder((o) => ({
      ...o,
      customerId: customer.id,
      shipToLocationId: defaultLocation?.id,
      billTo: { ...customer.billTo },
      shipTo: defaultLocation ? { ...defaultLocation.address } : emptyAddress(),
      terms: customer.terms,
      shipVia: customer.shipVia,
      fob: customer.fob,
      rep: customer.rep,
    }));
  }

  function handleSelectShipLocation(locationId: string) {
    const location = selectedCustomer?.shipToLocations.find((loc) => loc.id === locationId);
    if (!location) return;
    setSameAsBillTo(false);
    setOrder((o) => ({ ...o, shipToLocationId: location.id, shipTo: { ...location.address } }));
  }

  function handleBillToChange(addr: PurchaseOrder["billTo"]) {
    setOrder((o) => ({
      ...o,
      billTo: addr,
      shipTo: sameAsBillTo ? { ...addr, notes: o.shipTo.notes } : o.shipTo,
      shipToLocationId: sameAsBillTo ? undefined : o.shipToLocationId,
    }));
  }

  function toggleSameAsBillTo(checked: boolean) {
    setSameAsBillTo(checked);
    if (checked) {
      setOrder((o) => ({ ...o, shipTo: { ...o.billTo, notes: o.shipTo.notes }, shipToLocationId: undefined }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const estimatedShipDate = addBusinessDays(order.orderDate, getLeadTimeDays());
    const finalOrder = { ...order, estimatedShipDate };
    saveOrder(finalOrder);
    setOrder(finalOrder);
    setSaved(true);
  }

  function startNewOrder() {
    setOrder(blankOrder(nextSalesOrderNumber()));
    setSameAsBillTo(false);
    setSaved(false);
    setCustomerQuery("");
    setCustomers(listCustomers());
  }

  if (saved) {
    return (
      <div className="page">
        <div className="confirm-box">
          <h2>Order S.O. #{order.soNumber} saved</h2>
          <p className="muted">PO #{order.poNumber || "—"} has been stored.</p>
          <div className="button-row">
            <button className="primary-btn" onClick={startNewOrder}>
              Enter Another Order
            </button>
            <button className="secondary-btn" onClick={() => navigate(`/storage/${order.soNumber}`)}>
              View Order
            </button>
            <button className="secondary-btn" onClick={() => navigate("/open-orders")}>
              Go to Open Orders
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Order Entry</h1>
        <p className="muted">Enter a customer purchase order to generate a new sales order.</p>
      </div>

      <form className="sales-order" onSubmit={handleSubmit}>
        <div className="customer-picker">
          <label htmlFor="customer-search">Customer</label>
          <SearchSelect
            id="customer-search"
            options={customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.accountNumber }))}
            value={customerQuery}
            onQueryChange={setCustomerQuery}
            onSelect={handleSelectCustomer}
            placeholder="Search customers by name or account #..."
          />
          <Link to="/customers/new" target="_blank" className="link-btn">
            + New Customer
          </Link>
        </div>

        {selectedCustomer && selectedCustomer.shipToLocations.length > 0 && (
          <div className="customer-picker">
            <label htmlFor="ship-location-select">Ship To Location</label>
            <select
              id="ship-location-select"
              className="ship-location-select"
              value={order.shipToLocationId ?? ""}
              onChange={(e) => handleSelectShipLocation(e.target.value)}
            >
              {selectedCustomer.shipToLocations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.label || "Unnamed location"}
                </option>
              ))}
            </select>
            <Link to={`/customers/all/${selectedCustomer.id}`} target="_blank" className="link-btn">
              + Add Location
            </Link>
          </div>
        )}

        <div className="so-header">
          <div className="so-company">
            <div className="so-company-name">Aamstrand Ropes &amp; Twines</div>
            <div className="muted">711 N Grove St, Manteno, IL 60950</div>
            <div className="muted">800-338-0557</div>
          </div>
          <div className="so-meta">
            <h2>Sales Order</h2>
            <table className="meta-table">
              <thead>
                <tr>
                  <th>Order Date</th>
                  <th>Due Date</th>
                  <th>Est. Ship</th>
                  <th>S.O. No.</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <input
                      type="date"
                      value={order.orderDate}
                      onChange={(e) => set("orderDate", e.target.value)}
                      required
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={order.dueDate}
                      onChange={(e) => set("dueDate", e.target.value)}
                    />
                  </td>
                  <td className="muted">
                    {order.orderDate ? addBusinessDays(order.orderDate, getLeadTimeDays()) : "—"}
                  </td>
                  <td>
                    <input value={order.soNumber} disabled className="so-number" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="so-addresses">
          <AddressFields label="Bill To" value={order.billTo} onChange={handleBillToChange} />
          <div>
            <AddressFields
              label="Ship To"
              value={order.shipTo}
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

        <table className="meta-table order-details-table">
          <thead>
            <tr>
              <th>P.O. No.</th>
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
                  value={order.poNumber}
                  onChange={(e) => set("poNumber", e.target.value)}
                  required
                />
              </td>
              <td>
                <input value={order.terms} onChange={(e) => set("terms", e.target.value)} />
              </td>
              <td>
                <input value={order.rep} onChange={(e) => set("rep", e.target.value)} />
              </td>
              <td>
                <input value={order.fob} onChange={(e) => set("fob", e.target.value)} />
              </td>
              <td>
                <input value={order.shipVia} onChange={(e) => set("shipVia", e.target.value)} />
              </td>
            </tr>
          </tbody>
        </table>

        <LineItemsTable
          items={order.lineItems}
          onChange={(items) => set("lineItems", items)}
          customerPartMap={selectedCustomer?.partNumberMap}
          customerPriceOverrides={selectedCustomer?.priceOverrides}
        />

        <div className="so-footer">
          <div className="so-notes">
            <label>
              Notes
              <textarea value={order.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
            </label>
          </div>
          <table className="totals-table">
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td>${orderSubtotal(order).toFixed(2)}</td>
              </tr>
              <tr>
                <td>
                  Sales Tax (
                  <input
                    type="number"
                    step="0.1"
                    className="tax-input"
                    value={order.taxRate}
                    onChange={(e) => set("taxRate", Number(e.target.value))}
                  />
                  %)
                </td>
                <td>${orderTax(order).toFixed(2)}</td>
              </tr>
              <tr className="total-row">
                <td>Total</td>
                <td>${orderTotal(order).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="button-row">
          <button type="submit" className="primary-btn">
            Save Order
          </button>
        </div>
      </form>
    </div>
  );
}
