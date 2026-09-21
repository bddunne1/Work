import { Link } from "react-router-dom";
import StatusPill from "../components/StatusPill";
import { listOrders } from "../lib/orderStore";

export default function PickPack() {
  const orders = listOrders().filter((o) => o.status === "Allocated");

  return (
    <div className="page">
      <div className="page-header">
        <h1>Pick &amp; Pack</h1>
        <p className="muted">
          Orders ready to pick, full or partial allocation alike. A partial pack is flagged once it's
          packed so logistics can see at a glance what still needs a follow-up shipment.
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
                  <StatusPill order={o} />
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
