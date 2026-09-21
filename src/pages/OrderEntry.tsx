import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AddressFields from "../components/AddressFields";
import LineItemsTable from "../components/LineItemsTable";
import { nextSalesOrderNumber, saveOrder } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
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

  function set<K extends keyof PurchaseOrder>(key: K, value: PurchaseOrder[K]) {
    setOrder((o) => ({ ...o, [key]: value }));
  }

  function handleBillToChange(addr: PurchaseOrder["billTo"]) {
    setOrder((o) => ({
      ...o,
      billTo: addr,
      shipTo: sameAsBillTo ? addr : o.shipTo,
    }));
  }

  function toggleSameAsBillTo(checked: boolean) {
    setSameAsBillTo(checked);
    if (checked) {
      setOrder((o) => ({ ...o, shipTo: o.billTo }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    saveOrder(order);
    setSaved(true);
  }

  function startNewOrder() {
    setOrder(blankOrder(nextSalesOrderNumber()));
    setSameAsBillTo(false);
    setSaved(false);
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
            <button className="secondary-btn" onClick={() => navigate("/storage")}>
              Go to Storage
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

        <LineItemsTable items={order.lineItems} onChange={(items) => set("lineItems", items)} />

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
