import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import LoadFailed from "../components/LoadFailed";
import { useAuth } from "../lib/authContext";
import { listOpenOrders } from "../lib/orderStore";
import { byOldestFirst, skippedSoNumbers } from "../lib/reviewQueue";
import type { PurchaseOrder } from "../types";
import { matchesOrderQuery, orderTotalLabel } from "../types";

// Orders waiting to be checked, oldest first by due date (R4-19), so the
// backlog is worked in the order it will hurt. Skipped orders (from the
// decision page) stay out of the list for this session.
export default function Validation() {
  const navigate = useNavigate();
  const { account } = useAuth();
  const [query, setQuery] = useState("");
  const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);
  const [showSkipped, setShowSkipped] = useState(false);
  // The person who entered an order cannot check it (G-10), and an order
  // someone else has open is theirs for now (C-08): both stay listed, but
  // Review Queue steps past them.
  const isMine = (o: PurchaseOrder) => Boolean(account && account.role !== "admin" && o.writtenById === account.id);
  const takenBy = (o: PurchaseOrder) => (o.claim && account && o.claim.byId !== account.id ? o.claim.by : null);

  const [loadFailed, setLoadFailed] = useState(false);
  const load = () => listOpenOrders().then(setAllOrders).catch(() => setLoadFailed(true));
  const retry = () => {
    setLoadFailed(false);
    void load();
  };
  useEffect(() => {
    void load();
  }, []);

  // Re-read each render: a Skip on the decision page lands in sessionStorage.
  const skipped = skippedSoNumbers("validation");
  const entered = useMemo(() => allOrders.filter((o) => o.status === "Entered").sort(byOldestFirst), [allOrders]);
  const skippedCount = useMemo(() => entered.filter((o) => skipped.has(o.soNumber)).length, [entered, skipped]);
  const pending = useMemo(() => (showSkipped ? entered : entered.filter((o) => !skipped.has(o.soNumber))), [entered, skipped, showSkipped]);
  const filtered = useMemo(() => pending.filter((o) => matchesOrderQuery(o, query)), [pending, query]);

  function startQueue() {
    const workable = pending.filter((o) => !isMine(o) && !takenBy(o));
    if (workable.length === 0) return;
    const queue = workable.map((o) => o.soNumber);
    navigate(`/validation/${queue[0]}`, { state: { queue, pos: 0 } });
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Validation</h1>
        <p className="muted">Review each order for accuracy, then mark it checked to send it to allocation. Oldest due date first.</p>
      </div>
      {loadFailed && <LoadFailed what="the validation queue" onRetry={retry} />}

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by S.O. #, P.O. #, or customer..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="inline-actions">
          <p className="muted">
            {pending.length} order{pending.length === 1 ? "" : "s"} awaiting validation.
            {skippedCount > 0 && (
              <>
                {" "}
                <button type="button" className="link-btn" onClick={() => setShowSkipped((v) => !v)}>
                  {showSkipped ? "Hide" : "Show"} {skippedCount} skipped
                </button>
              </>
            )}
          </p>
          <button type="button" className="primary-btn" disabled={pending.length === 0} onClick={startQueue}>
            Review Queue
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="muted">Nothing to validate right now.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Order Date</th>
              <th>Due Date</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr
                key={o.soNumber}
                className="clickable-row"
                onClick={() => navigate(`/validation/${o.soNumber}`)}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
                    {o.soNumber}
                  </Link>
                  {skipped.has(o.soNumber) && <span className="muted"> (skipped)</span>}
                  {isMine(o) && <span className="muted" title="You entered this order; another person has to check it"> (yours)</span>}
                  {takenBy(o) && <span className="queue-claim"> {takenBy(o)} has it</span>}
                </td>
                <td>{o.poNumber}</td>
                <td>{o.billTo.name}</td>
                <td>{o.orderDate}</td>
                <td>{o.dueDate}</td>
                <td>{orderTotalLabel(o)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
