import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import StatusPill from "../components/StatusPill";
import { listOrders } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { matchesOrderQuery, orderTotal } from "../types";

interface Props {
  closed: boolean;
}

export default function OrdersList({ closed }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);

  useEffect(() => {
    listOrders().then(setAllOrders);
  }, []);

  const orders = useMemo(() => allOrders.filter((o) => (o.status === "Shipped") === closed), [allOrders, closed]);

  const filtered = useMemo(() => orders.filter((o) => matchesOrderQuery(o, query)), [orders, query]);

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
              <tr
                key={o.soNumber}
                className="clickable-row"
                onClick={() => navigate(`/storage/${o.soNumber}`)}
              >
                <td>{o.soNumber}</td>
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
