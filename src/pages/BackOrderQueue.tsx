import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import LoadFailed from "../components/LoadFailed";
import StatusPill from "../components/StatusPill";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { listBackOrders, setEstimatedShipDate, type BackOrderRow } from "../lib/orderStore";
import { showToast } from "../lib/toast";
import { matchesOrderQuery, orderTotalLabel } from "../types";

// Orders waiting on stock, from GET /api/sales-orders/back-orders (G-06):
// grouped as stock arrived (a receipt landed what they wait on; an analyst
// reviews them, nothing is filled by the system), covered by an open PO,
// and uncovered. Each row shows its short lines, what is free now and the
// first PO that covers each.
const GROUPS: { key: BackOrderRow["group"]; title: string; blurb: string }[] = [
  { key: "arrived", title: "Stock arrived - review", blurb: "A receipt landed stock for a short line. Open each one and decide: allocate what it can take, or hold it again." },
  { key: "covered", title: "Covered by a purchase order", blurb: "Every short line has an open PO; the projected date is the latest expected delivery among them." },
  { key: "uncovered", title: "Not covered", blurb: "At least one short line has no open PO. Purchasing needs to order it." },
];

function coverageLabel(l: BackOrderRow["coverage"][number]): string {
  if (l.coverage === "full") return `${l.item}: ${l.remaining} needed, ${l.free} free`;
  if (l.coverage === "partial") return `${l.item}: ${l.remaining} needed, ${l.free} free`;
  return `${l.item}: ${l.remaining} needed, none free`;
}

export default function BackOrderQueue() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<{ rows: BackOrderRow[]; counts: { arrived: number; covered: number; uncovered: number } } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [applyingFor, setApplyingFor] = useState<string | null>(null);

  const load = () => listBackOrders().then(setData).catch(() => setLoadFailed(true));
  const retry = () => {
    setLoadFailed(false);
    void load();
  };
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => (data?.rows ?? []).filter((o) => matchesOrderQuery(o, query)), [data, query]);

  async function applyEstimate(order: BackOrderRow, date: string) {
    setApplyingFor(order.soNumber);
    try {
      await setEstimatedShipDate(order, date);
      await load();
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
        await load();
        return;
      }
      throw err;
    } finally {
      setApplyingFor(null);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Back Order Queue</h1>
        <p className="muted">
          Orders that could not be fully allocated. When stock they wait on arrives on a PO they move to the top for review; nothing is
          allocated without an analyst. Open an order to re-run the allocation decision.
        </p>
      </div>
      {loadFailed && <LoadFailed what="the back order queue" onRetry={retry} />}

      <div className="toolbar">
        <input className="search-input" placeholder="Search by S.O. #, P.O. #, or customer..." value={query} onChange={(e) => setQuery(e.target.value)} />
        {data && (
          <p className="muted">
            {data.counts.arrived} to review · {data.counts.covered} covered by a PO · {data.counts.uncovered} not covered
          </p>
        )}
      </div>

      {!data ? (
        <p className="muted">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No orders waiting on stock.</p>
      ) : (
        GROUPS.map((g) => {
          const rows = filtered.filter((o) => o.group === g.key);
          if (rows.length === 0) return null;
          return (
            <section key={g.key} className={`backorder-group backorder-group-${g.key}`}>
              <h2 className="backorder-group-title">
                {g.title} <span className="muted">({rows.length})</span>
              </h2>
              <p className="muted">{g.blurb}</p>
              <div className="scroll-window">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>S.O. #</th>
                      <th>P.O. #</th>
                      <th>Customer</th>
                      <th>Due</th>
                      <th>Short lines</th>
                      <th>{g.key === "covered" ? "Projected arrival" : g.key === "arrived" ? "Arrived" : "Status"}</th>
                      <th>Total</th>
                      {canEdit && g.key === "covered" && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr key={o.soNumber} className="clickable-row" onClick={() => navigate(`/allocation/${o.soNumber}`)}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
                            {o.soNumber}
                          </Link>
                          {o.claim && <span className="queue-claim"> {o.claim.by} has it</span>}
                        </td>
                        <td>{o.poNumber}</td>
                        <td>{o.billTo.name}</td>
                        <td>{o.dueDate}</td>
                        <td>
                          <ul className="backorder-lines">
                            {o.coverage.map((l) => (
                              <li key={l.lineItemId} className={`coverage-${l.coverage}`}>
                                {coverageLabel(l)}
                                {l.po && l.coverage !== "full" && (
                                  <span className="muted">
                                    {" "}
                                    · {l.po.outstanding} on {l.po.poNumber}
                                    {l.po.expectedDate ? ` due ${l.po.expectedDate}` : ""}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td>
                          {g.key === "arrived" ? (
                            <span className={o.fillableNow ? "backorder-fillable" : undefined}>
                              {o.stockArrivedAt ? new Date(o.stockArrivedAt).toLocaleString() : ""}
                              {o.fillableNow ? " · can fill now" : " · partly"}
                            </span>
                          ) : g.key === "covered" ? (
                            o.projectedArrival ? <span className="schedule-ship-date">{o.projectedArrival}</span> : <span className="muted">PO has no expected date</span>
                          ) : (
                            <StatusPill order={o} />
                          )}
                        </td>
                        <td>{orderTotalLabel(o)}</td>
                        {canEdit && g.key === "covered" && (
                          <td onClick={(e) => e.stopPropagation()}>
                            {o.projectedArrival && (
                              <button
                                type="button"
                                className="row-action-outline"
                                disabled={applyingFor === o.soNumber || o.estimatedShipDate === o.projectedArrival}
                                onClick={() => applyEstimate(o, o.projectedArrival!)}
                              >
                                {o.estimatedShipDate === o.projectedArrival ? "Applied" : applyingFor === o.soNumber ? "Applying..." : "Apply to Schedule"}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
