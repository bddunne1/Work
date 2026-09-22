import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import StatusPill from "../components/StatusPill";
import { listOrders } from "../lib/orderStore";
import { orderTotal } from "../types";

interface Props {
  closed: boolean;
}

export default function OrdersList({ closed }: Props) {
  const [query, setQuery] = useState("");
  const orders = listOrders().filter((o) => (o.status === "Shipped") === closed);

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
        <h1>{closed ? "Closed Orders" : "Open Orders"}</h1>
        <p className="muted">
          {closed
            ? "Orders that have shipped complete."
            : "Orders still moving through validation, allocation, and fulfillment."}
        </p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by S.O. #, P.O. #, or customer..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="inline-actions">
          <Link to={closed ? "/open-orders" : "/closed-orders"} className="secondary-btn">
            {closed ? "View Open Orders" : "View Closed Orders"}
          </Link>
          <Link to="/order-entry" className="primary-btn">
            + New Order
          </Link>
        </div>
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
