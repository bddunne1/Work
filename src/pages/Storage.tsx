import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listOrders } from "../lib/orderStore";
import { orderTotal } from "../types";

export default function Storage() {
  const [query, setQuery] = useState("");
  const orders = listOrders();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        o.soNumber.toLowerCase().includes(q) ||
        o.poNumber.toLowerCase().includes(q) ||
        o.billTo.name.toLowerCase().includes(q)
    );
  }, [orders, query]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Storage</h1>
        <p className="muted">Browse purchase orders that have been entered.</p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by S.O. #, P.O. #, or customer..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Link to="/order-entry" className="primary-btn">
          + New Order
        </Link>
      </div>

      {filtered.length === 0 ? (
        <p className="muted">No orders found.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Order Date</th>
              <th>Ship Via</th>
              <th>Status</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.soNumber}>
                <td>
                  <Link to={`/storage/${o.soNumber}`}>{o.soNumber}</Link>
                </td>
                <td>{o.poNumber}</td>
                <td>{o.billTo.name}</td>
                <td>{o.orderDate}</td>
                <td>{o.shipVia}</td>
                <td>
                  <span className="status-pill">{o.status}</span>
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
