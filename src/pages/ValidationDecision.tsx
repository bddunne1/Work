import { Link, useNavigate, useParams } from "react-router-dom";
import LineItemsTable from "../components/LineItemsTable";
import { getOrder, updateOrder } from "../lib/orderStore";
import { orderTotal } from "../types";

export default function ValidationDecision() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const order = soNumber ? getOrder(soNumber) : undefined;

  if (!order) {
    return (
      <div className="page">
        <p>Order not found.</p>
        <Link to="/validation">&larr; Back to Validation</Link>
      </div>
    );
  }

  function markChecked() {
    if (!order) return;
    updateOrder({ ...order, status: "Checked", checkedAt: new Date().toISOString() });
    navigate("/validation");
  }

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/validation" className="link-btn">
          &larr; Back to Validation
        </Link>
        <h1>Review S.O. #{order.soNumber}</h1>
        <p className="muted">
          P.O. #{order.poNumber || "—"} · {order.billTo.name} · ${orderTotal(order).toFixed(2)}
        </p>
      </div>

      <div className="sales-order validation-panel">
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
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{order.poNumber}</td>
              <td>{order.terms}</td>
              <td>{order.rep}</td>
              <td>{order.fob}</td>
              <td>{order.shipVia}</td>
            </tr>
          </tbody>
        </table>

        <LineItemsTable items={order.lineItems} onChange={() => {}} readOnly />

        <div className="decision-outcome outcome-success">
          <div className="decision-outcome-label">Looks good?</div>
          <div className="decision-outcome-detail">
            Marking this checked sends it to Allocation to confirm stock and release it for picking.
          </div>
          <button type="button" className="primary-btn" onClick={markChecked}>
            Mark as Checked
          </button>
        </div>
      </div>
    </div>
  );
}
