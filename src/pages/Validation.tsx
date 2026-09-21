import { Link } from "react-router-dom";
import { listOrders } from "../lib/orderStore";
import { orderTotal } from "../types";

export default function Validation() {
  const pending = listOrders().filter((o) => o.status === "Entered");

  return (
    <div className="page">
      <div className="page-header">
        <h1>Validation</h1>
        <p className="muted">Review each order for accuracy, then mark it checked to send it to allocation.</p>
      </div>

      <div className="toolbar">
        <p className="muted">
          {pending.length} order{pending.length === 1 ? "" : "s"} awaiting validation.
        </p>
      </div>

      {pending.length === 0 ? (
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((o) => (
              <tr key={o.soNumber}>
                <td>{o.soNumber}</td>
                <td>{o.poNumber}</td>
                <td>{o.billTo.name}</td>
                <td>{o.orderDate}</td>
                <td>${orderTotal(o).toFixed(2)}</td>
                <td>
                  <Link to={`/validation/${o.soNumber}`} className="link-btn">
                    Review
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
