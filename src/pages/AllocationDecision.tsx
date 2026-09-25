import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { isConflictError } from "../lib/apiClient";
import { getCustomer } from "../lib/customerStore";
import { itemsIndex, listItems } from "../lib/itemStore";
import { getOrder, listOpenOrders, updateOrder } from "../lib/orderStore";
import type { ReviewQueueState } from "../lib/reviewQueue";
import { nextQueueSoNumber, queueProgressLabel } from "../lib/reviewQueue";
import type { Customer, Item, OrderStatus, PurchaseOrder } from "../types";
import { availableQty, orderTotal, qtyAllocatedOnOrders, remainingToShip, shippedQtyFor } from "../types";

export default function AllocationDecision() {
  const { soNumber } = useParams<{ soNumber: string }>();
  // Keyed so navigating directly between two orders on this same route
  // remounts fresh instead of reusing local edit state from a previous order.
  return <AllocationDecisionInner key={soNumber} />;
}

function AllocationDecisionInner() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queueState = location.state as ReviewQueueState | undefined;
  const [order, setOrder] = useState<PurchaseOrder | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);

  const [customer, setCustomer] = useState<Customer | undefined>();
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [shipCompleteOnly, setShipCompleteOnly] = useState<boolean | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const itemsByNumber = itemsIndex(items);

  useEffect(() => {
    if (!soNumber) return;
    // Loaded together so each line's starting quantity can be capped at what
    // is actually free - it used to default to the full remaining quantity
    // regardless of stock, so one click over-allocated.
    Promise.all([getOrder(soNumber), listItems(), listOpenOrders()]).then(([o, catalog, open]) => {
      setItems(catalog);
      setAllOrders(open);
      setOrder(o);
      setLoading(false);
      if (!o) return;
      const byNumber = itemsIndex(catalog);
      const others = open.filter((x) => x.soNumber !== o.soNumber);
      const takenHere = new Map<string, number>();
      const saved = new Map(o.allocation?.lines.map((l) => [l.lineItemId, l.allocatedQty]));
      const initial: Record<string, number> = {};
      for (const li of o.lineItems) {
        const remaining = remainingToShip(o, li);
        const key = li.item.trim().toLowerCase();
        const catalogItem = byNumber.get(key);
        const free = catalogItem
          ? availableQty(catalogItem, qtyAllocatedOnOrders(li.item, others)) - (takenHere.get(key) ?? 0)
          : remaining;
        const qty = Math.max(0, Math.min(saved.get(li.id) ?? remaining, remaining, free));
        initial[li.id] = qty;
        takenHere.set(key, (takenHere.get(key) ?? 0) + qty);
      }
      setQtys(initial);
      setShipCompleteOnly(o.allocation?.shipCompleteOnly ?? null);
    });
  }, [soNumber]);

  useEffect(() => {
    if (!order?.customerId) return;
    let cancelled = false;
    getCustomer(order.customerId).then((c) => {
      if (cancelled) return;
      setCustomer(c);
      // Only seed the default from the customer record if this order hasn't
      // already recorded its own allocation decision on this.
      if (order.allocation?.shipCompleteOnly === undefined && c) {
        setShipCompleteOnly((prev) => (prev === null ? c.shipCompleteOnly : prev));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [order, order?.customerId]);

  if (loading) {
    return <div className="page" />;
  }

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
    outcomeStatus = "Allocated";
    outcomeLabel = "Allocate what's available · send to Release Orders";
    outcomeDetail =
      "Partial ship, now. Moves on to Release Orders for what's on hand; anything left unshipped lands in the Back Order Queue automatically once this partial ships.";
    outcomeClass = "outcome-warning";
  }

  // Allocation only decides Checked (first pass) and Backordered (re-check
  // stock) orders. Opened from a stale queue or link after the order was
  // already allocated/packed/shipped, confirming would drag it backwards.
  const staleStatus = order.status !== "Checked" && order.status !== "Backordered";

  async function applyDecision() {
    if (!order || !outcomeStatus || staleStatus) return;
    if (!fullyAllocated && shipCompleteOnly === null) return;
    const totalAllocated = order.lineItems.reduce((sum, li) => sum + (qtys[li.id] ?? 0), 0);
    // Allocating zero units has nothing to pick, so it's really a hold -
    // otherwise the order lands in Release Orders with no allocated lines and
    // can never be completed there, stalling the review queue.
    const hold = outcomeStatus === "Backordered" || totalAllocated === 0;
    const finalStatus = hold ? "Backordered" : outcomeStatus;
    const lines = order.lineItems.map((li) => ({
      lineItemId: li.id,
      allocatedQty: hold ? 0 : (qtys[li.id] ?? 0),
    }));
    try {
      await updateOrder({
        ...order,
        status: finalStatus,
        allocation: {
          lines,
          fullyAllocated,
          shipCompleteOnly: fullyAllocated ? undefined : (shipCompleteOnly as boolean),
          decidedAt: new Date().toISOString(),
        },
      }, order.status);
    } catch (err) {
      if (isConflictError(err)) {
        alert(err.message);
        setOrder(await getOrder(order.soNumber));
        return;
      }
      throw err;
    }
    const next = nextQueueSoNumber(queueState);
    if (next) {
      navigate(`/allocation/${next}`, { state: { queue: queueState!.queue, pos: queueState!.pos + 1 } });
    } else if (queueState) {
      navigate("/allocation");
    } else {
      navigate(`/storage/${order.soNumber}`);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/allocation" className="link-btn">
          &larr; {queueState ? "Exit Queue" : "Back to Allocation"}
        </Link>
        <h1>Allocate S.O. #{order.soNumber}</h1>
        <div className="review-meta">
          <span>
            P.O. #<strong>{order.poNumber || "—"}</strong>
          </span>
          <span className="review-meta-sep">·</span>
          <strong>{order.billTo.name}</strong>
          <span className="review-meta-sep">·</span>
          <span className="review-meta-total">${orderTotal(order).toFixed(2)}</span>
          {queueState && <span className="review-meta-queue">{queueProgressLabel(queueState)}</span>}
        </div>
      </div>

      {staleStatus && (
        <p className="stale-status-notice">
          This order is already {order.status} - someone else moved it on since this queue was loaded, so it can't be
          re-allocated from here.
        </p>
      )}

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
          <div className="scroll-window">
            <table className="data-table line-item-table">
              <thead>
                <tr>
                  <th className="col-item">Item</th>
                  <th className="col-desc">Description</th>
                  <th className="col-um">U/M</th>
                  <th className="col-qty">Ordered</th>
                  <th className="col-qty">Shipped</th>
                  <th className="col-qty">Remaining</th>
                  <th className="col-qty">On Hand</th>
                  <th className="col-qty">Available</th>
                  <th className="col-qty">Allocate</th>
                </tr>
              </thead>
              <tbody>
                {order.lineItems.map((li) => {
                  const shipped = shippedQtyFor(order, li.id);
                  const remaining = remainingToShip(order, li);
                  const qty = qtys[li.id] ?? 0;
                  const short = qty < remaining;
                  const catalogItem = itemsByNumber.get(li.item.trim().toLowerCase());
                  const allocatedElsewhere = qtyAllocatedOnOrders(
                    li.item,
                    allOrders.filter((o) => o.soNumber !== order.soNumber)
                  );
                  const available = catalogItem ? availableQty(catalogItem, allocatedElsewhere) : null;
                  const overAvailable = available !== null && qty > available;
                  return (
                    <tr key={li.id}>
                      <td>{li.item}</td>
                      <td>{li.description}</td>
                      <td>{li.um}</td>
                      <td className="amount-cell">{li.ordered}</td>
                      <td className="amount-cell">{shipped}</td>
                      <td className="amount-cell">{remaining}</td>
                      <td className="amount-cell">{catalogItem ? catalogItem.qtyOnHand : "—"}</td>
                      <td className={`amount-cell ${available !== null && available < 0 ? "qty-negative" : ""}`}>
                        {available !== null ? available : "—"}
                      </td>
                      <td>
                        <input
                          type="number"
                          className={`num-input allocate-qty-input ${short ? "short" : ""} ${overAvailable ? "over-available" : ""}`}
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
              <button type="button" className="primary-btn" onClick={applyDecision} disabled={staleStatus}>
                Confirm &amp; Apply
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
