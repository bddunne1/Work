import { Link } from "react-router-dom";
import { listOrders } from "../lib/orderStore";
import { orderTotal } from "../types";

export default function Allocation() {
  const pending = listOrders().filter((o) => o.status === "Checked");

  return (
    <div className="page">
      <div className="page-header">
        <h1>Allocation</h1>
        <p className="muted">
          Confirm stock availability and allocate full, partial, or hold each checked order per the
          customer's shipping rules.
        </p>
      </div>

      <div className="toolbar">
        <p className="muted">
          {pending.length} order{pending.length === 1 ? "" : "s"} awaiting allocation.
        </p>
        <Link to="/back-orders" className="secondary-btn">
          Back Order Queue
        </Link>
      </div>

      {pending.length === 0 ? (
        <p className="muted">Nothing to allocate right now.</p>
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
                  <Link to={`/allocation/${o.soNumber}`} className="link-btn">
                    Allocate
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
