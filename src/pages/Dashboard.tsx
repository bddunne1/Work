import { useEffect, useMemo, useRef, useState } from "react";
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
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { reviewQueueCounts, type ReviewQueueCounts } from "../lib/invoiceStore";
import { dashboardSummary, type DashboardSummary, type QueueSummary } from "../lib/dashboardStore";
import { listRecentOrders, searchOrders } from "../lib/orderStore";
import { getAccessLevel } from "../lib/permissions";
import { listOpenReturns } from "../lib/returnStore";
import { getLeadTimeDays } from "../lib/settingsStore";
import { listOpenVendorPos } from "../lib/vendorPoStore";
import type { PurchaseOrder, ReturnAuthorization, VendorPurchaseOrder } from "../types";
import type { ComponentType, CSSProperties, SVGProps } from "react";

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

// In the order work flows through the building: an order comes in, is
// checked and allocated, released to the floor, shipped; then the stock
// side (purchasing, receiving, returns), reference data and admin.
const LANES: Lane[] = [
  {
    lane: "Order Prep",
    color: "#12b886",
    modules: [
      { name: "Order Entry", description: "Enter a sales order from a customer PO", to: "/order-entry", icon: OrderEntryIcon },
      { name: "Validation", description: "Check each order, then mark it checked", to: "/validation", icon: ValidationIcon },
      { name: "Allocation", description: "Allocate full, partial, or hold", to: "/allocation", icon: AllocationIcon },
      { name: "Back Order Queue", description: "Orders waiting on stock", to: "/back-orders", icon: BackOrderIcon },
    ],
  },
  {
    lane: "Fulfillment",
    color: "#7c6ff2",
    modules: [
      { name: "Release Orders", description: "Pick lists and packing slips for the floor", to: "/pick-pack", icon: PickPackIcon },
      { name: "Open Picks", description: "Printed orders ready to confirm shipped", to: "/open-picks", icon: OpenPicksIcon },
      { name: "Warehouse Capacity", description: "Weight on the floor and dwell time", to: "/warehouse-capacity", icon: WarehouseIcon },
    ],
  },
  {
    lane: "Logistics",
    color: "#f06595",
    modules: [
      { name: "Schedule Shipment", description: "Set ship dates, or view the calendar", to: "/schedule", icon: ScheduleIcon },
      { name: "Generate BOL", description: "Bill of Lading for one or more orders", to: "/bol", icon: BolIcon },
      { name: "Create Labels", description: "Shipping and private-label product labels", to: "/labels", icon: LabelsIcon },
      { name: "Shipment History", description: "Orders that have shipped", to: "/shipment-history", icon: ShipmentHistoryIcon },
    ],
  },
  {
    lane: "Purchasing",
    color: "#1c7ed6",
    modules: [
      { name: "Purchase Orders", description: "Write and track orders to vendors", to: "/purchase-orders", icon: PurchaseOrdersIcon },
      { name: "Receiving", description: "Receive stock against an open PO", to: "/receiving", icon: ReceivingIcon },
      { name: "Returns", description: "Issue an RA; receive returned goods back", to: "/returns", icon: ReturnsIcon },
      { name: "Vendors", description: "Supplier contacts", to: "/vendors", icon: VendorsIcon },
    ],
  },
  {
    lane: "Data",
    color: "#f59f00",
    modules: [
      { name: "Customers", description: "Billing, shipping, and terms", to: "/customers", icon: CustomersIcon },
      { name: "Items", description: "The item catalog", to: "/items", icon: CatalogIcon },
      { name: "Inventory", description: "On hand, on order, on PO", to: "/inventory", icon: InventoryIcon },
      { name: "Analytics", description: "Customer, inventory and sales charts", to: "/analytics", icon: AnalyticsIcon },
    ],
  },
  {
    lane: "Accounting",
    color: "#0b7285",
    modules: [
      { name: "Invoices", description: "Review and issue invoices and credit memos; QuickBooks sync", to: "/invoices", icon: ShipmentHistoryIcon },
    ],
  },
  {
    lane: "Administration",
    color: "#495057",
    modules: [
      { name: "Accounts", description: "User accounts and roles", to: "/accounts", icon: AccountsIcon },
      { name: "Settings", description: "Company, order defaults, numbering", to: "/settings", icon: SettingsIcon },
      { name: "Activity Log", description: "Sign-ins and account changes", to: "/audit-log", icon: ActivityLogIcon },
    ],
  },
];

