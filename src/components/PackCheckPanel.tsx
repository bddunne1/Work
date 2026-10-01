import { useState } from "react";
import BatchPrintDocs from "./BatchPrintDocs";
import { isConflictError } from "../lib/apiClient";
import { getOrder, readyOrder, shipOrder, unreadyOrder } from "../lib/orderStore";
import { showToast } from "../lib/toast";
import type { PurchaseOrder } from "../types";

// The floor's two steps on a printed pick (decided 1 Oct): the pack check,
// which records the packed quantities (shorts included), marks the order
// Ready to ship and prints the packing slip from what was packed; then
// Mark Shipped at pickup, which ships exactly that. Used by Open Picks
// (Logistics) and the dock screen (the shared warehouse login).
interface Props {
  order: PurchaseOrder;
  onChange: (order: PurchaseOrder) => void;
  // The dock's shared login types the packer's initials; an office login is
  // stamped from its account.
  askInitials?: boolean;
  onShipped?: (order: PurchaseOrder) => void;
}

export default function PackCheckPanel({ order, onChange, askInitials, onShipped }: Props) {
  const pending = order.pendingShipment ?? [];
  const [qtys, setQtys] = useState<Record<string, number>>(() => Object.fromEntries(pending.map((l) => [l.lineItemId, l.qty])));
  const [initials, setInitials] = useState("");
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lineFor = (id: string) => order.lineItems.find((li) => li.id === id);
  const ready = Boolean(order.readyAt);
  const shorts = pending.filter((l) => (qtys[l.lineItemId] ?? 0) < l.qty);

  async function refresh() {
    const fresh = await getOrder(order.soNumber);
    if (fresh) onChange(fresh);
  }

  async function markReady() {
    if (busy) return;
    if (askInitials && !initials.trim()) {
      setError("Type your initials so the pack check says who did it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await readyOrder(
        order,
        pending.map((l) => ({ lineItemId: l.lineItemId, qty: qtys[l.lineItemId] ?? 0 })),
        askInitials ? initials.trim() : undefined
      );
      onChange(updated);
      setPrinting(updated);
      setTimeout(() => {
        window.print();
        setPrinting(null);
      }, 50);
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
        await refresh();
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function backToFloor() {
    if (busy) return;
    setBusy(true);
    try {
      onChange(await unreadyOrder(order));
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
        await refresh();
      } else throw err;
    } finally {
      setBusy(false);
    }
  }

  async function markShipped() {
    if (busy) return;
    setBusy(true);
    try {
      const shipped = await shipOrder(order, pending);
      onChange(shipped);
      onShipped?.(shipped);
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
        await refresh();
      } else throw err;
    } finally {
      setBusy(false);
    }
  }

  function reprintSlip() {
    setPrinting(order);
    setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 50);
  }

  if (pending.length === 0) return <p className="muted">Nothing staged on this order.</p>;

  return (
    <div className="pack-check">
      {!ready ? (
        <>
          <div className="ship-locations-header">
            <h3>Pack check</h3>
          </div>
          <p className="muted">Count what was picked and packed. A short stays short: the packing slip prints from these quantities and the shipment is exactly these.</p>
          <div className="scroll-window">
            <table className="data-table line-item-table">
              <thead>
                <tr>
                  <th className="col-item">Item</th>
                  <th className="col-desc">Description</th>
                  <th className="col-um">U/M</th>
                  <th className="col-qty">Staged</th>
                  <th className="col-qty">Packed</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((l) => {
                  const li = lineFor(l.lineItemId);
                  if (!li) return null;
                  const qty = qtys[l.lineItemId] ?? 0;
                  return (
                    <tr key={l.lineItemId}>
                      <td>{li.item}</td>
                      <td>{li.description}</td>
                      <td>{li.um}</td>
                      <td className="amount-cell">{l.qty}</td>
                      <td>
                        <input
                          type="number"
                          className={`num-input allocate-qty-input ${qty < l.qty ? "short" : ""}`}
                          min={0}
                          max={l.qty}
                          value={qty}
                          onChange={(e) => setQtys((q) => ({ ...q, [l.lineItemId]: Math.max(0, Math.min(l.qty, Number(e.target.value) || 0)) }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {askInitials && (
            <label className="form-field pack-initials">
              Packed by (initials)
              <input value={initials} maxLength={6} onChange={(e) => setInitials(e.target.value.toUpperCase())} placeholder="e.g. KM" />
            </label>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="decision-outcome outcome-success">
            <div className="decision-outcome-label">Ready to ship</div>
            <div className="decision-outcome-detail">
              {shorts.length > 0 ? `${shorts.length} line${shorts.length === 1 ? "" : "s"} short. ` : ""}
              Marks the order ready and prints the packing slip from the packed quantities. Mark Shipped comes when the carrier collects it.
            </div>
            <button type="button" className="primary-btn" disabled={busy} onClick={markReady}>
              {busy ? "Saving…" : "Ready to ship · print packing slip"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="ship-locations-header">
            <h3>Ready to ship</h3>
          </div>
          <p className="muted">
            Packed {order.readyAt ? new Date(order.readyAt).toLocaleString() : ""}
            {order.readyBy ? ` by ${order.readyBy}` : ""}. The packing slip has printed from these quantities.
          </p>
          <div className="scroll-window">
            <table className="data-table line-item-table">
              <thead>
                <tr>
                  <th className="col-item">Item</th>
                  <th className="col-desc">Description</th>
                  <th className="col-um">U/M</th>
                  <th className="col-qty">Packed</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((l) => {
                  const li = lineFor(l.lineItemId);
                  return li ? (
                    <tr key={l.lineItemId}>
                      <td>{li.item}</td>
                      <td>{li.description}</td>
                      <td>{li.um}</td>
                      <td className="amount-cell">{l.qty}</td>
                    </tr>
                  ) : null;
                })}
              </tbody>
            </table>
          </div>
          <div className="decision-outcome outcome-success">
            <div className="decision-outcome-label">Mark shipped at pickup</div>
            <div className="decision-outcome-detail">Ships exactly what was packed. If something changed, send it back to the floor and redo the pack check.</div>
            <div className="button-row">
              <button type="button" className="primary-btn" disabled={busy} onClick={markShipped}>
                {busy ? "Saving…" : "Mark Shipped"}
              </button>
              <button type="button" className="secondary-btn" disabled={busy} onClick={backToFloor}>
                Back to the floor
              </button>
              <button type="button" className="secondary-btn" disabled={busy} onClick={reprintSlip}>
                Reprint packing slip
              </button>
            </div>
          </div>
        </>
      )}
      {printing && <BatchPrintDocs orders={[printing]} includePick={false} includeSlip />}
    </div>
  );
}
