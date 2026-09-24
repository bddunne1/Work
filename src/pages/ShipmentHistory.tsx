import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { listOrders, undoShipment } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { itemLabel, matchesOrderQuery, orderTotal } from "../types";

function lastShippedAt(shipmentHistory: { shippedAt: string }[]): string | undefined {
  return shipmentHistory.reduce<string | undefined>(
    (latest, rec) => (!latest || rec.shippedAt > latest ? rec.shippedAt : latest),
    undefined
  );
}

function shippedOrders(orders: PurchaseOrder[]): PurchaseOrder[] {
  return orders
    .filter((o) => o.status === "Shipped")
    .sort((a, b) => {
      const aDate = lastShippedAt(a.shipmentHistory ?? []) ?? "";
      const bDate = lastShippedAt(b.shipmentHistory ?? []) ?? "";
      return bDate.localeCompare(aDate);
    });
}

export default function ShipmentHistory() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);

  useEffect(() => {
    listOrders().then((os) => setOrders(shippedOrders(os)));
  }, []);

  const filtered = useMemo(() => orders.filter((o) => matchesOrderQuery(o, query)), [orders, query]);

  async function handleUndo(order: PurchaseOrder) {
    const last = (order.shipmentHistory ?? []).at(-1);
    if (!last) return;
    const summary = last.lines.map((l) => `${itemLabel(order, l.lineItemId)} × ${l.qty}`).join(", ");
    if (
      !confirm(
        `Undo the most recent shipment on S.O. #${order.soNumber}? This restores the shipped quantities (${summary}) to on-hand inventory and moves the order back to Open Picks.`
      )
    ) {
      return;
    }
    try {
      await undoShipment(order);
    } catch (err) {
      if (isConflictError(err)) {
        alert(err.message);
        listOrders().then((os) => setOrders(shippedOrders(os)));
        return;
      }
      throw err;
    }
    setOrders((os) => os.filter((o) => o.soNumber !== order.soNumber));
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Shipment History</h1>
        <p className="muted">Orders that have shipped complete.</p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by S.O. #, P.O. #, or customer..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="muted">No orders have shipped yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Ship To</th>
              <th>Last Shipped</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const shipped = lastShippedAt(o.shipmentHistory ?? []);
              return (
                <tr
                  key={o.soNumber}
                  className="clickable-row"
                  onClick={() => navigate(`/storage/${o.soNumber}`)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
                      {o.soNumber}
                    </Link>
                  </td>
                  <td>{o.poNumber}</td>
                  <td>{o.billTo.name}</td>
                  <td>
                    {o.shipTo.city}, {o.shipTo.state}
                  </td>
                  <td>{shipped ? new Date(shipped).toLocaleString() : "—"}</td>
                  <td>${orderTotal(o).toFixed(2)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <button
                        type="button"
                        className="row-action-outline danger-link"
                        onClick={() => handleUndo(o)}
                      >
                        Undo Shipment
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