// ---- Queues ----------------------------------------------------------------
// One card per workflow queue. A person sees the queues they can work (edit
// access on `workPath`) first; anyone who works none of them - sales, say -
// sees the whole pipeline read-only instead.

interface QueueDef {
  key: string;
  label: string;
  to: string;
  // The Dashboard tile this queue's count is shown on.
  tile: string;
  workPath: string;
  viewPath: string;
  color: string;
  lateLabel: string;
  // Shown when there's nothing more specific to say (no age, nothing late).
  note?: string;
}

const QUEUES: QueueDef[] = [
  { key: "validate", label: "To validate", to: "/validation", tile: "/validation", workPath: "/validation", viewPath: "/validation", color: "#12b886", lateLabel: "past ship date" },
  { key: "allocate", label: "To allocate", to: "/allocation", tile: "/allocation", workPath: "/allocation", viewPath: "/allocation", color: "#12b886", lateLabel: "past ship date" },
  { key: "backorder", label: "Back ordered", to: "/back-orders", tile: "/back-orders", workPath: "/back-orders", viewPath: "/back-orders", color: "#12b886", lateLabel: "past ship date", note: "waiting on stock" },
  { key: "release", label: "To release", to: "/pick-pack?tab=ready", tile: "/pick-pack", workPath: "/pick-pack/review", viewPath: "/pick-pack", color: "#7c6ff2", lateLabel: "past ship date" },
  { key: "print", label: "To print", to: "/pick-pack?tab=print", tile: "/pick-pack", workPath: "/pick-pack", viewPath: "/pick-pack", color: "#7c6ff2", lateLabel: "past ship date" },
  { key: "ship", label: "To confirm shipped", to: "/open-picks", tile: "/open-picks", workPath: "/open-picks", viewPath: "/open-picks", color: "#7c6ff2", lateLabel: "past ship date" },
  { key: "pull", label: "To pull from floor", to: "/open-picks", tile: "/open-picks", workPath: "/open-picks", viewPath: "/open-picks", color: "#f06595", lateLabel: "", note: "cancelled after printing" },
  { key: "receive", label: "POs to receive", to: "/receiving", tile: "/receiving", workPath: "/receiving", viewPath: "/receiving", color: "#1c7ed6", lateLabel: "past expected date" },
  { key: "returns", label: "Returns to receive", to: "/returns", tile: "/returns", workPath: "/returns", viewPath: "/returns", color: "#1c7ed6", lateLabel: "" },
];

// The queues an order passes through (the rest are stock coming in).
const ORDER_QUEUE_KEYS = ["validate", "allocate", "backorder", "release", "print", "ship"];

