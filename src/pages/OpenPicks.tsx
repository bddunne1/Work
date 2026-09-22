import { useState } from "react";
import { Link } from "react-router-dom";
import { listOrders, shipOrder } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";

function openPickOrders(): PurchaseOrder[] {
  return listOrders().filter(
    (o) =>
      o.status === "Pick & Packed" &&
      (o.pendingShipment?.length ?? 0) > 0 &&
      o.pickListPrintedAt &&
      o.packingSlipPrintedAt
  );
}

export default function OpenPicks() {
  const [orders, setOrders] = useState<PurchaseOrder[]>(() => openPickOrders());
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedOrders = orders.filter((o) => selected[o.soNumber]);

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

  function confirmSelected() {
    if (selectedOrders.length === 0) return;
    const confirmedSoNumbers = new Set(selectedOrders.map((o) => o.soNumber));
    for (const o of selectedOrders) {
      shipOrder(o, o.pendingShipment ?? []);
    }
    setOrders((os) => os.filter((o) => !confirmedSoNumbers.has(o.soNumber)));
    setSelected({});
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Open Picks</h1>
        <p className="muted">
          Packed and staged, waiting on the physical pick list to come back from the warehouse so
          logistics can confirm what actually shipped.
        </p>
      </div>

      {orders.length === 0 ? (
        <p className="muted">Nothing staged right now.</p>
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
                <th>Packed</th>
                <th>Pick &amp; Pack</th>
                <th></th>
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
                  <td>{o.soNumber}</td>
                  <td>{o.poNumber}</td>
                  <td>{o.billTo.name}</td>
                  <td>{o.pickedAt ? new Date(o.pickedAt).toLocaleString() : "—"}</td>
                  <td>
                    {o.pickPackStatus && (
                      <span className={`pickpack-flag pickpack-flag-${o.pickPackStatus.toLowerCase()}`}>
                        {o.pickPackStatus}
                      </span>
                    )}
                  </td>
                  <td>
                    <Link to={`/open-picks/${o.soNumber}`} className="link-btn">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="button-row">
            <button
              type="button"
              className="primary-btn"
              disabled={selectedOrders.length === 0}
              onClick={confirmSelected}
            >
              Confirm Shipment (Selected)
            </button>
            <span className="muted">Ships exactly what was packed, no quantity changes.</span>
          </div>
        </>
      )}
    </div>
  );
}
