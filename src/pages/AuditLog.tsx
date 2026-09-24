import { useEffect, useState } from "react";
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

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listAuditLog()
      .then(setEntries)
      .catch(() => setError("Failed to load the activity log."));
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Activity Log</h1>
        <p className="muted">
          Administrative accountability trail - account logins, and every account created, changed,
          deactivated, or deleted. Scoped to accounts today; order, customer and inventory changes
          aren't logged here yet.
        </p>
      </div>

      {error && <p className="login-error">{error}</p>}

      {entries === null ? (
        <p className="muted">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="muted">No activity recorded yet.</p>
      ) : (
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
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.actorUsername}</td>
                <td>{humanizeAction(e.action)}</td>
                <td>{e.targetLabel ?? e.targetId ?? "—"}</td>
                <td className="muted">{formatDetail(e.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
