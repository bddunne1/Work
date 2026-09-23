import { useEffect, useMemo, useState } from "react";
import BarList from "../components/charts/BarList";
import LineChart from "../components/charts/LineChart";
import SearchSelect from "../components/SearchSelect";
import { listCustomers } from "../lib/customerStore";
import { listItems } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";
import type { Customer, Item, OrderStatus, PurchaseOrder } from "../types";
import { orderTotal } from "../types";

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
];

const STATUS_COLORS = [
  "var(--chart-cat-1)",
  "var(--chart-cat-2)",
  "var(--chart-cat-3)",
  "var(--chart-cat-4)",
  "var(--chart-cat-5)",
  "var(--chart-cat-6)",
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

export default function Analytics() {
  const [tab, setTab] = useState<Tab>("customer");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders] = useState<PurchaseOrder[]>(() => listOrders());
  const [items, setItems] = useState<Item[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | undefined>();
  const months12 = useMemo(() => lastNMonths(12), []);

  useEffect(() => {
    listCustomers().then(setCustomers);
    listItems().then(setItems);
  }, []);

  const revenueByCustomer = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      if (!o.customerId) continue;
      map.set(o.customerId, (map.get(o.customerId) ?? 0) + orderTotal(o));
    }
    return map;
  }, [orders]);

  const topCustomers = useMemo(
    () =>
      customers
        .map((c) => ({ label: c.name, value: revenueByCustomer.get(c.id) ?? 0 }))
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
    [customers, revenueByCustomer]
  );

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const customerOrders = useMemo(
    () => (customerId ? orders.filter((o) => o.customerId === customerId) : []),
    [orders, customerId]
  );

  const itemsPurchased = useMemo(() => {
    const map = new Map<string, { qty: number; revenue: number }>();
    for (const o of customerOrders) {
      for (const li of o.lineItems) {
        const entry = map.get(li.item) ?? { qty: 0, revenue: 0 };
        entry.qty += li.ordered;
        entry.revenue += li.ordered * li.rate;
        map.set(li.item, entry);
      }
    }
    return Array.from(map.entries())
      .map(([item, v]) => ({ label: item, value: v.revenue, sublabel: `${v.qty} units` }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [customerOrders]);

  const monthlyForCustomer = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of customerOrders) {
      map.set(monthKey(o.orderDate), (map.get(monthKey(o.orderDate)) ?? 0) + orderTotal(o));
    }
    return months12.map((m) => ({ label: monthLabel(m), value: map.get(m) ?? 0 }));
  }, [customerOrders, months12]);

  const customerStats = useMemo(() => {
    if (!selectedCustomer) return undefined;
    const totalRevenue = customerOrders.reduce((s, o) => s + orderTotal(o), 0);
    return {
      totalOrders: customerOrders.length,
      lifetimeRevenue: totalRevenue,
      avgOrderValue: customerOrders.length ? totalRevenue / customerOrders.length : 0,
      lastOrderDate: customerOrders.reduce<string | undefined>(
        (latest, o) => (!latest || o.orderDate > latest ? o.orderDate : latest),
        undefined
      ),
    };
  }, [selectedCustomer, customerOrders]);

  const inventoryStats = useMemo(() => {
    const totalOnHand = items.reduce((s, i) => s + i.qtyOnHand, 0);
    const totalOnPO = items.reduce((s, i) => s + i.qtyOnPurchaseOrder, 0);
    const outOfStock = items.filter((i) => i.qtyOnHand <= 0).length;
    const totalValue = items.reduce((s, i) => s + i.qtyOnHand * i.rate, 0);
    return { totalOnHand, totalOnPO, outOfStock, totalValue };
  }, [items]);

  const topInventoryValue = useMemo(
    () =>
      items
        .map((i) => ({ label: i.itemNumber, value: i.qtyOnHand * i.rate, sublabel: i.description }))
        .filter((i) => i.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    [items]
  );

  const outOfStockItems = useMemo(() => items.filter((i) => i.qtyOnHand <= 0).slice(0, 10), [items]);

  const salesStats = useMemo(() => {
    const totalRevenue = orders.reduce((s, o) => s + orderTotal(o), 0);
    const openOrders = orders.filter((o) => o.status !== "Shipped").length;
    const thisMonthKey = monthKey(new Date().toISOString());
    const ordersThisMonth = orders.filter((o) => monthKey(o.orderDate) === thisMonthKey).length;
    return { totalOrders: orders.length, totalRevenue, openOrders, ordersThisMonth };
  }, [orders]);

  const ordersByStatus = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        label: status,
        value: orders.filter((o) => o.status === status).length,
      })),
    [orders]
  );

  const monthlyRevenueAll = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      map.set(monthKey(o.orderDate), (map.get(monthKey(o.orderDate)) ?? 0) + orderTotal(o));
    }
    return months12.map((m) => ({ label: monthLabel(m), value: map.get(m) ?? 0 }));
  }, [orders, months12]);

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
              <p className="muted">Select a customer to see their purchase history.</p>
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
                <div className="stat-value">{items.length}</div>
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
