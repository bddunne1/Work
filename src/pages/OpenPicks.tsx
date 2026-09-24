import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isConflictError } from "../lib/apiClient";
import { listItems } from "../lib/itemStore";
import { listOrders, shipOrder } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { pendingShipmentWeight, weightIndex } from "../types";

function openPickOrders(orders: PurchaseOrder[]): PurchaseOrder[] {
  return orders.filter(
    (o) =>
      o.status === "Pick & Packed" &&
      (o.pendingShipment?.length ?? 0) > 0 &&
      o.pickListPrintedAt &&
      o.packingSlipPrintedAt
  );
}

function daysInWarehouse(pickedAt: string): number {
  return (Date.now() - new Date(pickedAt).getTime()) / 86_400_000;
}

export default function OpenPicks() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [weights, setWeights] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    listItems().then((items) => setWeights(weightIndex(items)));
    listOrders().then((os) => setOrders(openPickOrders(os)));
  }, []);

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

  async function confirmSelected() {
    if (selectedOrders.length === 0) return;
    const confirmedSoNumbers = new Set(selectedOrders.map((o) => o.soNumber));
    try {
      for (const o of selectedOrders) {
        await shipOrder(o, o.pendingShipment ?? []);
      }
    } catch (err) {
      if (isConflictError(err)) {
        alert(`${err.message} Some selected orders may not have shipped - review and retry.`);
        listOrders().then((os) => setOrders(openPickOrders(os)));
        return;
      }
      throw err;
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
                <th>Days in Warehouse</th>
                <th>Weight</th>
                <th>Pick &amp; Pack</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.soNumber}
                  className="clickable-row"
                  onClick={() => navigate(`/open-picks/${o.soNumber}`)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={Boolean(selected[o.soNumber])}
                      onChange={() => toggleSelected(o.soNumber)}
                      aria-label={`Select S.O. ${o.soNumber}`}
                    />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
                      {o.soNumber}
                    </Link>
                  </td>
                  <td>{o.poNumber}</td>
                  <td>{o.billTo.name}</td>
                  <td>{o.pickedAt ? new Date(o.pickedAt).toLocaleString() : "—"}</td>
                  <td>{o.pickedAt ? `${daysInWarehouse(o.pickedAt).toFixed(1)} d` : "—"}</td>
                  <td className="amount-cell">{pendingShipmentWeight(o, weights).toFixed(0)} lbs</td>
                  <td>
                    {o.pickPackStatus && (
                      <span className={`pickpack-flag pickpack-flag-${o.pickPackStatus.toLowerCase()}`}>
                        {o.pickPackStatus}
                      </span>
                    )}
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
