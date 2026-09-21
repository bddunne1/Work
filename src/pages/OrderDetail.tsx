import { Link, useNavigate, useParams } from "react-router-dom";
import LineItemsTable from "../components/LineItemsTable";
import { getOrder } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { orderSubtotal, orderTax, orderTotal } from "../types";

function itemLabel(order: PurchaseOrder, lineItemId: string): string {
  const li = order.lineItems.find((l) => l.id === lineItemId);
  return li ? li.item : lineItemId;
}

export default function OrderDetail() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const order = soNumber ? getOrder(soNumber) : undefined;

  if (!order) {
    return (
      <div className="page">
        <p>Order not found.</p>
        <Link to="/storage">&larr; Back to Storage</Link>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <button className="link-btn" onClick={() => navigate("/storage")}>
          &larr; Back to Storage
        </button>
        <button className="secondary-btn print-btn" onClick={() => window.print()}>
          Print / Preview
        </button>
      </div>

      <div className="sales-order">
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
                  <td>{order.orderDate}</td>
                  <td>{order.dueDate}</td>
                  <td>{order.estimatedShipDate || "—"}</td>
                  <td className="so-number-view">{order.soNumber}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="so-addresses">
          <fieldset className="address-box">
            <legend>Bill To</legend>
            <div>{order.billTo.name}</div>
            <div>{order.billTo.addressLine1}</div>
            {order.billTo.addressLine2 && <div>{order.billTo.addressLine2}</div>}
            <div>
              {order.billTo.city}, {order.billTo.state} {order.billTo.zip}
            </div>
          </fieldset>
          <fieldset className="address-box">
            <legend>Ship To</legend>
            <div>{order.shipTo.name}</div>
            <div>{order.shipTo.addressLine1}</div>
            {order.shipTo.addressLine2 && <div>{order.shipTo.addressLine2}</div>}
            <div>
              {order.shipTo.city}, {order.shipTo.state} {order.shipTo.zip}
            </div>
            {order.shipTo.notes && (
              <div className="address-notes-view">
                <span className="muted">Shipping notes:</span> {order.shipTo.notes}
              </div>
            )}
          </fieldset>
        </div>

        <table className="meta-table order-details-table">
          <thead>
            <tr>
              <th>P.O. No.</th>
              <th>Terms</th>
              <th>Rep</th>
              <th>FOB</th>
              <th>Ship Via</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{order.poNumber}</td>
              <td>{order.terms}</td>
              <td>{order.rep}</td>
              <td>{order.fob}</td>
              <td>{order.shipVia}</td>
              <td>
                <span className="status-pill">{order.status}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <LineItemsTable items={order.lineItems} onChange={() => {}} readOnly />

        {order.shipmentHistory && order.shipmentHistory.length > 0 && (
          <div className="shipment-history">
            <div className="so-notes-label muted">Shipment History</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Lines Shipped</th>
                </tr>
              </thead>
              <tbody>
                {order.shipmentHistory.map((rec) => (
                  <tr key={rec.id}>
                    <td>{new Date(rec.shippedAt).toLocaleString()}</td>
                    <td>
                      {rec.lines.map((l) => `${itemLabel(order, l.lineItemId)} × ${l.qty}`).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="so-footer">
          <div className="so-notes">
            <div className="so-notes-label muted">Notes</div>
            <div className="so-notes-text">{order.notes || "—"}</div>
          </div>
          <table className="totals-table">
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td>${orderSubtotal(order).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Sales Tax ({order.taxRate}%)</td>
                <td>${orderTax(order).toFixed(2)}</td>
              </tr>
              <tr className="total-row">
                <td>Total</td>
                <td>${orderTotal(order).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
