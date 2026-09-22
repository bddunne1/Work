import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import LineItemsTable from "../components/LineItemsTable";
import StatusPill from "../components/StatusPill";
import { useAuth, useCanEdit } from "../lib/authContext";
import { getOrder, undoShipment } from "../lib/orderStore";
import { canView } from "../lib/permissions";
import type { PurchaseOrder } from "../types";
import { itemLabel, orderSubtotal, orderTax, orderTotal } from "../types";

// Where "continue working this order" should go next, based on its current
// stage - so a Sales Order view can drop you straight into whatever screen
// is waiting on it instead of making you hunt for the right queue.
function nextStageFor(order: PurchaseOrder): { label: string; to: string } | null {
  switch (order.status) {
    case "Entered":
      return { label: "To Validation", to: `/validation/${order.soNumber}` };
    case "Checked":
      return { label: "To Allocation", to: `/allocation/${order.soNumber}` };
    case "Backordered":
      return { label: "Re-check Stock", to: `/allocation/${order.soNumber}` };
    case "Allocated":
      return { label: "To Pick & Pack", to: `/pick-pack/${order.soNumber}` };
    case "Pick & Packed":
      return order.pickListPrintedAt && order.packingSlipPrintedAt
        ? { label: "To Open Picks", to: `/open-picks/${order.soNumber}` }
        : { label: "To Print Queue", to: "/pick-pack" };
    default:
      return null;
  }
}

export default function OrderDetail() {
  const { soNumber } = useParams<{ soNumber: string }>();
  // Keyed so navigating directly between two orders on this same route
  // remounts fresh instead of reusing local order state from a previous order.
  return <OrderDetailInner key={soNumber} />;
}

function OrderDetailInner() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const { account } = useAuth();
  const canEdit = useCanEdit();
  const [order, setOrder] = useState<PurchaseOrder | undefined>(() =>
    soNumber ? getOrder(soNumber) : undefined
  );

  if (!order) {
    return (
      <div className="page">
        <p>Order not found.</p>
        <Link to="/open-orders">&larr; Back to Open Orders</Link>
      </div>
    );
  }

  const nextStage = nextStageFor(order);
  const showStageButton = nextStage && account && canView(nextStage.to, account.role);
  const canUndoShipment = canEdit && (order.shipmentHistory?.length ?? 0) > 0;

  function handleUndoShipment() {
    if (!order) return;
    const last = (order.shipmentHistory ?? []).at(-1);
    if (!last) return;
    const summary = last.lines.map((l) => `${itemLabel(order, l.lineItemId)} × ${l.qty}`).join(", ");
    if (
      !confirm(
        `Undo the most recent shipment on S.O. #${order.soNumber}? This restores the shipped quantities (${summary}) to on-hand inventory and moves the order back to Open Picks.`
      )
    ) {
      return;
    }
    setOrder(undoShipment(order));
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <button className="link-btn" onClick={() => navigate(-1)}>
          &larr; Back
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
                <StatusPill order={order} />
              </td>
            </tr>
          </tbody>
        </table>

        <LineItemsTable
          items={order.lineItems}
          onChange={() => {}}
          readOnly
          shipmentHistory={order.shipmentHistory}
        />

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

      {showStageButton && nextStage && (
        <div className="button-row no-print stage-nav-row">
          <button type="button" className="primary-btn" onClick={() => navigate(nextStage.to)}>
            {nextStage.label}
          </button>
        </div>
      )}

      {canUndoShipment && (
        <div className="button-row no-print stage-nav-row">
          <button type="button" className="secondary-btn danger-btn" onClick={handleUndoShipment}>
            Undo Last Shipment
          </button>
        </div>
      )}
    </div>
  );
}
