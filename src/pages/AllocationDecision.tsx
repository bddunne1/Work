import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getCustomer } from "../lib/customerStore";
import { getOrder, updateOrder } from "../lib/orderStore";
import type { LineItem, OrderStatus, PurchaseOrder } from "../types";
import { orderTotal, shippedQtyFor } from "../types";

function remainingToShip(order: PurchaseOrder, li: LineItem): number {
  return Math.max(0, li.ordered - shippedQtyFor(order, li.id));
}

export default function AllocationDecision() {
  const { soNumber } = useParams<{ soNumber: string }>();
  // Keyed so navigating directly between two orders on this same route
  // remounts fresh instead of reusing local edit state from a previous order.
  return <AllocationDecisionInner key={soNumber} />;
}

function AllocationDecisionInner() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const order = soNumber ? getOrder(soNumber) : undefined;
  const customer = order?.customerId ? getCustomer(order.customerId) : undefined;

  const [qtys, setQtys] = useState<Record<string, number>>(() => {
    if (!order) return {};
    const saved = new Map(order.allocation?.lines.map((l) => [l.lineItemId, l.allocatedQty]));
    const initial: Record<string, number> = {};
    for (const li of order.lineItems) {
      const remaining = remainingToShip(order, li);
      initial[li.id] = Math.min(saved.get(li.id) ?? remaining, remaining);
    }
    return initial;
  });
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

  function setQty(lineItemId: string, value: number, max: number) {
    const clamped = Math.max(0, Math.min(value, max));
    setQtys((q) => ({ ...q, [lineItemId]: clamped }));
  }

  function allocateAll() {
    const all: Record<string, number> = {};
    for (const li of order!.lineItems) all[li.id] = remainingToShip(order!, li);
    setQtys(all);
  }

  function allocateNone() {
    const none: Record<string, number> = {};
    for (const li of order!.lineItems) none[li.id] = 0;
    setQtys(none);
  }

  const fullyAllocated = order.lineItems.every((li) => (qtys[li.id] ?? 0) >= remainingToShip(order, li));

  let outcomeStatus: OrderStatus | null = null;
  let outcomeLabel = "";
  let outcomeDetail = "";
  let outcomeClass = "";

  if (fullyAllocated) {
    outcomeStatus = "Allocated";
    outcomeLabel = "Allocate full qty · release to Order Prep";
    outcomeDetail = "Ships complete, on ETA.";
    outcomeClass = "outcome-success";
  } else if (shipCompleteOnly === true) {
    outcomeStatus = "Backordered";
    outcomeLabel = "Hold order. Log in awaiting inventory";
    outcomeDetail = "Held — awaiting full stock. Added to the Back Order Queue.";
    outcomeClass = "outcome-hold";
  } else if (shipCompleteOnly === false) {
    outcomeStatus = "Backordered";
    outcomeLabel = "Allocate what's available · back order the rest";
    outcomeDetail = "Partial ship, now. Remainder added to the Back Order Queue.";
    outcomeClass = "outcome-warning";
  }

  function applyDecision() {
    if (!order || !outcomeStatus) return;
    if (!fullyAllocated && shipCompleteOnly === null) return;
    const hold = outcomeStatus === "Backordered" && shipCompleteOnly === true;
    const lines = order.lineItems.map((li) => ({
      lineItemId: li.id,
      allocatedQty: hold ? 0 : (qtys[li.id] ?? 0),
    }));
    updateOrder({
      ...order,
      status: outcomeStatus,
      allocation: {
        lines,
        fullyAllocated,
        shipCompleteOnly: fullyAllocated ? undefined : (shipCompleteOnly as boolean),
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
        <div className="line-items">
          <div className="ship-locations-header">
            <h3>Line Items</h3>
            <div className="inline-actions">
              <button type="button" className="secondary-btn" onClick={allocateAll}>
                Allocate All
              </button>
              <button type="button" className="secondary-btn" onClick={allocateNone}>
                Allocate None
              </button>
            </div>
          </div>
          <table className="data-table line-item-table">
            <thead>
              <tr>
                <th className="col-item">Item</th>
                <th className="col-desc">Description</th>
                <th className="col-um">U/M</th>
                <th className="col-qty">Ordered</th>
                <th className="col-qty">Shipped</th>
                <th className="col-qty">Remaining</th>
                <th className="col-qty">Allocate</th>
              </tr>
            </thead>
            <tbody>
              {order.lineItems.map((li) => {
                const shipped = shippedQtyFor(order, li.id);
                const remaining = remainingToShip(order, li);
                const qty = qtys[li.id] ?? 0;
                const short = qty < remaining;
                return (
                  <tr key={li.id}>
                    <td>{li.item}</td>
                    <td>{li.description}</td>
                    <td>{li.um}</td>
                    <td className="amount-cell">{li.ordered}</td>
                    <td className="amount-cell">{shipped}</td>
                    <td className="amount-cell">{remaining}</td>
                    <td>
                      <input
                        type="number"
                        className={`num-input allocate-qty-input ${short ? "short" : ""}`}
                        min={0}
                        max={remaining}
                        value={qty}
                        onChange={(e) => setQty(li.id, Number(e.target.value), remaining)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="decision-flow">
          {!fullyAllocated && (
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
