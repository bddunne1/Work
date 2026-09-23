import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { getItemByNumber } from "../lib/itemStore";
import { getOrder, listOrders, updateOrder } from "../lib/orderStore";
import type { ReviewQueueState } from "../lib/reviewQueue";
import { nextQueueSoNumber, queueProgressLabel } from "../lib/reviewQueue";
import type { PurchaseOrder } from "../types";
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
  const [order, setOrder] = useState<PurchaseOrder | undefined>(() =>
    soNumber ? getOrder(soNumber) : undefined
  );
  const allOrders = listOrders();

  const [qtys, setQtys] = useState<Record<string, number>>(() => {
    const q: Record<string, number> = {};
    for (const li of order?.lineItems ?? []) q[li.id] = allocatedQtyFor(order!, li.id);
    return q;
  });
  const [saved, setSaved] = useState(false);

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

  function reviseAllocation() {
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
    updateOrder(updated);
    setOrder(updated);
    setSaved(true);
  }

  function releasePick() {
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

    updateOrder({
      ...order,
      status: "Pick & Packed",
      pickPackStatus,
      pickedAt: new Date().toISOString(),
      pendingShipment,
      pickListPrintedAt: undefined,
      packingSlipPrintedAt: undefined,
      allocation: order.allocation ? { ...order.allocation, lines: newAllocationLines } : order.allocation,
    });
    goNext();
  }

  function handleUnallocate() {
    if (!order || !canUnallocate(order)) return;
    if (
      !confirm(
        `Unallocate S.O. #${order.soNumber}? This releases its reserved stock and sends it back to Checked for a fresh allocation decision.`
      )
    ) {
      return;
    }
    updateOrder(unallocateOrder(order));
    goNext();
  }

  const readyToRelease = order.lineItems.some((li) => (qtys[li.id] ?? 0) > 0);

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/pick-pack" className="link-btn">
          &larr; {queueState ? "Exit Queue" : "Back to Pick & Pack"}
        </Link>
        <h1>Review S.O. #{order.soNumber}</h1>
        <p className="muted">
          P.O. #{order.poNumber || "—"} · {order.billTo.name}
          {queueState && <> · {queueProgressLabel(queueState)}</>}
        </p>
      </div>

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
                const catalogItem = getItemByNumber(li.item);
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
