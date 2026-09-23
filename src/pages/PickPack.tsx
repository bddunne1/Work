import { Fragment, useState } from "react";
import { useNavigate } from "react-router-dom";
import BatchPrintDocs from "../components/BatchPrintDocs";
import StatusPill from "../components/StatusPill";
import { useCanEdit } from "../lib/authContext";
import { getItemByNumber } from "../lib/itemStore";
import { listOrders, updateOrder } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import {
  allocatedQtyFor,
  availableQty,
  canUnallocate,
  qtyAllocatedOnOrders,
  remainingToShip,
  unallocateOrder,
} from "../types";

function isFullyPrinted(o: PurchaseOrder): boolean {
  return Boolean(o.pickListPrintedAt && o.packingSlipPrintedAt);
}

function readyToPick(): PurchaseOrder[] {
  // An order allocated at zero units (see AllocationDecision's zero-qty
  // guard) has nothing to pick and would stall here forever - exclude it
  // as a safety net even if it somehow reached this status another way.
  return listOrders().filter(
    (o) => o.status === "Allocated" && o.lineItems.some((li) => allocatedQtyFor(o, li.id) > 0)
  );
}

function printQueue(): PurchaseOrder[] {
  return listOrders().filter(
    (o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0 && !isFullyPrinted(o)
  );
}

export default function PickPack() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [pickable, setPickable] = useState<PurchaseOrder[]>(() => readyToPick());
  const [queue, setQueue] = useState<PurchaseOrder[]>(() => printQueue());
  const [revisingSo, setRevisingSo] = useState<string | null>(null);
  const [reviseQtys, setReviseQtys] = useState<Record<string, number>>({});
  const allOrders = listOrders();

  function handleUnallocate(order: PurchaseOrder) {
    if (!canUnallocate(order)) return;
    if (
      !confirm(
        `Unallocate S.O. #${order.soNumber}? This releases its reserved stock and sends it back to Checked for a fresh allocation decision.`
      )
    ) {
      return;
    }
    updateOrder(unallocateOrder(order));
    setPickable((os) => os.filter((o) => o.soNumber !== order.soNumber));
    setQueue((os) => os.filter((o) => o.soNumber !== order.soNumber));
  }

  function startRevise(order: PurchaseOrder) {
    const initial: Record<string, number> = {};
    for (const li of order.lineItems) initial[li.id] = allocatedQtyFor(order, li.id);
    setReviseQtys(initial);
    setRevisingSo(order.soNumber);
  }

  function cancelRevise() {
    setRevisingSo(null);
    setReviseQtys({});
  }

  function setReviseQty(lineItemId: string, value: number, max: number) {
    setReviseQtys((q) => ({ ...q, [lineItemId]: Math.max(0, Math.min(value, max)) }));
  }

  // Updates the allocated quantities on an already-allocated order in place -
  // unlike Unallocate, this never changes the order's status, so it stays
  // right where it is in the Pick & Pack queue.
  function saveRevise(order: PurchaseOrder) {
    const anyAllocated = order.lineItems.some((li) => (reviseQtys[li.id] ?? 0) > 0);
    if (!anyAllocated) {
      alert("At least one line needs an allocated quantity - use Unallocate instead to pull this order out of Pick & Pack entirely.");
      return;
    }
    const lines = order.lineItems.map((li) => ({
      lineItemId: li.id,
      allocatedQty: reviseQtys[li.id] ?? allocatedQtyFor(order, li.id),
    }));
    const fullyAllocated = order.lineItems.every(
      (li) => (reviseQtys[li.id] ?? 0) >= remainingToShip(order, li)
    );
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
    setPickable((os) => os.map((o) => (o.soNumber === order.soNumber ? updated : o)));
    cancelRevise();
  }

  function startReviewQueue() {
    if (pickable.length === 0) return;
    const reviewQueue = pickable.map((o) => o.soNumber);
    navigate(`/pick-pack/${reviewQueue[0]}`, { state: { queue: reviewQueue, pos: 0 } });
  }
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const s: Record<string, boolean> = {};
    for (const o of queue) s[o.soNumber] = true;
    return s;
  });
  const [includePick, setIncludePick] = useState(true);
  const [includeSlip, setIncludeSlip] = useState(true);
  const [printing, setPrinting] = useState(false);

  const selectedOrders = queue.filter((o) => selected[o.soNumber]);
  const canPrint = selectedOrders.length > 0 && (includePick || includeSlip);

  function toggleSelected(soNumber: string) {
    setSelected((s) => ({ ...s, [soNumber]: !s[soNumber] }));
  }

  function selectAll() {
    const s: Record<string, boolean> = {};
    for (const o of queue) s[o.soNumber] = true;
    setSelected(s);
  }

  function selectNone() {
    setSelected({});
  }

  function printBatch() {
    if (!canPrint) return;
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
      // window.print() gives no way to tell whether the user actually
      // printed or hit Cancel, so ask directly rather than assuming success
      // - otherwise a canceled print still knocked the order out of the
      // queue and into Open Picks with nothing actually printed.
      const confirmed = confirm(
        "Did the pick list / packing slip print successfully? Choose OK to move these orders to Open Picks, or Cancel to keep them in the queue and try again."
      );
      if (!confirmed) return;
      const now = new Date().toISOString();
      const printedSoNumbers = new Set(selectedOrders.map((o) => o.soNumber));
      for (const o of selectedOrders) {
        updateOrder({
          ...o,
          pickListPrintedAt: includePick ? now : o.pickListPrintedAt,
          packingSlipPrintedAt: includeSlip ? now : o.packingSlipPrintedAt,
        });
      }
      setQueue((os) =>
        os
          .map((o) =>
            printedSoNumbers.has(o.soNumber)
              ? {
                  ...o,
                  pickListPrintedAt: includePick ? now : o.pickListPrintedAt,
                  packingSlipPrintedAt: includeSlip ? now : o.packingSlipPrintedAt,
                }
              : o
          )
          .filter((o) => !isFullyPrinted(o))
      );
    }, 50);
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <h1>Pick &amp; Pack</h1>
        <p className="muted">
          Pick allocated orders, then print pick lists and packing slips for everything staged below.
          Completing a pick moves that order out of the list above and into the print queue.
        </p>
      </div>

      <div className="no-print">
        <div className="ship-locations-header">
          <h3>Ready to Pick</h3>
          <button
            type="button"
            className="primary-btn"
            disabled={pickable.length === 0}
            onClick={startReviewQueue}
          >
            Review Queue
          </button>
        </div>
        {pickable.length === 0 ? (
          <p className="muted">Nothing ready to pick right now.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>S.O. #</th>
                <th>P.O. #</th>
                <th>Customer</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pickable.map((o) => (
                <Fragment key={o.soNumber}>
                  <tr className="clickable-row" onClick={() => navigate(`/pick-pack/${o.soNumber}`)}>
                    <td>{o.soNumber}</td>
                    <td>{o.poNumber}</td>
                    <td>{o.billTo.name}</td>
                    <td>
                      <StatusPill order={o} />
                    </td>
                    <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            className="row-action-outline"
                            onClick={() => (revisingSo === o.soNumber ? cancelRevise() : startRevise(o))}
                          >
                            {revisingSo === o.soNumber ? "Cancel" : "Revise Allocation"}
                          </button>
                          <button
                            type="button"
                            className="row-action-outline danger-link"
                            onClick={() => handleUnallocate(o)}
                          >
                            Unallocate
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {revisingSo === o.soNumber && (
                    <tr className="no-print">
                      <td colSpan={5}>
                        <div className="revise-allocation-panel">
                          <table className="data-table line-item-table">
                            <thead>
                              <tr>
                                <th className="col-item">Item</th>
                                <th className="col-desc">Description</th>
                                <th className="col-qty">Remaining</th>
                                <th className="col-qty">Available</th>
                                <th className="col-qty">Allocate</th>
                              </tr>
                            </thead>
                            <tbody>
                              {o.lineItems.map((li) => {
                                const remaining = remainingToShip(o, li);
                                const catalogItem = getItemByNumber(li.item);
                                const reservedElsewhere = qtyAllocatedOnOrders(
                                  li.item,
                                  allOrders.filter((x) => x.soNumber !== o.soNumber)
                                );
                                const trueAvailable = catalogItem
                                  ? availableQty(catalogItem, reservedElsewhere)
                                  : null;
                                const maxQty =
                                  trueAvailable !== null ? Math.max(0, Math.min(remaining, trueAvailable)) : remaining;
                                const qty = reviseQtys[li.id] ?? 0;
                                return (
                                  <tr key={li.id}>
                                    <td>{li.item}</td>
                                    <td>{li.description}</td>
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
                                        onChange={(e) => setReviseQty(li.id, Number(e.target.value), maxQty)}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          <div className="button-row">
                            <button type="button" className="primary-btn" onClick={() => saveRevise(o)}>
                              Save Allocation
                            </button>
                            <button type="button" className="secondary-btn" onClick={cancelRevise}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}

        <div className="ship-locations-header print-queue-header">
          <h3>Print Queue</h3>
        </div>
        {queue.length === 0 ? (
          <p className="muted">Nothing queued for batch printing right now.</p>
        ) : (
          <>
            <div className="toolbar">
              <p className="muted">
                {selectedOrders.length} of {queue.length} selected
              </p>
              <div className="inline-actions">
                <button type="button" className="secondary-btn" onClick={selectAll}>
                  Select All
                </button>
                <button type="button" className="secondary-btn" onClick={selectNone}>
                  Select None
                </button>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>S.O. #</th>
                  <th>P.O. #</th>
                  <th>Customer</th>
                  <th>Pick List</th>
                  <th>Packing Slip</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {queue.map((o) => (
                  <tr
                    key={o.soNumber}
                    className="clickable-row"
                    onClick={() => navigate(`/storage/${o.soNumber}`)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[o.soNumber])}
                        onChange={() => toggleSelected(o.soNumber)}
                        aria-label={`Select S.O. ${o.soNumber}`}
                      />
                    </td>
                    <td>{o.soNumber}</td>
                    <td>{o.poNumber}</td>
                    <td>{o.billTo.name}</td>
                    <td>
                      {o.pickListPrintedAt ? (
                        <span className="status-pill">Printed</span>
                      ) : (
                        <span className="muted">Not printed</span>
                      )}
                    </td>
                    <td>
                      {o.packingSlipPrintedAt ? (
                        <span className="status-pill">Printed</span>
                      ) : (
                        <span className="muted">Not printed</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canEdit && canUnallocate(o) && (
                        <button
                          type="button"
                          className="row-action-outline danger-link"
                          onClick={() => handleUnallocate(o)}
                        >
                          Unallocate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="button-row">
              <label className="checkbox-line">
                <input type="checkbox" checked={includePick} onChange={(e) => setIncludePick(e.target.checked)} />
                Pick List
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={includeSlip} onChange={(e) => setIncludeSlip(e.target.checked)} />
                Packing Slip
              </label>
              <button type="button" className="primary-btn" disabled={!canPrint} onClick={printBatch}>
                Print
              </button>
            </div>
          </>
        )}
      </div>

      {printing && <BatchPrintDocs orders={selectedOrders} includePick={includePick} includeSlip={includeSlip} />}
    </div>
  );
}
