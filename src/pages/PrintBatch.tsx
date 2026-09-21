import { useState } from "react";
import { Link } from "react-router-dom";
import BatchPrintDocs from "../components/BatchPrintDocs";
import { listOrders, updateOrder } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";

function isFullyPrinted(o: PurchaseOrder): boolean {
  return Boolean(o.pickListPrintedAt && o.packingSlipPrintedAt);
}

function queuedOrders(): PurchaseOrder[] {
  return listOrders().filter(
    (o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0 && !isFullyPrinted(o)
  );
}

export default function PrintBatch() {
  const [orders, setOrders] = useState<PurchaseOrder[]>(() => queuedOrders());
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const s: Record<string, boolean> = {};
    for (const o of orders) s[o.soNumber] = true;
    return s;
  });
  const [includePick, setIncludePick] = useState(true);
  const [includeSlip, setIncludeSlip] = useState(true);
  const [printing, setPrinting] = useState(false);

  const selectedOrders = orders.filter((o) => selected[o.soNumber]);
  const canPrint = selectedOrders.length > 0 && (includePick || includeSlip);

  function toggleSelected(soNumber: string) {
    setSelected((s) => ({ ...s, [soNumber]: !s[soNumber] }));
  }

  function selectAll() {
    const s: Record<string, boolean> = {};
    for (const o of orders) s[o.soNumber] = true;
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
      const now = new Date().toISOString();
      const printedSoNumbers = new Set(selectedOrders.map((o) => o.soNumber));
      for (const o of selectedOrders) {
        updateOrder({
          ...o,
          pickListPrintedAt: includePick ? now : o.pickListPrintedAt,
          packingSlipPrintedAt: includeSlip ? now : o.packingSlipPrintedAt,
        });
      }
      setOrders((os) =>
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
      setPrinting(false);
    }, 50);
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <h1>Print Batch</h1>
      </div>

      <div className="no-print">
        <p className="muted">
          Orders completed in Pick &amp; Pack, staged here until both documents are printed. A fully
          printed order moves on to Open Picks automatically.
        </p>

        {orders.length === 0 ? (
          <p className="muted">Nothing queued for batch printing right now.</p>
        ) : (
          <>
            <div className="toolbar">
              <p className="muted">
                {selectedOrders.length} of {orders.length} selected
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
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.soNumber}>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[o.soNumber])}
                        onChange={() => toggleSelected(o.soNumber)}
                        aria-label={`Select S.O. ${o.soNumber}`}
                      />
                    </td>
                    <td>
                      <Link to={`/storage/${o.soNumber}`}>{o.soNumber}</Link>
                    </td>
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
