import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { StockMovement } from "../lib/auditStore";
import { MOVEMENT_REASON_LABEL, listItemMovements, listStockMovements, movementRefLink } from "../lib/auditStore";

// Stock ledger table: one item's movements (itemId) or a filtered feed
// across all items (filters). Newest first.
export default function StockLedger({
  itemId,
  filters,
  showItem = false,
}: {
  itemId?: string;
  filters?: { item?: string; reason?: string; from?: string; to?: string };
  showItem?: boolean;
}) {
  // Results are tagged with the request they answer, so a stale response
  // (or the loading state for a new request) is derived, not set in the effect.
  const requestKey = `${itemId ?? ""}|${JSON.stringify(filters ?? {})}`;
  const [result, setResult] = useState<{ key: string; rows?: StockMovement[]; error?: string }>({ key: "" });

  useEffect(() => {
    let cancelled = false;
    const load = itemId ? listItemMovements(itemId) : listStockMovements(JSON.parse(requestKey.slice(requestKey.indexOf("|") + 1)));
    load
      .then((r) => !cancelled && setResult({ key: requestKey, rows: r }))
      .catch(() => !cancelled && setResult({ key: requestKey, error: "Couldn't load stock movements." }));
    return () => {
      cancelled = true;
    };
  }, [itemId, requestKey]);

  const current = result.key === requestKey ? result : null;
  const rows = current?.rows ?? null;
  const error = current?.error ?? "";

  if (error) return <p className="login-error">{error}</p>;
  if (rows === null) return <p className="muted">Loading…</p>;
  if (rows.length === 0) return <p className="muted">No stock movements recorded.</p>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>When</th>
          {showItem && <th>Item</th>}
          <th>What</th>
          <th className="amount-cell">Change</th>
          <th className="amount-cell">On hand after</th>
          <th>Reference</th>
          <th>Who</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const ref = movementRefLink(m);
          return (
            <tr key={m.id}>
              <td>{new Date(m.createdAt).toLocaleString()}</td>
              {showItem && <td>{m.itemNumber}</td>}
              <td>{MOVEMENT_REASON_LABEL[m.reason] ?? m.reason}</td>
              <td className={`amount-cell ${m.delta < 0 ? "qty-negative" : ""}`}>
                {m.delta > 0 ? `+${m.delta}` : m.delta}
              </td>
              <td className="amount-cell">{m.qtyAfter}</td>
              <td>{ref ? <Link to={ref.to}>{ref.label}</Link> : "—"}</td>
              <td>{m.actorUsername}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
