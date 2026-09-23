import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusPill from "../components/StatusPill";
import { listOrders } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { matchesOrderQuery, orderTotal } from "../types";

export default function BackOrderQueue() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);

  useEffect(() => {
    listOrders().then(setAllOrders);
  }, []);

  const orders = useMemo(() => allOrders.filter((o) => o.status === "Backordered"), [allOrders]);
  const filtered = useMemo(() => orders.filter((o) => matchesOrderQuery(o, query)), [orders, query]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Back Order Queue</h1>
        <p className="muted">
          Orders that couldn't be fully allocated. Re-check stock to re-run the allocation decision.
        </p>
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
        <p className="muted">No orders waiting on stock.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr
                key={o.soNumber}
                className="clickable-row"
                onClick={() => navigate(`/allocation/${o.soNumber}`)}
              >
                <td>{o.soNumber}</td>
                <td>{o.poNumber}</td>
                <td>{o.billTo.name}</td>
                <td>
                  <StatusPill order={o} />
                </td>
                <td>${orderTotal(o).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
