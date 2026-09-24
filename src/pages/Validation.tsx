import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listOpenOrders } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { matchesOrderQuery, orderTotal } from "../types";

export default function Validation() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);

  useEffect(() => {
    listOpenOrders().then(setAllOrders);
  }, []);

  const pending = useMemo(() => allOrders.filter((o) => o.status === "Entered"), [allOrders]);
  const filtered = useMemo(() => pending.filter((o) => matchesOrderQuery(o, query)), [pending, query]);

  function startQueue() {
    if (pending.length === 0) return;
    const queue = pending.map((o) => o.soNumber);
    navigate(`/validation/${queue[0]}`, { state: { queue, pos: 0 } });
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Validation</h1>
        <p className="muted">Review each order for accuracy, then mark it checked to send it to allocation.</p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by S.O. #, P.O. #, or customer..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="inline-actions">
          <p className="muted">
            {pending.length} order{pending.length === 1 ? "" : "s"} awaiting validation.
          </p>
          <button type="button" className="primary-btn" disabled={pending.length === 0} onClick={startQueue}>
            Review Queue
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="muted">Nothing to validate right now.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Order Date</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr
                key={o.soNumber}
                className="clickable-row"
                onClick={() => navigate(`/validation/${o.soNumber}`)}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
                    {o.soNumber}
                  </Link>
                </td>
                <td>{o.poNumber}</td>
                <td>{o.billTo.name}</td>
                <td>{o.orderDate}</td>
                <td>${orderTotal(o).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
