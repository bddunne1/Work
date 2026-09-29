import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { isConflictError } from "../lib/apiClient";
import { itemsIndex, listItems } from "../lib/itemStore";
import { allocateOrder, getOrder, listOpenOrders, releaseOrders, unallocateOrderCmd } from "../lib/orderStore";
import type { ReviewQueueState } from "../lib/reviewQueue";
import { nextQueueSoNumber, queueProgressLabel } from "../lib/reviewQueue";
import type { Item, PurchaseOrder } from "../types";
import { allocatedQtyFor, availableQty, canUnallocate, qtyAllocatedOnOrders, remainingToShip } from "../types";

export default function PickPackDetail() {
  const { soNumber } = useParams<{ soNumber: string }>();
  // Keyed so navigating directly between two orders on this same route
  // (e.g. via browser back/forward) remounts fresh instead of reusing
  // this component's local edit state with the previous order's line ids.
  return <PickPackDetailInner key={soNumber} />;
}

function PickPackDetailInner() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queueState = location.state as ReviewQueueState | undefined;
  const [order, setOrder] = useState<PurchaseOrder | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);

  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const itemsByNumber = itemsIndex(items);

  useEffect(() => {
    listItems().then(setItems);
    listOpenOrders().then(setAllOrders);
  }, []);

  useEffect(() => {
    if (!soNumber) return;
    getOrder(soNumber).then((o) => {
      setOrder(o);
      setLoading(false);
      const q: Record<string, number> = {};
      for (const li of o?.lineItems ?? []) q[li.id] = allocatedQtyFor(o!, li.id);
      setQtys(q);
    });
  }, [soNumber]);

  if (loading) {
    return <div className="page" />;
  }

  if (!order) {
    return (
      <div className="page">
        <p>Order not found.</p>
        <Link to="/pick-pack">&larr; Back to Release Orders</Link>
      </div>
    );
  }

  function setQty(lineItemId: string, value: number, max: number) {
    setQtys((q) => ({ ...q, [lineItemId]: Math.max(0, Math.min(value, max)) }));
    setSaved(false);
  }

  function goNext() {
    const next = nextQueueSoNumber(queueState);
    if (next) {
      navigate(`/pick-pack/${next}`, { state: { queue: queueState!.queue, pos: queueState!.pos + 1 } });
    } else {
      navigate("/pick-pack");
    }
  }

  async function reviseAllocation() {
    if (!order) return;
    const anyAllocated = order.lineItems.some((li) => (qtys[li.id] ?? 0) > 0);
    if (!anyAllocated) {
      alert("At least one line needs an allocated quantity - use Unallocate instead to send this order back to Checked.");
      return;
    }
    const lines = order.lineItems.map((li) => ({
      lineItemId: li.id,
      allocatedQty: qtys[li.id] ?? allocatedQtyFor(order, li.id),
    }));
    try {
      setOrder(await allocateOrder(order, lines, order.allocation?.shipCompleteOnly));
      setSaved(true);
    } catch (err) {
      if (isConflictError(err)) {
        alert(err.message);
        setOrder(await getOrder(order.soNumber));
        return;
      }
      throw err;
    }
  }

  async function releasePick() {
    if (!order) return;
    const releasedLines = order.lineItems.filter((li) => (qtys[li.id] ?? 0) > 0);
    if (releasedLines.length === 0) return;

    // Same command the bulk Release Orders list uses: the server stages the
    // pick, zeroes the released lines' allocation and moves the order on.
    const lines = order.lineItems.map((li) => ({ lineItemId: li.id, qty: qtys[li.id] ?? 0 }));
    try {
      const res = await releaseOrders([{ order, lines }]);
      const failed = res.results.find((r) => !r.ok);
      if (failed) {
        alert(failed.error ?? `S.O. #${order.soNumber} didn't release.`);
        setOrder(await getOrder(order.soNumber));
        return;
      }
    } catch (err) {
      if (isConflictError(err)) {
        alert(err.message);
        setOrder(await getOrder(order.soNumber));
        return;
      }
      throw err;
    }
    goNext();
  }

  async function handleUnallocate() {
    if (!order || !canUnallocate(order)) return;
    if (
      !confirm(
        `Unallocate S.O. #${order.soNumber}? This releases its reserved stock and sends it back to Checked for a fresh allocation decision.`
      )
    ) {
      return;
    }
    try {
      await unallocateOrderCmd(order);
    } catch (err) {
      if (isConflictError(err)) {
        alert(err.message);
        setOrder(await getOrder(order.soNumber));
        return;
      }
      throw err;
    }
    goNext();
  }

  // Opened from a queue snapshot (or a bookmark) after someone else already
  // released or unallocated this order - don't offer to release it again.
  const staleStatus = order.status !== "Allocated";
  const readyToRelease = !staleStatus && order.lineItems.some((li) => (qtys[li.id] ?? 0) > 0);

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/pick-pack" className="link-btn">
          &larr; {queueState ? "Exit Queue" : "Back to Release Orders"}
        </Link>
        <h1>Review S.O. #{order.soNumber}</h1>
        <div className="review-meta">
          <span>
            P.O. #<strong>{order.poNumber || "—"}</strong>
          </span>
          <span className="review-meta-sep">·</span>
          <strong>{order.billTo.name}</strong>
          {queueState && <span className="review-meta-queue">{queueProgressLabel(queueState)}</span>}
        </div>
      </div>

      {staleStatus && (
        <p className="stale-status-notice">
          This order is already {order.status} - someone else moved it on since this queue was loaded. Nothing here
          can be released again; skip to the next order.
        </p>
      )}

      <div className="sales-order">
        <div className="line-items">
          <div className="ship-locations-header">
            <h3>Allocated Lines</h3>
          </div>
          <div className="scroll-window">
            <table className="data-table line-item-table">
              <thead>
                <tr>
                  <th className="col-item">Item</th>
                  <th className="col-desc">Description</th>
                  <th className="col-um">U/M</th>
                  <th className="col-qty">Ordered</th>
                  <th className="col-qty">Remaining</th>
                  <th className="col-qty">Available</th>
                  <th className="col-qty">Allocated</th>
                </tr>
              </thead>
              <tbody>
                {order.lineItems.map((li) => {
                  const remaining = remainingToShip(order, li);
                  const catalogItem = itemsByNumber.get(li.item.trim().toLowerCase());
                  const reservedElsewhere = qtyAllocatedOnOrders(
                    li.item,
                    allOrders.filter((o) => o.soNumber !== order.soNumber)
                  );
                  const trueAvailable = catalogItem ? availableQty(catalogItem, reservedElsewhere) : null;
                  const maxQty = trueAvailable !== null ? Math.max(0, Math.min(remaining, trueAvailable)) : remaining;
                  const qty = qtys[li.id] ?? 0;
                  return (
                    <tr key={li.id}>
                      <td>{li.item}</td>
                      <td>{li.description}</td>
                      <td>{li.um}</td>
                      <td className="amount-cell">{li.ordered}</td>
                      <td className="amount-cell">{remaining}</td>
                      <td className={`amount-cell ${trueAvailable !== null && trueAvailable < 0 ? "qty-negative" : ""}`}>
                        {trueAvailable !== null ? trueAvailable : "—"}
                      </td>
                      <td>
                        <input
                          type="number"
                          className="num-input allocate-qty-input"
                          min={0}
                          max={maxQty}
                          value={qty}
                          onChange={(e) => setQty(li.id, Number(e.target.value), maxQty)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="button-row">
          <button type="button" className="secondary-btn" onClick={reviseAllocation}>
            Revise Allocation
          </button>
          <button type="button" className="primary-btn" disabled={!readyToRelease} onClick={releasePick}>
            Release Order
          </button>
          <button type="button" className="secondary-btn danger-btn" onClick={handleUnallocate}>
            Unallocate
          </button>
          {saved && <span className="muted">Allocation saved.</span>}
        </div>
      </div>
    </div>
  );
}
