import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import StatusPill from "../components/StatusPill";
import { useCanEdit } from "../lib/authContext";
import { listOrders, updateOrder } from "../lib/orderStore";
import type { OrderStatus, PurchaseOrder } from "../types";
import { matchesOrderQuery, orderTotal } from "../types";

const STATUS_OPTIONS: OrderStatus[] = [
  "Entered",
  "Checked",
  "Allocated",
  "Backordered",
  "Pick & Packed",
  "Shipped",
];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface CalendarCell {
  date?: Date;
  iso?: string;
  orders: PurchaseOrder[];
}

export default function ScheduleShipments() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [orders, setOrders] = useState(() => listOrders());
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));

  const filtered = useMemo(
    () =>
      orders
        .filter((o) => matchesOrderQuery(o, query))
        .filter((o) => !statusFilter || o.status === statusFilter),
    [orders, query, statusFilter]
  );

  function setEstimatedShipDate(soNumber: string, value: string) {
    const order = orders.find((o) => o.soNumber === soNumber);
    if (!order) return;
    const updated = { ...order, estimatedShipDate: value || undefined };
    updateOrder(updated);
    setOrders((os) => os.map((o) => (o.soNumber === soNumber ? updated : o)));
  }

  const calendarCells = useMemo<CalendarCell[]>(() => {
    const first = monthCursor;
    const startWeekday = first.getDay();
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const ordersByDate = new Map<string, PurchaseOrder[]>();
    for (const o of filtered) {
      if (!o.estimatedShipDate) continue;
      const list = ordersByDate.get(o.estimatedShipDate) ?? [];
      list.push(o);
      ordersByDate.set(o.estimatedShipDate, list);
    }
    const cells: CalendarCell[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push({ orders: [] });
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(first.getFullYear(), first.getMonth(), day);
      const iso = isoDate(date);
      cells.push({ date, iso, orders: ordersByDate.get(iso) ?? [] });
    }
    return cells;
  }, [monthCursor, filtered]);

  const monthLabel = monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todayIso = isoDate(new Date());

  return (
    <div className="page">
      <div className="page-header">
        <h1>Schedule Shipments</h1>
        <p className="muted">
          Set an estimated ship date for each order as it comes in, so logistics and the customer know
          what to expect.
        </p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by S.O. #, P.O. #, or customer..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="inline-actions">
          <select
            className="status-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as OrderStatus | "")}
            aria-label="Filter by order status"
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="decision-buttons schedule-view-toggle">
            <button
              type="button"
              className={`decision-btn ${view === "list" ? "selected" : ""}`}
              onClick={() => setView("list")}
            >
              List
            </button>
            <button
              type="button"
              className={`decision-btn ${view === "calendar" ? "selected" : ""}`}
              onClick={() => setView("calendar")}
            >
              Calendar
            </button>
          </div>
        </div>
      </div>

      {view === "list" ? (
        filtered.length === 0 ? (
          <p className="muted">No orders found.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>S.O. #</th>
                <th>P.O. #</th>
                <th>Customer</th>
                <th>Order Date</th>
                <th>Status</th>
                <th>Total</th>
                <th>Est. Ship Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
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
                  <td>${orderTotal(o).toFixed(2)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {canEdit ? (
                      <input
                        type="date"
                        className="schedule-date-input"
                        value={o.estimatedShipDate ?? ""}
                        onChange={(e) => setEstimatedShipDate(o.soNumber, e.target.value)}
                      />
                    ) : (
                      o.estimatedShipDate || "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <div className="ship-calendar">
          <div className="ship-calendar-header">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setMonthCursor((m) => addMonths(m, -1))}
            >
              &larr; Prev
            </button>
            <div className="ship-calendar-month">{monthLabel}</div>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setMonthCursor((m) => addMonths(m, 1))}
            >
              Next &rarr;
            </button>
          </div>
          <div className="ship-calendar-grid ship-calendar-weekdays">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="ship-calendar-weekday">
                {w}
              </div>
            ))}
          </div>
          <div className="ship-calendar-grid">
            {calendarCells.map((cell, idx) => (
              <div
                key={cell.iso ?? `blank-${idx}`}
                className={`ship-calendar-cell ${cell.iso === todayIso ? "today" : ""} ${!cell.date ? "empty" : ""}`}
              >
                {cell.date && (
                  <>
                    <div className="ship-calendar-day">{cell.date.getDate()}</div>
                    <div className="ship-calendar-orders">
                      {cell.orders.map((o) => (
                        <Link key={o.soNumber} to={`/storage/${o.soNumber}`} className="ship-calendar-order">
                          #{o.soNumber} · {o.billTo.name}
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
