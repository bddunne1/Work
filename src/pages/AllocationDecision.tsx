import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import LineItemsTable from "../components/LineItemsTable";
import { getCustomer } from "../lib/customerStore";
import { getOrder, updateOrder } from "../lib/orderStore";
import type { OrderStatus } from "../types";
import { orderTotal } from "../types";

export default function AllocationDecision() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const order = soNumber ? getOrder(soNumber) : undefined;
  const customer = order?.customerId ? getCustomer(order.customerId) : undefined;

  const [fullyInStock, setFullyInStock] = useState<boolean | null>(order?.allocation?.fullyInStock ?? null);
  const [shipCompleteOnly, setShipCompleteOnly] = useState<boolean | null>(
    order?.allocation?.shipCompleteOnly ?? customer?.shipCompleteOnly ?? null
  );

  if (!order) {
    return (
      <div className="page">
        <p>Order not found.</p>
        <Link to="/allocation">&larr; Back to Allocation</Link>
      </div>
    );
  }

  let outcomeStatus: OrderStatus | null = null;
  let outcomeLabel = "";
  let outcomeDetail = "";
  let outcomeClass = "";

  if (fullyInStock === true) {
    outcomeStatus = "Allocated";
    outcomeLabel = "Allocate full qty · release to Order Prep";
    outcomeDetail = "Ships complete, on ETA.";
    outcomeClass = "outcome-success";
  } else if (fullyInStock === false && shipCompleteOnly === true) {
    outcomeStatus = "Backordered";
    outcomeLabel = "Hold order. Log in awaiting inventory";
    outcomeDetail = "Held — awaiting full stock. Added to the Back Order Queue.";
    outcomeClass = "outcome-hold";
  } else if (fullyInStock === false && shipCompleteOnly === false) {
    outcomeStatus = "Backordered";
    outcomeLabel = "Allocate what's available · back order the rest";
    outcomeDetail = "Partial ship, now. Remainder added to the Back Order Queue.";
    outcomeClass = "outcome-warning";
  }

  function applyDecision() {
    if (!order || fullyInStock === null || !outcomeStatus) return;
    if (fullyInStock === false && shipCompleteOnly === null) return;
    updateOrder({
      ...order,
      status: outcomeStatus,
      allocation: {
        fullyInStock,
        shipCompleteOnly: fullyInStock ? false : (shipCompleteOnly as boolean),
        decidedAt: new Date().toISOString(),
      },
    });
    navigate(`/storage/${order.soNumber}`);
  }

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/allocation" className="link-btn">
          &larr; Back to Allocation
        </Link>
        <h1>Allocate S.O. #{order.soNumber}</h1>
        <p className="muted">
          P.O. #{order.poNumber || "—"} · {order.billTo.name} · ${orderTotal(order).toFixed(2)}
        </p>
      </div>

      <div className="sales-order validation-panel">
        <LineItemsTable items={order.lineItems} onChange={() => {}} readOnly />

        <div className="decision-flow">
          <div className="decision-step">
            <div className="decision-question">Full ordered qty in stock?</div>
            <div className="decision-buttons">
              <button
                type="button"
                className={`decision-btn ${fullyInStock === true ? "selected" : ""}`}
                onClick={() => setFullyInStock(true)}
              >
                Yes
              </button>
              <button
                type="button"
                className={`decision-btn ${fullyInStock === false ? "selected" : ""}`}
                onClick={() => setFullyInStock(false)}
              >
                No
              </button>
            </div>
          </div>

          {fullyInStock === false && (
            <div className="decision-step">
              <div className="decision-question">
                Ship-complete-only customer? <span className="muted">(Customer Master flag)</span>
              </div>
              {customer && (
                <p className="muted decision-hint">
                  Customer record says: {customer.shipCompleteOnly ? "Yes" : "No"}
                </p>
              )}
              <div className="decision-buttons">
                <button
                  type="button"
                  className={`decision-btn ${shipCompleteOnly === true ? "selected" : ""}`}
                  onClick={() => setShipCompleteOnly(true)}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className={`decision-btn ${shipCompleteOnly === false ? "selected" : ""}`}
                  onClick={() => setShipCompleteOnly(false)}
                >
                  No
                </button>
              </div>
            </div>
          )}

          {outcomeStatus && (
            <div className={`decision-outcome ${outcomeClass}`}>
              <div className="decision-outcome-label">{outcomeLabel}</div>
              <div className="decision-outcome-detail">{outcomeDetail}</div>
              <button type="button" className="primary-btn" onClick={applyDecision}>
                Confirm &amp; Apply
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
