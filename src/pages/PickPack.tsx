import { Link } from "react-router-dom";
import { listOrders } from "../lib/orderStore";
import { hasAnyAllocatedQty } from "../types";

export default function PickPack() {
  const orders = listOrders().filter(
    (o) => o.status === "Allocated" || (o.status === "Backordered" && hasAnyAllocatedQty(o))
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Pick &amp; Pack</h1>
        <p className="muted">
          Orders ready to pick. Backordered orders appear here too when part of the order was allocated
          for a partial shipment.
        </p>
      </div>

      {orders.length === 0 ? (
        <p className="muted">Nothing ready to pick right now.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Status</th>
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
                <td>
                  <Link to={`/pick-pack/${o.soNumber}`} className="link-btn">
                    Pick List
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
