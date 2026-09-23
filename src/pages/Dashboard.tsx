import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import StatusPill from "../components/StatusPill";
import { useAuth } from "../lib/authContext";
import { listCustomers } from "../lib/customerStore";
import { listItems } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";
import { getAccessLevel } from "../lib/permissions";
import { getLeadTimeDays, setLeadTimeDays } from "../lib/settingsStore";

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
    lane: "Data",
    color: "#f59f00",
    modules: [
      { name: "Customers", description: "Manage customer billing, shipping, and terms", to: "/customers" },
      { name: "Items", description: "Manage the item catalog for order entry", to: "/items" },
      {
        name: "Inventory",
        description: "Track quantity on hand, on sales order, and on purchase order per item",
        to: "/inventory",
      },
      {
        name: "Import Data",
        description: "Upload a spreadsheet to bulk-load customers, items, sales orders, or inventory",
        to: "/import",
      },
      {
        name: "Analytics",
        description: "Customer, inventory, and sales insights with charts",
        to: "/analytics",
      },
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
        description: "Shipping labels or our own / private-label product labels",
        to: "/labels",
      },
      {
        name: "Returns",
        description: "Record a customer return and generate a Return Authorization form",
        to: "/returns",
      },
    ],
  },
  {
    lane: "Fulfillment",
    color: "#7c6ff2",
    modules: [
      {
        name: "Pick & Pack",
        description: "Pick allocated orders, then print pick lists and packing slips for the queue",
        to: "/pick-pack",
      },
      {
        name: "Open Picks",
        description: "Fully printed orders, ready to confirm shipment (single or batch)",
        to: "/open-picks",
      },
    ],
  },
  {
    lane: "Logistics",
    color: "#f06595",
    modules: [
      {
        name: "Schedule Shipment",
        description: "Set an estimated ship date for each order, or view them on a calendar",
        to: "/schedule",
      },
      {
        name: "Generate BOL",
        description: "Create a Bill of Lading for one or more orders with weight, dimensions, and skids",
        to: "/bol",
      },
      {
        name: "Shipment History",
        description: "Orders that have shipped complete",
        to: "/shipment-history",
      },
    ],
  },
  {
    lane: "Purchasing",
    color: "#0ca678",
    modules: [
      {
        name: "Purchase Orders",
        description: "Create and track outbound orders to vendors",
        to: "/purchase-orders",
      },
      {
        name: "Receiving",
        description: "Receive stock against an open purchase order",
        to: "/receiving",
      },
      { name: "Vendors", description: "Manage supplier contacts", to: "/vendors" },
    ],
  },
  {
    lane: "Administration",
    color: "#495057",
    modules: [{ name: "Accounts", description: "Manage user accounts and roles", to: "/accounts" }],
  },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { account } = useAuth();
  const orders = listOrders();
  const recent = orders.slice(0, 5);
  const [customerCount, setCustomerCount] = useState(0);
  const itemCount = listItems().length;
  const [leadTime, setLeadTime] = useState(() => getLeadTimeDays());

  useEffect(() => {
    listCustomers().then((cs) => setCustomerCount(cs.length));
  }, []);
  const visibleLanes = LANES.map((lane) => ({
    ...lane,
    modules: lane.modules.filter((m) => !m.to || getAccessLevel(m.to, account!) !== "none"),
  })).filter((lane) => lane.modules.length > 0);

  function handleLeadTimeChange(value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    setLeadTime(value);
    setLeadTimeDays(value);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Hello {account!.username},</h1>
        <p className="muted">Pick a stage of the order workflow to get started.</p>
      </div>

      <div className="lead-time-panel">
        <div>
          <div className="lead-time-label">Current Lead Time</div>
          <p className="muted lead-time-hint">
            Business days (weekends excluded) from order date to estimated ship date, applied to every
            new order at entry. Changing this does not affect orders already entered.
          </p>
        </div>
        <div className="lead-time-input-row">
          <input
            type="number"
            min={0}
            className="lead-time-input"
            value={leadTime}
            onChange={(e) => handleLeadTimeChange(Number(e.target.value))}
          />
          <span className="muted">business days</span>
        </div>
      </div>

      <div className="stat-row">
        {[
          {
            label: "Open Orders",
            value: orders.filter((o) => o.status !== "Shipped").length,
            to: "/open-orders",
            color: "#4c6ef5",
          },
          {
            label: "Awaiting Validation",
            value: orders.filter((o) => o.status === "Entered").length,
            to: "/validation",
            color: "#64748b",
          },
          {
            label: "Awaiting Allocation",
            value: orders.filter((o) => o.status === "Checked").length,
            to: "/allocation",
            color: "#4c6ef5",
          },
          {
            label: "Back Order Queue",
            value: orders.filter((o) => o.status === "Backordered").length,
            to: "/back-orders",
            color: "#e8590c",
          },
          {
            label: "Ready to Pick",
            value: orders.filter((o) => o.status === "Allocated").length,
            to: "/pick-pack",
            color: "#e03131",
          },
          {
            label: "Open Picks",
            value: orders.filter((o) => o.status === "Pick & Packed").length,
            to: "/open-picks",
            color: "#5f3dc4",
          },
          { label: "Customers", value: customerCount, to: "/customers/all", color: "#4338ca" },
          { label: "Items", value: itemCount, to: "/items", color: "#b45309" },
        ].map((s) => (
          <Link
            key={s.label}
            to={s.to}
            className="stat-card"
            style={{ "--stat-color": s.color } as React.CSSProperties}
          >
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </Link>
        ))}
      </div>

      {visibleLanes.map((lane) => (
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
                <tr
                  key={o.soNumber}
                  className="clickable-row"
                  onClick={() => navigate(`/storage/${o.soNumber}`)}
                >
                  <td>{o.soNumber}</td>
                  <td>{o.poNumber}</td>
                  <td>{o.billTo.name}</td>
                  <td>{o.orderDate}</td>
                  <td>
                    <StatusPill order={o} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p>
          <Link to="/open-orders">Browse open orders &rarr;</Link>
        </p>
      </section>
    </div>
  );
}
