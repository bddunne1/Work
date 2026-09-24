import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import StockLedger from "../components/StockLedger";
import type { AuditLogEntry } from "../lib/auditStore";
import { listAuditLog } from "../lib/auditStore";

function humanizeAction(action: string): string {
  return action
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function formatDetail(detail: unknown): string {
  if (!detail || typeof detail !== "object") return "";
  const entries = Object.entries(detail as Record<string, unknown>);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      if (v && typeof v === "object" && "from" in v && "to" in v) {
        const change = v as { from: unknown; to: unknown };
        return `${k}: ${String(change.from)} → ${String(change.to)}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join(", ");
}

const AREAS: { value: string; label: string }[] = [
  { value: "", label: "Everything" },
  { value: "sales-order", label: "Sales orders" },
  { value: "vendor-po", label: "Purchase orders" },
  { value: "return", label: "Returns" },
  { value: "item", label: "Items & stock" },
  { value: "customer", label: "Customers" },
  { value: "vendor", label: "Vendors" },
  { value: "account", label: "Accounts & sign-ins" },
];

const REASONS = [
  { value: "", label: "All movements" },
  { value: "SHIP", label: "Shipped" },
  { value: "RECEIVE_PO", label: "Received (PO)" },
  { value: "RETURN", label: "Returned to stock" },
  { value: "ADJUST,ITEM_EDIT", label: "Adjustments" },
  { value: "UNDO_SHIP", label: "Shipments undone" },
];

function targetLink(e: AuditLogEntry): string | null {
  if (!e.targetId) return null;
  if (e.targetType === "sales-order") return `/storage/${e.targetId}`;
  if (e.targetType === "vendor-po") return `/purchase-orders/${e.targetId}`;
  if (e.targetType === "return") return `/returns/${e.targetId}`;
  if (e.targetType === "item") return `/items/${e.targetId}`;
  return null;
}

export default function AuditLog() {
  const [tab, setTab] = useState<"activity" | "stock">("activity");
  const [area, setArea] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loaded, setLoaded] = useState<{ key: string; entries: AuditLogEntry[]; hasMore: boolean; error: string }>({
    key: "",
    entries: [],
    hasMore: false,
    error: "",
  });
  const [item, setItem] = useState("");
  const [reason, setReason] = useState("");

  const filterKey = JSON.stringify({ area, actor: actor.trim(), from, to });
  const current = loaded.key === filterKey ? loaded : null;
  const entries = current ? current.entries : null;
  const hasMore = current?.hasMore ?? false;
  const error = current?.error ?? "";

  useEffect(() => {
    if (tab !== "activity") return;
    let cancelled = false;
    const f = JSON.parse(filterKey) as { area: string; actor: string; from: string; to: string };
    const t = setTimeout(() => {
      listAuditLog({ targetType: f.area, actor: f.actor, from: f.from, to: f.to })
        .then((rows) => !cancelled && setLoaded({ key: filterKey, entries: rows, hasMore: rows.length === 200, error: "" }))
        .catch(() => !cancelled && setLoaded({ key: filterKey, entries: [], hasMore: false, error: "Failed to load the activity log." }));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tab, filterKey]);

  async function loadOlder() {
    if (!entries || entries.length === 0) return;
    const older = await listAuditLog({ targetType: area, actor: actor.trim(), from, to, before: entries[entries.length - 1].createdAt });
    setLoaded({ key: filterKey, entries: [...entries, ...older], hasMore: older.length === 200, error: "" });
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Activity Log</h1>
        <p className="muted">
          Who did what, and when: sales orders (entered, checked, allocated, packed, shipped, cancelled), purchase
          orders and receipts, returns, item, customer and vendor changes, and account activity. The stock ledger
          lists every change to on-hand quantities with the document that caused it.
        </p>
      </div>

      <div className="filter-row" role="tablist" aria-label="Log view">
        <button type="button" role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "primary-btn" : "secondary-btn"} onClick={() => setTab("activity")}>
          Activity
        </button>
        <button type="button" role="tab" aria-selected={tab === "stock"} className={tab === "stock" ? "primary-btn" : "secondary-btn"} onClick={() => setTab("stock")}>
          Stock ledger
        </button>
      </div>

      {tab === "activity" ? (
        <>
          <div className="filter-row">
            <select id="audit-area" aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)}>
              {AREAS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
            <input id="audit-actor" aria-label="User" placeholder="User" value={actor} onChange={(e) => setActor(e.target.value)} />
            <label>
              From <input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              To <input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>

          {error && <p className="login-error">{error}</p>}

          {entries === null ? (
            <p className="muted">Loading...</p>
          ) : entries.length === 0 ? (
            <p className="muted">No activity matches.</p>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const link = targetLink(e);
                    const label = e.targetLabel ?? e.targetId ?? "—";
                    return (
                      <tr key={e.id}>
                        <td>{new Date(e.createdAt).toLocaleString()}</td>
                        <td>{e.actorUsername}</td>
                        <td>{humanizeAction(e.action)}</td>
                        <td>{link ? <Link to={link}>{label}</Link> : label}</td>
                        <td className="muted">{formatDetail(e.detail)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {hasMore && (
                <div className="button-row">
                  <button type="button" className="secondary-btn" onClick={loadOlder}>
                    Load older
                  </button>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="filter-row">
            <input id="ledger-item" aria-label="Item #" placeholder="Item #" value={item} onChange={(e) => setItem(e.target.value)} />
            <select id="ledger-reason" aria-label="Movement" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <label>
              From <input id="ledger-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              To <input id="ledger-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <StockLedger showItem filters={{ item: item.trim() || undefined, reason: reason || undefined, from: from || undefined, to: to || undefined }} />
        </>
      )}
    </div>
  );
}
