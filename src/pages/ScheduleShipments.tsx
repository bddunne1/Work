import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import StatusPill from "../components/StatusPill";
import { useCanEdit } from "../lib/authContext";
import { listOrders, updateOrder } from "../lib/orderStore";
import { matchesOrderQuery, orderTotal } from "../types";

export default function ScheduleShipments() {
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState(() => listOrders());
  const filtered = useMemo(() => orders.filter((o) => matchesOrderQuery(o, query)), [orders, query]);

  function setEstimatedShipDate(soNumber: string, value: string) {
    const order = orders.find((o) => o.soNumber === soNumber);
    if (!order) return;
    const updated = { ...order, estimatedShipDate: value || undefined };
    updateOrder(updated);
    setOrders((os) => os.map((o) => (o.soNumber === soNumber ? updated : o)));
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Schedule Shipments</h1>
        <p className="muted">
          Set an estimated ship date for each order as it comes in, so logistics and the customer know
          what to expect.
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
        <p className="muted">No orders found.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Order Date</th>
              <th>Status</th>
              <th>Total</th>
              <th>Est. Ship Date</th>
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
                <td>
                  <StatusPill order={o} />
                </td>
                <td>${orderTotal(o).toFixed(2)}</td>
                <td>
                  {canEdit ? (
                    <input
                      type="date"
                      className="schedule-date-input"
                      value={o.estimatedShipDate ?? ""}
                      onChange={(e) => setEstimatedShipDate(o.soNumber, e.target.value)}
                    />
                  ) : (
                    o.estimatedShipDate || "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
