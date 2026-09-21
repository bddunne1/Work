import { Link } from "react-router-dom";
import { listOrders } from "../lib/orderStore";
import { orderTotal } from "../types";

export default function BackOrderQueue() {
  const orders = listOrders().filter(
    (o) => o.status === "Partial Ship" || o.status === "Held - Awaiting Stock"
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Back Order Queue</h1>
        <p className="muted">
          Orders that couldn't be fully allocated. Re-check stock to re-run the allocation decision.
        </p>
      </div>

      {orders.length === 0 ? (
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.soNumber}>
                <td>{o.soNumber}</td>
                <td>{o.poNumber}</td>
                <td>{o.billTo.name}</td>
                <td>
                  <span className="status-pill">{o.status}</span>
                </td>
                <td>${orderTotal(o).toFixed(2)}</td>
                <td>
                  <Link to={`/validation/${o.soNumber}`} className="link-btn">
                    Re-check Stock
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
