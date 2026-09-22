import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listOrders } from "../lib/orderStore";
import { matchesOrderQuery, orderTotal } from "../types";

function lastShippedAt(shipmentHistory: { shippedAt: string }[]): string | undefined {
  return shipmentHistory.reduce<string | undefined>(
    (latest, rec) => (!latest || rec.shippedAt > latest ? rec.shippedAt : latest),
    undefined
  );
}

export default function ShipmentHistory() {
  const [query, setQuery] = useState("");
  const orders = listOrders()
    .filter((o) => o.status === "Shipped")
    .sort((a, b) => {
      const aDate = lastShippedAt(a.shipmentHistory ?? []) ?? "";
      const bDate = lastShippedAt(b.shipmentHistory ?? []) ?? "";
      return bDate.localeCompare(aDate);
    });
  const filtered = useMemo(() => orders.filter((o) => matchesOrderQuery(o, query)), [orders, query]);

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
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const shipped = lastShippedAt(o.shipmentHistory ?? []);
              return (
                <tr key={o.soNumber}>
                  <td>
                    <Link to={`/storage/${o.soNumber}`}>{o.soNumber}</Link>
                  </td>
                  <td>{o.poNumber}</td>
                  <td>{o.billTo.name}</td>
                  <td>
                    {o.shipTo.city}, {o.shipTo.state}
                  </td>
                  <td>{shipped ? new Date(shipped).toLocaleString() : "—"}</td>
                  <td>${orderTotal(o).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