function isoDay(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

function shipBy(o: PurchaseOrder): string {
  return o.estimatedShipDate ?? o.dueDate;
}

function ageLabel(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

const nf = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

// The order queues come counted from the server; POs and returns are
// summarised here from the lists their pages already load.
function summarize(entries: { since?: string; late: boolean }[]): QueueSummary {
  const times = entries.map((e) => (e.since ? new Date(e.since).getTime() : NaN)).filter((t) => Number.isFinite(t));
  return { count: entries.length, late: entries.filter((e) => e.late).length, oldest: times.length ? new Date(Math.min(...times)).toISOString() : null };
}

function buildQueues(
  summary: DashboardSummary | null,
  pos: VendorPurchaseOrder[] | null,
  ras: ReturnAuthorization[] | null,
  today: string
): Record<string, QueueSummary | null> {
  return {
    ...(summary?.queues ?? {}),
    receive: pos ? summarize(pos.map((p) => ({ since: p.createdAt, late: Boolean(p.expectedDate && p.expectedDate.slice(0, 10) < today) }))) : null,
    returns: ras ? summarize(ras.map((r) => ({ since: r.createdAt, late: false }))) : null,
  };
}

// ---- Order lookup ------------------------------------------------------------

function OrderLookup({ canOpen }: { canOpen: boolean }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PurchaseOrder[] | null>(null);
  const [recent, setRecent] = useState<PurchaseOrder[] | null>(null);
  const [total, setTotal] = useState(0);
  const debounced = useDebouncedValue(q.trim(), 250);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!debounced) return;
    let cancelled = false;
    searchOrders({ q: debounced, pageSize: 8, sort: "soNumber", dir: "desc" }).then((res) => {
      if (cancelled) return;
      setRows(res.rows);
      setTotal(res.total);
    });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function onFocus() {
    setOpen(true);
    // With nothing typed, show the last few orders entered as a shortcut.
    if (recent === null) listRecentOrders(5).then(setRecent);
  }

  const showing = debounced ? rows : recent;

  return (
    <div className="dash-lookup" ref={boxRef}>
      <label htmlFor="dash-lookup-input" className="dash-lookup-label">
        Find an order
      </label>
      <input
        id="dash-lookup-input"
        type="search"
        placeholder="S.O. #, P.O. # or customer"
        value={q}
        autoComplete="off"
        onFocus={onFocus}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && canOpen && showing && showing.length > 0 && debounced === q.trim()) {
            navigate(`/storage/${showing[0].soNumber}`);
          }
        }}
      />
      {open && (
        <div className="dash-lookup-results" role="listbox" aria-label="Matching orders">
          {!debounced && <div className="dash-lookup-hint">Recently entered</div>}
          {showing === null ? (
            <div className="dash-lookup-hint">Searching…</div>
          ) : showing.length === 0 ? (
            <div className="dash-lookup-hint">No orders match "{debounced}".</div>
          ) : (
            showing.map((o) => {
              const content = (
                <>
                  <span className="dash-lookup-so">{o.soNumber}</span>
                  <span className="dash-lookup-main">
                    {o.billTo.name}
                    <span className="dash-lookup-sub">P.O. {o.poNumber || "—"} · ship by {shipBy(o)}</span>
                  </span>
                  <StatusPill order={o} />
                </>
              );
              return canOpen ? (
                <Link key={o.soNumber} to={`/storage/${o.soNumber}`} className="dash-lookup-row" role="option">
                  {content}
                </Link>
              ) : (
                <div key={o.soNumber} className="dash-lookup-row" role="option">
                  {content}
                </div>
              );
            })
          )}
          {debounced && total > (rows?.length ?? 0) && (
            <div className="dash-lookup-hint">
              {total - (rows?.length ?? 0)} more - type more of the number or name to narrow it down.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Page ----------------------------------------------------------------------

export default function Dashboard() {
  const { account } = useAuth();
  const [loadedAt] = useState(() => Date.now());
  const today = isoDay(new Date(loadedAt));
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueCounts | null>(null);
  const [pos, setPos] = useState<VendorPurchaseOrder[] | null>(null);
  const [ras, setRas] = useState<ReturnAuthorization[] | null>(null);
  const leadTime = getLeadTimeDays();
  const access = (path: string) => getAccessLevel(path, account!);
  const canSeePos = ["/receiving", "/purchase-orders"].some((p) => access(p) !== "none");
  const canSeeReturns = access("/returns") !== "none";
  const canSeeInvoices = access("/invoices") !== "none";
  // Finding an order needs a page that may read orders.
  const canFindOrders = ["/storage", "/open-orders", "/closed-orders", "/validation", "/allocation", "/back-orders", "/pick-pack", "/open-picks", "/schedule", "/bol", "/shipment-history"].some((p) => access(p) !== "none");

  useEffect(() => {
    const midnight = new Date(loadedAt);
    midnight.setHours(0, 0, 0, 0);
    // The counts, computed on the server - not the order list.
    dashboardSummary(today, midnight).then(setSummary);
    if (canSeeInvoices) reviewQueueCounts().then(setReviewQueue);
    if (canSeePos) listOpenVendorPos().then(setPos);
    if (canSeeReturns) listOpenReturns().then(setRas);
  }, [loadedAt, today, canSeePos, canSeeReturns, canSeeInvoices]);

  const queueData = useMemo(() => buildQueues(summary, pos, ras, today), [summary, pos, ras, today]);

  const visibleQueues = QUEUES.filter((qd) => access(qd.viewPath) !== "none" && queueData[qd.key] !== null);
  const workQueues = visibleQueues.filter((qd) => access(qd.workPath) === "edit");
  // Anyone who doesn't work an order queue themselves (customer service,
  // sales) still gets the whole order pipeline, read-only - "where's my
  // order?" is most of their day. Order counts are readable by every
  // signed-in account; a card only links if they can open that page.
  const pipelineQueues = QUEUES.filter((qd) => ORDER_QUEUE_KEYS.includes(qd.key));
  const showPipeline = !workQueues.some((qd) => ORDER_QUEUE_KEYS.includes(qd.key));

  function renderQueue(qd: QueueDef, linkable: boolean) {
    const q = queueData[qd.key];
    const count = q?.count ?? 0;
    const lateCount = q?.late ?? 0;
    const oldest = q?.oldest ? new Date(q.oldest).getTime() : undefined;
    const body = (
      <>
        <span className="dash-queue-label">{qd.label}</span>
        <span className="dash-queue-count">{loading ? "…" : count}</span>
        <span className="dash-queue-meta">
          {loading || count === 0 ? (
            count === 0 && !loading ? "All clear" : " "
          ) : (
            <>
              {oldest !== undefined && <span>oldest {ageLabel(loadedAt - oldest)}</span>}
              {oldest === undefined && lateCount === 0 && qd.note && <span>{qd.note}</span>}
              {lateCount > 0 && qd.lateLabel && (
                <span className="is-late">
                  {lateCount} {qd.lateLabel}
                </span>
              )}
            </>
          )}
        </span>
      </>
    );
    const className = `dash-queue${count === 0 ? " is-empty" : ""}${linkable ? "" : " is-static"}`;
    const style = { "--queue-color": qd.color } as CSSProperties;
    return linkable ? (
      <Link key={qd.key} to={qd.to} className={className} style={style}>
        {body}
      </Link>
    ) : (
      <div key={qd.key} className={className} style={style}>
        {body}
      </div>
    );
  }

  // Tile badges: how many are waiting in the queue(s) behind each tile.
  const tileCounts = new Map<string, { count: number; late: number }>();
  for (const qd of visibleQueues) {
    const q = queueData[qd.key];
    const cur = tileCounts.get(qd.tile) ?? { count: 0, late: 0 };
    tileCounts.set(qd.tile, { count: cur.count + (q?.count ?? 0), late: cur.late + (q?.late ?? 0) });
  }

  // Drafts waiting for Accounting, on the Invoices tile.
  if (reviewQueue && reviewQueue.invoices + reviewQueue.creditMemos > 0) {
    const oldest = reviewQueue.oldestDraftAt ? loadedAt - new Date(reviewQueue.oldestDraftAt).getTime() : 0;
    tileCounts.set("/invoices", { count: reviewQueue.invoices + reviewQueue.creditMemos, late: oldest > 2 * 86_400_000 ? 1 : 0 });
  }

  // Today strip: the order figures from the server, the PO figures from the list.
  const todayStats = useMemo(() => {
    const s = summary?.todayStats ?? { due: 0, late: 0, shippedOrders: 0, shippedUnits: 0, shippedWeight: 0, floor: 0, floorWeight: 0 };
    const posDue = (pos ?? []).filter((p) => p.expectedDate?.slice(0, 10) === today).length;
    const posLate = (pos ?? []).filter((p) => p.expectedDate && p.expectedDate.slice(0, 10) < today).length;
    return { ...s, posDue, posLate };
  }, [summary, pos, today]);

  const visibleLanes = LANES.map((lane) => ({
    ...lane,
    modules: lane.modules.filter((m) => access(m.to) !== "none"),
  })).filter((lane) => lane.modules.length > 0);

  const loading = summary === null;
  const dateLabel = new Date(loadedAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="page dash">
      <div className="dash-head">
        <div>
          <h1 className="dash-hello">Hello {account!.username}</h1>
          <p className="muted dash-date">
            {dateLabel} · Lead time for new orders: <strong>{leadTime}</strong> business days
            {access("/settings") === "edit" && (
              <>
                {" "}
                · <Link to="/settings">Change</Link>
              </>
            )}
          </p>
        </div>
        {canFindOrders && <OrderLookup canOpen={access("/storage") !== "none"} />}
      </div>

      <section className="dash-today" aria-label="Today">
        <Link to="/schedule" className="dash-today-card">
          <span className="dash-today-label">Ship by today</span>
          <span className="dash-today-value">{loading ? "…" : todayStats.due}</span>
          <span className={`dash-today-sub${todayStats.late > 0 ? " is-late" : ""}`}>
            {loading ? " " : todayStats.late > 0 ? `${todayStats.late} past their ship date` : "Nothing late"}
          </span>
        </Link>
        <Link to="/shipment-history" className="dash-today-card">
          <span className="dash-today-label">Shipped today</span>
          <span className="dash-today-value">{loading ? "…" : todayStats.shippedOrders}</span>
          <span className="dash-today-sub">
            {loading
              ? " "
              : `${nf(todayStats.shippedUnits)} units${todayStats.shippedWeight > 0 ? ` · ${nf(todayStats.shippedWeight)} lb` : ""}`}
          </span>
        </Link>
        <Link to="/warehouse-capacity" className="dash-today-card">
          <span className="dash-today-label">On the floor</span>
          <span className="dash-today-value">{loading ? "…" : todayStats.floor}</span>
          <span className="dash-today-sub">
            {loading ? " " : todayStats.floorWeight > 0 ? `${nf(todayStats.floorWeight)} lb released` : "orders released"}
          </span>
        </Link>
        {canSeePos && (
          <Link to="/receiving" className="dash-today-card">
            <span className="dash-today-label">Receiving today</span>
            <span className="dash-today-value">{pos === null ? "…" : todayStats.posDue}</span>
            <span className={`dash-today-sub${todayStats.posLate > 0 ? " is-late" : ""}`}>
              {pos === null ? " " : todayStats.posLate > 0 ? `${todayStats.posLate} POs overdue` : "POs expected"}
            </span>
          </Link>
        )}
      </section>

      {workQueues.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-section-title">Your queues</h2>
          <div className="dash-queues">{workQueues.map((qd) => renderQueue(qd, true))}</div>
        </section>
      )}

      {showPipeline && (
        <section className="dash-section">
          <h2 className="dash-section-title">Order pipeline · where open orders are right now</h2>
          <div className="dash-queues">
            {pipelineQueues.map((qd) => renderQueue(qd, access(qd.viewPath) !== "none"))}
          </div>
        </section>
      )}

      <section className="dash-section">
        <h2 className="dash-section-title">Go to</h2>
        <div className="dash-lanes">
          {visibleLanes.map((lane) => (
            <div key={lane.lane} className="dash-lane" style={{ "--lane-color": lane.color } as CSSProperties}>
              <h3 className="dash-lane-name">{lane.lane}</h3>
              <div className="dash-tiles">
                {lane.modules.map((m) => {
                  const badge = tileCounts.get(m.to);
                  return (
                    <Link key={m.name} to={m.to} className="dash-tile">
                      <span className="dash-tile-icon" aria-hidden="true">
                        <m.icon />
                      </span>
                      <span className="dash-tile-text">
                        <span className="dash-tile-name">{m.name}</span>
                        <span className="dash-tile-desc">{m.description}</span>
                      </span>
                      {badge && badge.count > 0 && (
                        <span
                          className={`dash-tile-badge${badge.late > 0 ? " is-late" : ""}`}
                          title={badge.late > 0 ? `${badge.count} waiting, ${badge.late} late` : `${badge.count} waiting`}
                        >
                          {badge.count}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
