import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import LoadFailed from "../components/LoadFailed";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { listItems } from "../lib/itemStore";
import { acknowledgePull, listOpenOrders, listPendingPulls, shipOrder } from "../lib/orderStore";
import { showToast } from "../lib/toast";
import type { PurchaseOrder } from "../types";
import { pendingShipmentWeight, weightIndex } from "../types";

// Logistics' view of the floor (sprint 3): picks being picked and packed
// (pick list printed), picks that passed the pack check and wait on the
// dock as Ready to ship, and cancelled picks to pull back. Mark Shipped
// ships exactly what the pack check packed.
function onFloor(orders: PurchaseOrder[]): PurchaseOrder[] {
  return orders.filter((o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0 && o.pickListPrintedAt);
}

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

export default function OpenPicks() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [pulls, setPulls] = useState<PurchaseOrder[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [weights, setWeights] = useState<Map<string, number>>(new Map());
  const [pulling, setPulling] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [loadFailed, setLoadFailed] = useState(false);
  const load = () => {
    listItems().then((items) => setWeights(weightIndex(items))).catch(() => {});
    listOpenOrders().then((os) => setOrders(onFloor(os))).catch(() => setLoadFailed(true));
    listPendingPulls().then(setPulls).catch(() => {});
  };
  const retry = () => {
    setLoadFailed(false);
    load();
  };
  useEffect(load, []);

  const picking = orders.filter((o) => !o.readyAt);
  const ready = orders.filter((o) => o.readyAt);
  const selectedOrders = ready.filter((o) => selected[o.soNumber]);

  // Cancelled after its pick list printed: the goods are staged on the floor
  // and have to go back on the shelf (A-23).
  async function markPulled(o: PurchaseOrder) {
    if (pulling) return;
    setPulling(o.soNumber);
    try {
      await acknowledgePull(o);
      setPulls((ps) => ps.filter((p) => p.soNumber !== o.soNumber));
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
        setPulls(await listPendingPulls());
      } else {
        throw err;
      }
    } finally {
      setPulling(null);
    }
  }

  // Each order is its own attempt (R4-31): one refusal no longer stops the
  // rest, the button is locked while the batch runs, and the list is
  // reloaded whatever happened, because it is stale either way.
  async function confirmSelected() {
    if (selectedOrders.length === 0 || confirming) return;
    setConfirming(true);
    const failures: string[] = [];
    let shipped = 0;
    for (const o of selectedOrders) {
      try {
        await shipOrder(o, o.pendingShipment ?? []);
        shipped++;
      } catch (err) {
        failures.push(`S.O. #${o.soNumber}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      setOrders(onFloor(await listOpenOrders()));
      setSelected({});
    } finally {
      setConfirming(false);
    }
    if (failures.length > 0) showToast(`${shipped} shipped, ${failures.length} not:\n${failures.join("\n")}`, "error", 12000);
  }

  const row = (o: PurchaseOrder, stage: "picking" | "ready") => (
    <tr key={o.soNumber} className="clickable-row" onClick={() => navigate(`/open-picks/${o.soNumber}`)}>
      {stage === "ready" && (
        <td onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={Boolean(selected[o.soNumber])} onChange={() => setSelected((s) => ({ ...s, [o.soNumber]: !s[o.soNumber] }))} aria-label={`Select S.O. ${o.soNumber}`} />
        </td>
      )}
      <td onClick={(e) => e.stopPropagation()}>
        <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
          {o.soNumber}
        </Link>
      </td>
      <td>{o.poNumber}</td>
      <td>{o.billTo.name}</td>
      <td>{stage === "ready" ? (o.readyAt ? `${new Date(o.readyAt).toLocaleString()}${o.readyBy ? ` · ${o.readyBy}` : ""}` : "—") : o.pickListPrintedAt ? new Date(o.pickListPrintedAt).toLocaleString() : "—"}</td>
      <td>{o.pickedAt ? `${daysSince(o.pickedAt).toFixed(1)} d` : "—"}</td>
      <td className="amount-cell">{pendingShipmentWeight(o, weights).toFixed(0)} lbs</td>
      <td>
        {o.pickPackStatus && <span className={`pickpack-flag pickpack-flag-${o.pickPackStatus.toLowerCase()}`}>{o.pickPackStatus}</span>}
      </td>
    </tr>
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Open Picks</h1>
        <p className="muted">
          What the floor is working on. A printed pick is picked and packed, then checked at the dock: the pack check records what was packed and
          prints the packing slip. Ready orders wait for the carrier; Mark Shipped at pickup ships exactly what was packed.
        </p>
      </div>
      {loadFailed && <LoadFailed what="open picks" onRetry={retry} />}

      {pulls.length > 0 && (
        <section className="pull-list" aria-label="Pull from floor">
          <h2 className="pull-list-title">Pull from floor</h2>
          <p className="muted">These orders were cancelled after their pick list printed. The staged goods go back on the shelf; mark each one pulled once it is.</p>
          <div className="scroll-window">
            <table className="data-table">
              <thead>
                <tr>
                  <th>S.O. #</th>
                  <th>P.O. #</th>
                  <th>Customer</th>
                  <th>Cancelled</th>
                  <th>Reason</th>
                  <th>Staged</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {pulls.map((o) => (
                  <tr key={o.soNumber} className="pull-row">
                    <td>
                      <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
                        {o.soNumber}
                      </Link>
                    </td>
                    <td>{o.poNumber}</td>
                    <td>{o.billTo.name}</td>
                    <td>
                      {o.cancelledAt ? new Date(o.cancelledAt).toLocaleString() : "—"}
                      {o.cancelledBy ? <span className="muted"> by {o.cancelledBy}</span> : null}
                    </td>
                    <td>{o.cancelReason || "—"}</td>
                    <td>{(o.pendingShipment ?? []).map((l) => `${o.lineItems.find((li) => li.id === l.lineItemId)?.item ?? "?"} × ${l.qty}`).join(", ") || "—"}</td>
                    {canEdit && (
                      <td>
                        <button type="button" className="secondary-btn" disabled={pulling !== null} onClick={() => markPulled(o)}>
                          {pulling === o.soNumber ? "Saving…" : "Pulled"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="floor-stage">
        <h2 className="floor-stage-title">
          Ready to ship <span className="muted">({ready.length})</span>
        </h2>
        {ready.length === 0 ? (
          <p className="muted">Nothing on the dock right now.</p>
        ) : (
          <>
            <div className="scroll-window">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>S.O. #</th>
                    <th>P.O. #</th>
                    <th>Customer</th>
                    <th>Packed</th>
                    <th>Days in Warehouse</th>
                    <th>Weight</th>
                    <th>Release</th>
                  </tr>
                </thead>
                <tbody>{ready.map((o) => row(o, "ready"))}</tbody>
              </table>
            </div>
            {canEdit && (
              <div className="button-row">
                <button type="button" className="primary-btn" disabled={selectedOrders.length === 0 || confirming} onClick={confirmSelected}>
                  {confirming ? "Confirming…" : `Mark Shipped (${selectedOrders.length} selected)`}
                </button>
                <span className="muted">Ships exactly what the pack check packed.</span>
              </div>
            )}
          </>
        )}
      </section>

      <section className="floor-stage">
        <h2 className="floor-stage-title">
          Being picked <span className="muted">({picking.length})</span>
        </h2>
        {picking.length === 0 ? (
          <p className="muted">No picks on the floor.</p>
        ) : (
          <div className="scroll-window">
            <table className="data-table">
              <thead>
                <tr>
                  <th>S.O. #</th>
                  <th>P.O. #</th>
                  <th>Customer</th>
                  <th>Pick list printed</th>
                  <th>Days in Warehouse</th>
                  <th>Weight</th>
                  <th>Release</th>
                </tr>
              </thead>
              <tbody>{picking.map((o) => row(o, "picking"))}</tbody>
            </table>
          </div>
        )}
        <p className="muted">Open a pick to do its pack check once it is packed.</p>
      </section>
    </div>
  );
}
