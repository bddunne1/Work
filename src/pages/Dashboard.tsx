import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import StatusPill from "../components/StatusPill";
import {
  AccountsIcon,
  ActivityLogIcon,
  AllocationIcon,
  AnalyticsIcon,
  BackOrderIcon,
  BolIcon,
  CatalogIcon,
  CustomersIcon,
  InventoryIcon,
  LabelsIcon,
  OpenPicksIcon,
  OrderEntryIcon,
  PickPackIcon,
  PurchaseOrdersIcon,
  ReceivingIcon,
  ReturnsIcon,
  ScheduleIcon,
  SettingsIcon,
  ShipmentHistoryIcon,
  ValidationIcon,
  VendorsIcon,
  WarehouseIcon,
} from "../components/SidebarIcons";
import { useAuth } from "../lib/authContext";
import { listCustomers } from "../lib/customerStore";
import { listItems } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";
import { getAccessLevel } from "../lib/permissions";
import { getLeadTimeDays } from "../lib/settingsStore";
import type { PurchaseOrder } from "../types";
import type { ComponentType, SVGProps } from "react";

interface Module {
  name: string;
  description: string;
  to: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
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
      {
        name: "Customers",
        description: "Manage customer billing, shipping, and terms",
        to: "/customers",
        icon: CustomersIcon,
      },
      { name: "Items", description: "Manage the item catalog for order entry", to: "/items", icon: CatalogIcon },
      {
        name: "Inventory",
        description: "Track quantity on hand, on sales order, and on purchase order per item",
        to: "/inventory",
        icon: InventoryIcon,
      },
      {
        name: "Analytics",
        description: "Customer, inventory, and sales insights with charts",
        to: "/analytics",
        icon: AnalyticsIcon,
      },
    ],
  },
  {
    lane: "Order Prep",
    color: "#12b886",
    modules: [
      {
        name: "Order Entry",
        description: "Enter a new sales order from a customer PO",
        to: "/order-entry",
        icon: OrderEntryIcon,
      },
      {
        name: "Validation",
        description: "Review each order for accuracy, then mark it checked",
        to: "/validation",
        icon: ValidationIcon,
      },
      {
        name: "Allocation",
        description: "Check stock and allocate full, partial, or hold each checked order",
        to: "/allocation",
        icon: AllocationIcon,
      },
      {
        name: "Back Order Queue",
        description: "Backordered orders waiting on stock",
        to: "/back-orders",
        icon: BackOrderIcon,
      },
      {
        name: "Create Labels",
        description: "Shipping labels or our own / private-label product labels",
        to: "/labels",
        icon: LabelsIcon,
      },
      {
        name: "Returns",
        description: "Record a customer return and generate a Return Authorization form",
        to: "/returns",
        icon: ReturnsIcon,
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
        icon: PickPackIcon,
      },
      {
        name: "Open Picks",
        description: "Fully printed orders, ready to confirm shipment (single or batch)",
        to: "/open-picks",
        icon: OpenPicksIcon,
      },
      {
        name: "Warehouse Capacity",
        description: "How much weight is on the floor, how long it dwells, and when it's safe to release more",
        to: "/warehouse-capacity",
        icon: WarehouseIcon,
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
        icon: ScheduleIcon,
      },
      {
        name: "Generate BOL",
        description: "Generate a standard Bill of Lading for one or more orders - carrier, freight terms, and commodity details",
        to: "/bol",
        icon: BolIcon,
      },
      {
        name: "Shipment History",
        description: "Orders that have shipped complete",
        to: "/shipment-history",
        icon: ShipmentHistoryIcon,
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
        icon: PurchaseOrdersIcon,
      },
      {
        name: "Receiving",
        description: "Receive stock against an open purchase order",
        to: "/receiving",
        icon: ReceivingIcon,
      },
      { name: "Vendors", description: "Manage supplier contacts", to: "/vendors", icon: VendorsIcon },
    ],
  },
  {
    lane: "Administration",
    color: "#495057",
    modules: [
      { name: "Accounts", description: "Manage user accounts and roles", to: "/accounts", icon: AccountsIcon },
      {
        name: "Settings",
        description: "Company profile, order defaults, and document numbering",
        to: "/settings",
        icon: SettingsIcon,
      },
      {
        name: "Activity Log",
        description: "Who logged in, and every account created, changed, or removed",
        to: "/audit-log",
        icon: ActivityLogIcon,
      },
    ],
  },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { account } = useAuth();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const recent = orders.slice(0, 5);
  const [customerCount, setCustomerCount] = useState(0);
  const [itemCount, setItemCount] = useState(0);
  const leadTime = getLeadTimeDays();
  const canEditSettings = getAccessLevel("/settings", account!) === "edit";

  useEffect(() => {
    listCustomers().then((cs) => setCustomerCount(cs.length));
    listItems().then((items) => setItemCount(items.length));
    listOrders().then(setOrders);
  }, []);
  const visibleLanes = LANES.map((lane) => ({
    ...lane,
    modules: lane.modules.filter((m) => getAccessLevel(m.to, account!) !== "none"),
  })).filter((lane) => lane.modules.length > 0);

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
            {canEditSettings && (
              <>
                {" "}
                <Link to="/settings">Change it in Settings.</Link>
              </>
            )}
          </p>
        </div>
        <div className="lead-time-input-row">
          <span className="lead-time-value">{leadTime}</span>
          <span className="muted">business days</span>
        </div>
      </div>

      <div className="stat-row">
        {[
          {
            label: "Open Orders",
            value: orders.filter((o) => o.status !== "Shipped").length,
            to: "/open-orders",
            color: "#2f9e44",
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

      <div className="stat-row stat-row-secondary">
        {[
          { label: "Customers", value: customerCount, to: "/customers/all", color: "#f2b705" },
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
        <section
          key={lane.lane}
          className="lane-section"
          style={{ "--lane-color": lane.color } as React.CSSProperties}
        >
          <div className="lane-band" />
          <h2 className="lane-title">{lane.lane}</h2>
          <div className="hub-card-grid hub-card-grid-compact">
            {lane.modules.map((m) => (
              <Link
                key={m.name}
                to={m.to}
                className="hub-card hub-card-compact"
                style={{ "--page-accent": lane.color } as React.CSSProperties}
              >
                <div className="hub-card-body">
                  <div className="hub-card-name">{m.name}</div>
                  <div className="hub-card-desc">{m.description}</div>
                </div>
                <div className="hub-card-icon">
                  <m.icon />
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section className="lane-section" style={{ "--lane-color": "#4c6ef5" } as React.CSSProperties}>
        <div className="lane-band" />
        <h2 className="lane-title">Recent Orders
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
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
                      {o.soNumber}
                    </Link>
                  </td>
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
