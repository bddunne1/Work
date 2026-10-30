import { showToast } from "../lib/toast";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ListWindow from "../components/ListWindow";
import StatusPill from "../components/StatusPill";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { listItems } from "../lib/itemStore";
import { useViewportHeight } from "../lib/useViewportHeight";
import { listOpenOrders, setEstimatedShipDate as setShipDate } from "../lib/orderStore";
import type { OrderStatus, PurchaseOrder } from "../types";
import { matchesOrderQuery, orderTotalLabel, orderWeight, weightIndex } from "../types";

const STATUS_OPTIONS: OrderStatus[] = [
  "Entered",
  "Checked",
  "Allocated",
  "Backordered",
  "Pick & Packed",
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

function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - out.getDay());
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

const nf = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

interface CalendarCell {
  date?: Date;
  iso?: string;
  orders: PurchaseOrder[];
  weight: number;
}

// How many S.O. numbers a cell shows before "+N more".
const MONTH_PREVIEW = 3;
const WEEK_PREVIEW = 8;

export default function ScheduleShipments() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [weights, setWeights] = useState<Map<string, number>>(new Map());
  // Month or week; the cursor is the first day shown.
  const [calView, setCalView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  // Days whose "+N more" has been opened in place, and the day open in the side panel.
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const [selectedDay, setSelectedDay] = useState<string | "unscheduled" | null>(null);
  // The calendar body fills the window below the toolbar and weekday row.
  const calendarRef = useRef<HTMLDivElement>(null);
  useViewportHeight(calendarRef, 24, [view, calView]);

  useEffect(() => {
    listOpenOrders().then(setOrders);
    listItems().then((items) => setWeights(weightIndex(items)));
  }, []);

  const filtered = useMemo(
    () =>
      orders
        .filter((o) => matchesOrderQuery(o, query))
        .filter((o) => !statusFilter || o.status === statusFilter),
    [orders, query, statusFilter]
  );

  // Saved when the field is left (or Enter is pressed), and only for a
  // complete date: a date input reports "0002-10-01" while the year is
  // still being typed, and each of those used to be a save (R4-21).
  function commitShipDate(o: PurchaseOrder, value: string) {
    if (value === (o.estimatedShipDate ?? "")) return;
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    void setEstimatedShipDate(o.soNumber, value);
  }

  async function setEstimatedShipDate(soNumber: string, value: string) {
    const order = orders.find((o) => o.soNumber === soNumber);
    if (!order) return;
    try {
      const saved = await setShipDate(order, value || null);
      setOrders((os) => os.map((o) => (o.soNumber === soNumber ? saved : o)));
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
        setOrders(await listOpenOrders());
        return;
      }
      throw err;
    }
  }

  const ordersByDate = useMemo(() => {
    const map = new Map<string, PurchaseOrder[]>();
    for (const o of filtered) {
      if (!o.estimatedShipDate) continue;
      const list = map.get(o.estimatedShipDate) ?? [];
      list.push(o);
      map.set(o.estimatedShipDate, list);
    }
    for (const list of map.values()) list.sort((a, b) => Number(a.soNumber) - Number(b.soNumber));
    return map;
  }, [filtered]);
  const unscheduled = useMemo(() => filtered.filter((o) => !o.estimatedShipDate), [filtered]);

  // Month: leading and trailing blanks make whole weeks, so every row is the
  // same height. Week: the seven days from the cursor.
  const calendarCells = useMemo<CalendarCell[]>(() => {
    const cellFor = (date: Date): CalendarCell => {
      const iso = isoDate(date);
      const dayOrders = ordersByDate.get(iso) ?? [];
      return { date, iso, orders: dayOrders, weight: dayOrders.reduce((sum, o) => sum + orderWeight(o, weights), 0) };
    };
    if (calView === "week") return Array.from({ length: 7 }, (_, i) => cellFor(addDays(cursor, i)));
    const first = cursor;
    const startWeekday = first.getDay();
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells: CalendarCell[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push({ orders: [], weight: 0 });
    for (let day = 1; day <= daysInMonth; day++) cells.push(cellFor(new Date(first.getFullYear(), first.getMonth(), day)));
    while (cells.length % 7 !== 0) cells.push({ orders: [], weight: 0 });
    return cells;
  }, [calView, cursor, ordersByDate, weights]);
  const rowCount = Math.max(1, calendarCells.length / 7);

  const todayIso = isoDate(new Date());
  const rangeLabel =
    calView === "month"
      ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : `${cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(cursor, 6).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  function move(n: number) {
    setCursor((c) => (calView === "month" ? addMonths(c, n) : addDays(c, 7 * n)));
  }
  function goToday() {
    const now = new Date();
    setCursor(calView === "month" ? startOfMonth(now) : startOfWeek(now));
  }
  function switchCalView(next: "month" | "week") {
    if (next === calView) return;
    setCalView(next);
    // Keep the same part of the year in view when switching.
    setCursor((c) => {
      if (next === "week") {
        const today = new Date();
        const sameMonth = today.getFullYear() === c.getFullYear() && today.getMonth() === c.getMonth();
        return startOfWeek(sameMonth ? today : c);
      }
      return startOfMonth(addDays(c, 3));
    });
  }
  function toggleExpanded(iso: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }

  const preview = calView === "month" ? MONTH_PREVIEW : WEEK_PREVIEW;
  const panelOrders = selectedDay === null ? null : selectedDay === "unscheduled" ? unscheduled : (ordersByDate.get(selectedDay) ?? []);
  const panelWeight = panelOrders ? panelOrders.reduce((sum, o) => sum + orderWeight(o, weights), 0) : 0;
  const panelTitle =
    selectedDay === "unscheduled"
      ? "No ship date yet"
      : selectedDay
        ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
        : "";

  function shipDateControl(o: PurchaseOrder) {
    return canEdit ? (
      <input
        key={`${o.soNumber}:${o.estimatedShipDate ?? ""}`}
        type="date"
        className={`schedule-date-input ${o.estimatedShipDate ? "has-date" : ""}`}
        defaultValue={o.estimatedShipDate ?? ""}
        aria-label={`Estimated ship date for S.O. #${o.soNumber}`}
        onBlur={(e) => commitShipDate(o, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    ) : o.estimatedShipDate ? (
      <span className="schedule-ship-date">{o.estimatedShipDate}</span>
    ) : (
      "—"
    );
  }

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
                  <td>{orderTotalLabel(o)}</td>
                  <td onClick={(e) => e.stopPropagation()}>{shipDateControl(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <div className={`ship-calendar-layout${panelOrders ? " has-panel" : ""}`}>
          <div className="ship-calendar">
            <div className="ship-calendar-header">
              <div className="inline-actions">
                <button type="button" className="secondary-btn" onClick={() => move(-1)} aria-label={`Previous ${calView}`}>
                  &larr; Prev
                </button>
                <button type="button" className="secondary-btn" onClick={goToday}>
                  Today
                </button>
                <button type="button" className="secondary-btn" onClick={() => move(1)} aria-label={`Next ${calView}`}>
                  Next &rarr;
                </button>
              </div>
              <div className="ship-calendar-month">{rangeLabel}</div>
              <div className="inline-actions">
                <div className="decision-buttons schedule-view-toggle" role="tablist" aria-label="Calendar range">
                  <button type="button" role="tab" aria-selected={calView === "month"} className={`decision-btn ${calView === "month" ? "selected" : ""}`} onClick={() => switchCalView("month")}>
                    Month
                  </button>
                  <button type="button" role="tab" aria-selected={calView === "week"} className={`decision-btn ${calView === "week" ? "selected" : ""}`} onClick={() => switchCalView("week")}>
                    Week
                  </button>
                </div>
                {unscheduled.length > 0 && (
                  <button type="button" className={`link-btn ship-calendar-unscheduled${selectedDay === "unscheduled" ? " is-on" : ""}`} onClick={() => setSelectedDay(selectedDay === "unscheduled" ? null : "unscheduled")}>
                    {unscheduled.length} without a ship date
                  </button>
                )}
              </div>
            </div>
            <div className="ship-calendar-grid ship-calendar-weekdays">
              {WEEKDAY_LABELS.map((w, i) => (
                <div key={w} className={`ship-calendar-weekday${i === 0 || i === 6 ? " is-weekend" : ""}`}>
                  {w}
                </div>
              ))}
            </div>
            <div ref={calendarRef} className={`ship-calendar-grid ship-calendar-body ship-calendar-${calView}`} style={{ "--cal-rows": rowCount } as React.CSSProperties}>
              {calendarCells.map((cell, idx) => {
                if (!cell.date || !cell.iso) return <div key={`blank-${idx}`} className="ship-calendar-cell empty" />;
                const iso = cell.iso;
                const weekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;
                const expanded = expandedDays.has(iso);
                const shown = expanded ? cell.orders : cell.orders.slice(0, preview);
                const more = cell.orders.length - shown.length;
                const classes = ["ship-calendar-cell"];
                if (iso === todayIso) classes.push("today");
                if (weekend) classes.push("is-weekend");
                if (cell.orders.length > 0) classes.push("has-orders");
                if (selectedDay === iso) classes.push("is-selected");
                if (iso < todayIso && cell.orders.length > 0) classes.push("is-past");
                return (
                  <div
                    key={iso}
                    className={classes.join(" ")}
                    role="button"
                    tabIndex={0}
                    aria-label={`${cell.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}: ${cell.orders.length} orders`}
                    aria-pressed={selectedDay === iso}
                    onClick={() => setSelectedDay(selectedDay === iso ? null : iso)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedDay(selectedDay === iso ? null : iso);
                      }
                    }}
                  >
                    <div className="ship-calendar-cell-head">
                      <span className="ship-calendar-day">
                        {calView === "week" && <span className="ship-calendar-day-name">{cell.date.toLocaleDateString(undefined, { weekday: "short" })} </span>}
                        {cell.date.getDate()}
                      </span>
                      {cell.orders.length > 0 && (
                        <span className="ship-calendar-stats">
                          {cell.orders.length} {cell.orders.length === 1 ? "order" : "orders"}
                          {cell.weight > 0 && <> · {nf(cell.weight)} lb</>}
                        </span>
                      )}
                    </div>
                    <div className="ship-calendar-orders">
                      {shown.map((o) => (
                        <Link key={o.soNumber} to={`/storage/${o.soNumber}`} className="ship-calendar-order" title={`${o.billTo.name} · ${orderTotalLabel(o)}`} onClick={(e) => e.stopPropagation()}>
                          #{o.soNumber}
                          {calView === "week" && <span className="ship-calendar-order-name"> {o.billTo.name}</span>}
                        </Link>
                      ))}
                      {(more > 0 || (expanded && cell.orders.length > preview)) && (
                        <button
                          type="button"
                          className="ship-calendar-more"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpanded(iso);
                          }}
                        >
                          {expanded ? "Show fewer" : `+${more} more`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {panelOrders && (
            <aside className="ship-calendar-panel" aria-label="Orders for the selected day">
              <div className="ship-calendar-panel-head">
                <div>
                  <div className="ship-calendar-panel-title">{panelTitle}</div>
                  <div className="muted">
                    {panelOrders.length} {panelOrders.length === 1 ? "order" : "orders"}
                    {panelWeight > 0 && <> · {nf(panelWeight)} lb</>}
                  </div>
                </div>
                <button type="button" className="icon-btn" aria-label="Close" onClick={() => setSelectedDay(null)}>
                  &times;
                </button>
              </div>
              {panelOrders.length === 0 ? (
                <p className="muted">Nothing scheduled for this day.</p>
              ) : (
                <ListWindow className="ship-calendar-panel-list">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>S.O. #</th>
                        <th>Customer</th>
                        <th>Status</th>
                        <th>Ship date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {panelOrders.map((o) => (
                        <tr key={o.soNumber}>
                          <td>
                            <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
                              {o.soNumber}
                            </Link>
                          </td>
                          <td>
                            {o.billTo.name}
                            <div className="muted ship-calendar-panel-sub">
                              P.O. {o.poNumber || "—"} · {orderTotalLabel(o)}
                              {orderWeight(o, weights) > 0 && <> · {nf(orderWeight(o, weights))} lb</>}
                            </div>
                          </td>
                          <td>
                            <StatusPill order={o} />
                          </td>
                          <td>{shipDateControl(o)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ListWindow>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
