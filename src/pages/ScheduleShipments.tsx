import { useState } from "react";
import { Link } from "react-router-dom";
import StatusPill from "../components/StatusPill";
import { listOrders, updateOrder } from "../lib/orderStore";
import { orderTotal } from "../types";

export default function ScheduleShipments() {
  const [orders, setOrders] = useState(() => listOrders());

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

      {orders.length === 0 ? (
        <p className="muted">No orders yet.</p>
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
            {orders.map((o) => (
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
                  <input
                    type="date"
                    className="schedule-date-input"
                    value={o.estimatedShipDate ?? ""}
                    onChange={(e) => setEstimatedShipDate(o.soNumber, e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
