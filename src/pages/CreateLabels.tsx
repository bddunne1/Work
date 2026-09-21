import { Link } from "react-router-dom";
import { listOrders } from "../lib/orderStore";

export default function CreateLabels() {
  const orders = listOrders().filter((o) => o.status === "Allocated");

  return (
    <div className="page">
      <div className="page-header">
        <h1>Create Labels</h1>
        <p className="muted">Allocated orders ready for a shipping label.</p>
      </div>

      {orders.length === 0 ? (
        <p className="muted">No allocated orders waiting on a label.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Ship Via</th>
              <th>Label</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.soNumber}>
                <td>{o.soNumber}</td>
                <td>{o.poNumber}</td>
                <td>{o.shipTo.name}</td>
                <td>{o.shipVia}</td>
                <td>
                  {o.labelPrintedAt ? (
                    <span className="status-pill">Printed</span>
                  ) : (
                    <span className="muted">Not printed</span>
                  )}
                </td>
                <td>
                  <Link to={`/labels/${o.soNumber}`} className="link-btn">
                    {o.labelPrintedAt ? "Reprint" : "Create Label"}
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
