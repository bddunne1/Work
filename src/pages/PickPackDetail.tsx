import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { isConflictError } from "../lib/apiClient";
import { itemsIndex, listItems } from "../lib/itemStore";
import { getOrder, listOpenOrders, updateOrder } from "../lib/orderStore";
import type { ReviewQueueState } from "../lib/reviewQueue";
import { nextQueueSoNumber, queueProgressLabel } from "../lib/reviewQueue";
import type { Item, PurchaseOrder } from "../types";
import { allocatedQtyFor, availableQty, canUnallocate, qtyAllocatedOnOrders, remainingToShip, unallocateOrder } from "../types";

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
        <Link to="/pick-pack">&larr; Back to Pick &amp; Pack</Link>
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
    const fullyAllocated = order.lineItems.every((li) => (qtys[li.id] ?? 0) >= remainingToShip(order, li));
    const updated: PurchaseOrder = {
      ...order,
      allocation: {
        lines,
        fullyAllocated,
        shipCompleteOnly: order.allocation?.shipCompleteOnly,
        decidedAt: new Date().toISOString(),
      },
    };
    try {
      setOrder(await updateOrder(updated, "Allocated"));
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

    const pendingShipment = releasedLines.map((li) => ({ lineItemId: li.id, qty: qtys[li.id] ?? 0 }));
    const newAllocationLines = order.lineItems.map((li) => ({
      lineItemId: li.id,
      allocatedQty: (qtys[li.id] ?? 0) > 0 ? 0 : allocatedQtyFor(order, li.id),
    }));
    const pickPackStatus: "Partial" | "Complete" = order.lineItems.every(
      (li) => remainingToShip(order, li) - (qtys[li.id] ?? 0) <= 0
    )
      ? "Complete"
      : "Partial";

    try {
      await updateOrder({
        ...order,
        status: "Pick & Packed",
        pickPackStatus,
        pickedAt: new Date().toISOString(),
        pendingShipment,
        pickListPrintedAt: undefined,
        packingSlipPrintedAt: undefined,
        allocation: order.allocation ? { ...order.allocation, lines: newAllocationLines } : order.allocation,
      }, "Allocated");
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
      await updateOrder(unallocateOrder(order), order.status);
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
          &larr; {queueState ? "Exit Queue" : "Back to Pick & Pack"}
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

        <div className="button-row">
          <button type="button" className="secondary-btn" onClick={reviseAllocation}>
            Revise Allocation
          </button>
          <button type="button" className="primary-btn" disabled={!readyToRelease} onClick={releasePick}>
            Release Pick
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
