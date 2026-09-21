import { Link, useNavigate, useParams } from "react-router-dom";
import LineItemsTable from "../components/LineItemsTable";
import { getOrder } from "../lib/orderStore";
import { orderSubtotal, orderTax, orderTotal } from "../types";

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
      <div className="page-header">
        <button className="link-btn" onClick={() => navigate("/storage")}>
          &larr; Back to Storage
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
                  <th>S.O. No.</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{order.orderDate}</td>
                  <td>{order.dueDate}</td>
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

        <div className="so-footer">
          <div className="so-notes">
            <div className="muted">{order.notes}</div>
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
