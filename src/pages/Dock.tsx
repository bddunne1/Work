import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import LoadFailed from "../components/LoadFailed";
import { isConflictError } from "../lib/apiClient";
import { acknowledgePull, listOpenOrders, listPendingPulls } from "../lib/orderStore";
import { listShipments, type ShipmentRow } from "../lib/shipmentStore";
import { showToast } from "../lib/toast";
import type { PurchaseOrder } from "../types";

// The warehouse's screen (decided 1 Oct, G-09): a tablet-sized page for the
// shared floor login. Being picked, Ready to ship, Shipped today, Pull from
// floor. No prices anywhere; the pack check is on the pick's own page.
export default function Dock() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [pulls, setPulls] = useState<PurchaseOrder[]>([]);
  const [shipped, setShipped] = useState<ShipmentRow[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pulling, setPulling] = useState<string | null>(null);

  const load = () => {
    const today = new Date().toLocaleDateString("en-CA");
    listOpenOrders()
      .then((os) => setOrders(os.filter((o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0 && o.pickListPrintedAt)))
      .catch(() => setLoadFailed(true));
    listPendingPulls().then(setPulls).catch(() => {});
    listShipments({ from: today, to: today, pageSize: 100 }).then((r) => setShipped(r.rows)).catch(() => {});
  };
  const retry = () => {
    setLoadFailed(false);
    load();
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

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
      } else throw err;
    } finally {
      setPulling(null);
    }
  }

  const picking = (orders ?? []).filter((o) => !o.readyAt);
  const ready = (orders ?? []).filter((o) => o.readyAt);
  const units = (o: PurchaseOrder) => (o.pendingShipment ?? []).reduce((s, l) => s + l.qty, 0);

  const card = (o: PurchaseOrder, sub: string) => (
    <button key={o.soNumber} type="button" className="dock-card" onClick={() => navigate(`/dock/${o.soNumber}`)}>
      <span className="dock-card-so">#{o.soNumber}</span>
      <span className="dock-card-name">{o.shipTo.name || o.billTo.name}</span>
      <span className="dock-card-sub">
        {o.lineItems.length} line{o.lineItems.length === 1 ? "" : "s"} · {units(o)} units · {sub}
      </span>
    </button>
  );

  return (
    <div className="page dock">
      <div className="page-header">
        <h1>Dock</h1>
        <p className="muted">Tap a pick to do its pack check or mark it shipped. The list refreshes every minute.</p>
      </div>
      {loadFailed && <LoadFailed what="the floor" onRetry={retry} />}

      {pulls.length > 0 && (
        <section className="dock-stage dock-stage-pull">
          <h2>Pull from floor ({pulls.length})</h2>
          <p className="muted">Cancelled after the pick list printed. Put the goods back and tap Pulled.</p>
          <div className="dock-grid">
            {pulls.map((o) => (
              <div key={o.soNumber} className="dock-card dock-card-static">
                <span className="dock-card-so">#{o.soNumber}</span>
                <span className="dock-card-name">{o.shipTo.name || o.billTo.name}</span>
                <span className="dock-card-sub">{(o.pendingShipment ?? []).map((l) => `${o.lineItems.find((li) => li.id === l.lineItemId)?.item ?? "?"} × ${l.qty}`).join(", ")}</span>
                <button type="button" className="secondary-btn" disabled={pulling !== null} onClick={() => markPulled(o)}>
                  {pulling === o.soNumber ? "Saving…" : "Pulled"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="dock-stage">
        <h2>Being picked ({picking.length})</h2>
        {orders === null ? <p className="muted">Loading…</p> : picking.length === 0 ? <p className="muted">Nothing to pick.</p> : <div className="dock-grid">{picking.map((o) => card(o, `printed ${o.pickListPrintedAt ? new Date(o.pickListPrintedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}`))}</div>}
      </section>

      <section className="dock-stage dock-stage-ready">
        <h2>Ready to ship ({ready.length})</h2>
        {orders === null ? <p className="muted">Loading…</p> : ready.length === 0 ? <p className="muted">Nothing on the dock.</p> : <div className="dock-grid">{ready.map((o) => card(o, `packed by ${o.readyBy ?? "floor"}`))}</div>}
      </section>

      <section className="dock-stage">
        <h2>Shipped today ({shipped.length})</h2>
        {shipped.length === 0 ? (
          <p className="muted">Nothing yet today.</p>
        ) : (
          <ul className="dock-shipped">
            {shipped.map((r) => (
              <li key={r.id}>
                <Link to={`/dock/${r.soNumber}`}>#{r.soNumber}</Link> {r.customer} · {r.units} units · {new Date(r.shippedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
