import { Link, useNavigate, useParams } from "react-router-dom";
import { getOrder, updateOrder } from "../lib/orderStore";

export default function ShippingLabel() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const order = soNumber ? getOrder(soNumber) : undefined;

  if (!order) {
    return (
      <div className="page">
        <p>Order not found.</p>
        <Link to="/labels">&larr; Back to Create Labels</Link>
      </div>
    );
  }

  function handlePrint() {
    if (!order) return;
    updateOrder({ ...order, labelPrintedAt: new Date().toISOString() });
    window.print();
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <button className="link-btn" onClick={() => navigate("/labels")}>
          &larr; Back to Create Labels
        </button>
        <button className="secondary-btn print-btn" onClick={handlePrint}>
          Print Label
        </button>
      </div>

      <div className="shipping-label">
        <div className="label-from">
          <span className="muted">From</span>
          Aamstrand Ropes &amp; Twines · 711 N Grove St, Manteno, IL 60950
        </div>

        <div className="label-to">
          <span className="muted">Ship To</span>
          <div className="label-to-name">{order.shipTo.name}</div>
          <div className="label-to-line">{order.shipTo.addressLine1}</div>
          {order.shipTo.addressLine2 && <div className="label-to-line">{order.shipTo.addressLine2}</div>}
          <div className="label-to-line">
            {order.shipTo.city}, {order.shipTo.state} {order.shipTo.zip}
          </div>
        </div>

        <div className="label-meta">
          <div>
            <span className="muted">S.O. #</span>
            <div className="label-meta-value">{order.soNumber}</div>
          </div>
          <div>
            <span className="muted">P.O. #</span>
            <div className="label-meta-value">{order.poNumber || "—"}</div>
          </div>
          <div>
            <span className="muted">Ship Via</span>
            <div className="label-meta-value">{order.shipVia || "—"}</div>
          </div>
        </div>

        {order.shipTo.notes && (
          <div className="label-notes">
            <span className="muted">Notes</span> {order.shipTo.notes}
          </div>
        )}
      </div>

      {order.labelPrintedAt && (
        <p className="muted no-print label-printed-note">
          Last printed {new Date(order.labelPrintedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
