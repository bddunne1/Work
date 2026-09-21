import { Link } from "react-router-dom";
import { listCustomers } from "../lib/customerStore";
import { listItems } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";

interface Module {
  name: string;
  description: string;
  to?: string;
}

interface Lane {
  lane: string;
  color: string;
  modules: Module[];
}

const LANES: Lane[] = [
  {
    lane: "Master Data",
    color: "#f59f00",
    modules: [
      { name: "Customers", description: "Manage customer billing, shipping, and terms", to: "/customers" },
      { name: "Items", description: "Manage the item catalog for order entry", to: "/items" },
    ],
  },
  {
    lane: "Order Prep",
    color: "#12b886",
    modules: [
      { name: "Order Entry", description: "Enter a new sales order from a customer PO", to: "/order-entry" },
      {
        name: "Validation",
        description: "Review each order for accuracy, then mark it checked",
        to: "/validation",
      },
      {
        name: "Allocation",
        description: "Check stock and allocate full, partial, or hold each checked order",
        to: "/allocation",
      },
      {
        name: "Back Order Queue",
        description: "Backordered orders waiting on stock",
        to: "/back-orders",
      },
      {
        name: "Create Labels",
        description: "Generate a shipping label for each allocated order",
        to: "/labels",
      },
    ],
  },
  {
    lane: "Fulfillment",
    color: "#7c6ff2",
    modules: [
      { name: "Pick & Pack", description: "Pick list generation and packing" },
      { name: "Check Order & Wrap / Pack", description: "Final QC, wrap, and pack" },
    ],
  },
  {
    lane: "Logistics",
    color: "#f06595",
    modules: [
      { name: "Schedule Shipment", description: "Contact customer, book carrier pickup" },
      { name: "Truck / UPS / FedEx Pickup", description: "Hand off to carrier with BOL" },
    ],
  },
];

export default function Dashboard() {
  const orders = listOrders();
  const recent = orders.slice(0, 5);
  const customerCount = listCustomers().length;
  const itemCount = listItems().length;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="muted">Pick a stage of the order workflow to get started.</p>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-value">{orders.length}</div>
          <div className="stat-label">Orders in Storage</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{orders.filter((o) => o.status === "Entered").length}</div>
          <div className="stat-label">Awaiting Validation</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{orders.filter((o) => o.status === "Checked").length}</div>
          <div className="stat-label">Awaiting Allocation</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{orders.filter((o) => o.status === "Backordered").length}</div>
          <div className="stat-label">Back Order Queue</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{customerCount}</div>
          <div className="stat-label">Customers</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{itemCount}</div>
          <div className="stat-label">Items</div>
        </div>
      </div>

      {LANES.map((lane) => (
        <section key={lane.lane} className="lane-section">
          <h2 className="lane-title" style={{ borderColor: lane.color }}>
            {lane.lane}
          </h2>
          <div className="module-grid">
            {lane.modules.map((m) =>
              m.to ? (
                <Link key={m.name} to={m.to} className="module-card active">
                  <div className="module-name">{m.name}</div>
                  <div className="module-desc">{m.description}</div>
                </Link>
              ) : (
                <div key={m.name} className="module-card disabled">
                  <div className="module-name">{m.name}</div>
                  <div className="module-desc">{m.description}</div>
                  <div className="module-badge">Coming soon</div>
                </div>
              )
            )}
          </div>
        </section>
      ))}

      <section className="lane-section">
        <h2 className="lane-title" style={{ borderColor: "#4c6ef5" }}>
          Recent Orders
        </h2>
        {recent.length === 0 ? (
          <p className="muted">No orders entered yet. Start with Order Entry above.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>S.O. #</th>
                <th>P.O. #</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((o) => (
                <tr key={o.soNumber}>
                  <td>
                    <Link to={`/storage/${o.soNumber}`}>{o.soNumber}</Link>
                  </td>
                  <td>{o.poNumber}</td>
                  <td>{o.billTo.name}</td>
                  <td>{o.orderDate}</td>
                  <td>
                    <span className="status-pill">{o.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p>
          <Link to="/storage">Browse all orders &rarr;</Link>
        </p>
      </section>
    </div>
  );
}
