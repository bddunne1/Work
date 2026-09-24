import { useEffect, useMemo, useState } from "react";
import BarList from "../components/charts/BarList";
import LineChart from "../components/charts/LineChart";
import SearchSelect from "../components/SearchSelect";
import { getAnalyticsSummary, getCustomerAnalytics } from "../lib/analyticsStore";
import type { AnalyticsSummary, CustomerAnalytics, MonthlyRevenuePoint } from "../lib/analyticsStore";
import { listCustomerSummaries } from "../lib/customerStore";
import type { Customer, OrderStatus } from "../types";

type Tab = "customer" | "inventory" | "sales";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const STATUS_ORDER: OrderStatus[] = [
  "Entered",
  "Checked",
  "Allocated",
  "Backordered",
  "Pick & Packed",
  "Shipped",
  "Cancelled",
];

const STATUS_COLORS = [
  "var(--chart-cat-1)",
  "var(--chart-cat-2)",
  "var(--chart-cat-3)",
  "var(--chart-cat-4)",
  "var(--chart-cat-5)",
  "var(--chart-cat-6)",
  // Cancelled: neutral grey, not a series hue.
  "var(--muted)",
];

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function lastNMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_LABELS[m - 1]} '${String(y).slice(2)}`;
}

function currency(v: number): string {
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const EMPTY_SUMMARY: AnalyticsSummary = {
  sales: { totalOrders: 0, totalRevenue: 0, openOrders: 0, ordersThisMonth: 0 },
  ordersByStatus: {},
  monthlyRevenue: [],
  topCustomers: [],
  inventory: { totalItems: 0, totalOnHand: 0, totalOnPO: 0, outOfStock: 0, totalValue: 0 },
  topInventoryValue: [],
  outOfStockItems: [],
};

function monthlyPoints(months: string[], series: MonthlyRevenuePoint[]) {
  const map = new Map(series.map((p) => [p.month, p.revenue]));
  return months.map((m) => ({ label: monthLabel(m), value: map.get(m) ?? 0 }));
}

// Every figure here is totalled on the server (see analyticsStore) - the
// page used to download every order ever entered to add them up itself.
export default function Analytics() {
  const [tab, setTab] = useState<Tab>("customer");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary>(EMPTY_SUMMARY);
  const [customerData, setCustomerData] = useState<{ id: string; data: CustomerAnalytics } | undefined>();
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | undefined>();
  const months12 = useMemo(() => lastNMonths(12), []);
  // The chart window ends at this (local) month; "Orders This Month" has
  // always keyed off the UTC month - both passed through unchanged.
  const analyticsWindow = useMemo(
    () => ({ endMonth: months12[months12.length - 1], thisMonth: monthKey(new Date().toISOString()), months: 12 }),
    [months12]
  );

  useEffect(() => {
    listCustomerSummaries().then(setCustomers);
    getAnalyticsSummary(analyticsWindow).then(setSummary);
  }, [analyticsWindow]);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    getCustomerAnalytics(customerId, analyticsWindow).then((data) => {
      if (!cancelled) setCustomerData({ id: customerId, data });
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, analyticsWindow]);

  const topCustomers = useMemo(
    () => summary.topCustomers.map((c) => ({ label: c.name, value: c.revenue })),
    [summary]
  );

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const customerDetail = customerData && customerData.id === customerId ? customerData.data : undefined;

  const itemsPurchased = useMemo(
    () =>
      (customerDetail?.itemsPurchased ?? []).map((i) => ({
        label: i.item,
        value: i.revenue,
        sublabel: `${i.qty} units`,
      })),
    [customerDetail]
  );

  const monthlyForCustomer = useMemo(
    () => monthlyPoints(months12, customerDetail?.monthlyRevenue ?? []),
    [customerDetail, months12]
  );

  const customerStats = useMemo(() => {
    if (!selectedCustomer || !customerDetail) return undefined;
    return {
      totalOrders: customerDetail.totalOrders,
      lifetimeRevenue: customerDetail.lifetimeRevenue,
      avgOrderValue: customerDetail.avgOrderValue,
      lastOrderDate: customerDetail.lastOrderDate ?? undefined,
    };
  }, [selectedCustomer, customerDetail]);

  const inventoryStats = summary.inventory;

  const topInventoryValue = useMemo(
    () => summary.topInventoryValue.map((i) => ({ label: i.itemNumber, value: i.value, sublabel: i.description })),
    [summary]
  );

  const outOfStockItems = summary.outOfStockItems;

  const salesStats = summary.sales;

  const ordersByStatus = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        label: status,
        value: summary.ordersByStatus[status] ?? 0,
      })),
    [summary]
  );

  const monthlyRevenueAll = useMemo(() => monthlyPoints(months12, summary.monthlyRevenue), [summary, months12]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Analytics</h1>
        <p className="muted">Customer, inventory, and sales insights.</p>
      </div>

      <div className="decision-buttons analytics-tabs">
        <button
          type="button"
          className={`decision-btn ${tab === "customer" ? "selected" : ""}`}
          onClick={() => setTab("customer")}
        >
          Customer Insights
        </button>
        <button
          type="button"
          className={`decision-btn ${tab === "inventory" ? "selected" : ""}`}
          onClick={() => setTab("inventory")}
        >
          Inventory Insights
        </button>
        <button
          type="button"
          className={`decision-btn ${tab === "sales" ? "selected" : ""}`}
          onClick={() => setTab("sales")}
        >
          Sales Insights
        </button>
      </div>

      {tab === "customer" && (
        <>
          <section className="lane-section">
            <h2 className="lane-title" style={{ borderColor: "#4c6ff5" }}>
              Top Customers by Revenue
            </h2>
            <BarList items={topCustomers} valueFormatter={currency} emptyMessage="No order revenue yet." />
          </section>

          <section className="lane-section">
            <h2 className="lane-title" style={{ borderColor: "#4c6ff5" }}>
              Customer Detail
            </h2>
            <div className="customer-picker">
              <label htmlFor="analytics-customer-search">Customer</label>
              <SearchSelect
                id="analytics-customer-search"
                options={customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.accountNumber }))}
                value={customerQuery}
                onQueryChange={setCustomerQuery}
                onSelect={(id) => {
                  setCustomerId(id);
                  const c = customers.find((x) => x.id === id);
                  if (c) setCustomerQuery(c.name);
                }}
                placeholder="Search customers by name or account #..."
              />
            </div>

            {!selectedCustomer || !customerStats ? (
              <p className="muted">
                {selectedCustomer ? "Loading..." : "Select a customer to see their purchase history."}
              </p>
            ) : (
              <>
                <div className="stat-row analytics-stat-row">
                  <div className="stat-card">
                    <div className="stat-value">{customerStats.totalOrders}</div>
                    <div className="stat-label">Total Orders</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{currency(customerStats.lifetimeRevenue)}</div>
                    <div className="stat-label">Lifetime Revenue</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{currency(customerStats.avgOrderValue)}</div>
                    <div className="stat-label">Avg Order Value</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{customerStats.lastOrderDate ?? "—"}</div>
                    <div className="stat-label">Last Order Date</div>
                  </div>
                </div>

                <h3 className="analytics-subtitle">Items Purchased</h3>
                <BarList items={itemsPurchased} valueFormatter={currency} emptyMessage="No purchases yet." />

                <h3 className="analytics-subtitle">Monthly Order Amounts</h3>
                <LineChart points={monthlyForCustomer} valueFormatter={currency} />
              </>
            )}
          </section>
        </>
      )}

      {tab === "inventory" && (
        <>
          <section className="lane-section">
            <div className="stat-row analytics-stat-row">
              <div className="stat-card">
                <div className="stat-value">{inventoryStats.totalItems}</div>
                <div className="stat-label">Total Items</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{inventoryStats.totalOnHand}</div>
                <div className="stat-label">Units On Hand</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{inventoryStats.totalOnPO}</div>
                <div className="stat-label">Units On PO</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{currency(inventoryStats.totalValue)}</div>
                <div className="stat-label">On-Hand Value</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{inventoryStats.outOfStock}</div>
                <div className="stat-label">Out of Stock</div>
              </div>
            </div>
          </section>

          <section className="lane-section">
            <h2 className="lane-title" style={{ borderColor: "#f59f00" }}>
              Top Items by On-Hand Value
            </h2>
            <BarList items={topInventoryValue} valueFormatter={currency} emptyMessage="No inventory value yet." />
          </section>

          {outOfStockItems.length > 0 && (
            <section className="lane-section">
              <h2 className="lane-title" style={{ borderColor: "#f59f00" }}>
                Out of Stock
              </h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item #</th>
                    <th>Description</th>
                    <th>On PO</th>
                  </tr>
                </thead>
                <tbody>
                  {outOfStockItems.map((i) => (
                    <tr key={i.id}>
                      <td>{i.itemNumber}</td>
                      <td>{i.description}</td>
                      <td>{i.qtyOnPurchaseOrder}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {tab === "sales" && (
        <>
          <section className="lane-section">
            <div className="stat-row analytics-stat-row">
              <div className="stat-card">
                <div className="stat-value">{salesStats.totalOrders}</div>
                <div className="stat-label">Total Orders</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{currency(salesStats.totalRevenue)}</div>
                <div className="stat-label">Total Revenue</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{salesStats.openOrders}</div>
                <div className="stat-label">Open Orders</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{salesStats.ordersThisMonth}</div>
                <div className="stat-label">Orders This Month</div>
              </div>
            </div>
          </section>

          <section className="lane-section">
            <h2 className="lane-title" style={{ borderColor: "#12b886" }}>
              Monthly Revenue
            </h2>
            <LineChart points={monthlyRevenueAll} valueFormatter={currency} />
          </section>

          <section className="lane-section">
            <h2 className="lane-title" style={{ borderColor: "#12b886" }}>
              Orders by Status
            </h2>
            <BarList items={ordersByStatus} colorFor={(_item, idx) => STATUS_COLORS[idx]} emptyMessage="No orders yet." />
          </section>
        </>
      )}
    </div>
  );
}
