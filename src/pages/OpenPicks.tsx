import { Link } from "react-router-dom";
import { listOrders } from "../lib/orderStore";

export default function OpenPicks() {
  const orders = listOrders().filter((o) => o.status === "Pick & Packed");

  return (
    <div className="page">
      <div className="page-header">
        <h1>Open Picks</h1>
        <p className="muted">
          Packed and staged, waiting on the physical pick list to come back from the warehouse so
          logistics can confirm what actually shipped.
        </p>
      </div>

      {orders.length === 0 ? (
        <p className="muted">Nothing staged right now.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Packed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.soNumber}>
                <td>{o.soNumber}</td>
                <td>{o.poNumber}</td>
                <td>{o.billTo.name}</td>
                <td>{o.pickedAt ? new Date(o.pickedAt).toLocaleString() : "—"}</td>
                <td>
                  <Link to={`/open-picks/${o.soNumber}`} className="link-btn">
                    Confirm Shipment
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
