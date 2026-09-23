import { useState } from "react";
import { useNavigate } from "react-router-dom";
import BatchPrintDocs from "../components/BatchPrintDocs";
import StatusPill from "../components/StatusPill";
import WarehouseCapacityBanner from "../components/WarehouseCapacityBanner";
import { useCanEdit } from "../lib/authContext";
import { listOrders, updateOrder } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { allocatedQtyFor, canUnallocate, unallocateOrder } from "../types";

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

function releasedPicks(): PurchaseOrder[] {
  return listOrders().filter(
    (o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0 && !isFullyPrinted(o)
  );
}

export default function PickPack() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [pickable, setPickable] = useState<PurchaseOrder[]>(() => readyToPick());
  const [queue, setQueue] = useState<PurchaseOrder[]>(() => releasedPicks());

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
          Review allocated orders, then release them and print pick lists and packing slips for
          everything staged below. Releasing a pick moves that order out of Review and into Released
          Picks.
        </p>
      </div>

      <div className="no-print">
        <WarehouseCapacityBanner />

        <div className="ship-locations-header">
          <h3>Review</h3>
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
          <p className="muted">Nothing ready to review right now.</p>
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
                <tr key={o.soNumber} className="clickable-row" onClick={() => navigate(`/pick-pack/${o.soNumber}`)}>
                  <td>{o.soNumber}</td>
                  <td>{o.poNumber}</td>
                  <td>{o.billTo.name}</td>
                  <td>
                    <StatusPill order={o} />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="row-action-outline"
                      onClick={() => navigate(`/pick-pack/${o.soNumber}`)}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="ship-locations-header print-queue-header">
          <h3>Released Picks</h3>
          <p className="muted">Released, yet to be opened - waiting on pick list / packing slip printing.</p>
        </div>
        {queue.length === 0 ? (
          <p className="muted">Nothing released and waiting on printing right now.</p>
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
