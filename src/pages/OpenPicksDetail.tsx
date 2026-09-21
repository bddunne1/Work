import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getOrder, updateOrder } from "../lib/orderStore";
import type { ShipmentRecord } from "../types";

export default function OpenPicksDetail() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const order = soNumber ? getOrder(soNumber) : undefined;
  const pending = order?.pendingShipment ?? [];

  const [qtys, setQtys] = useState<Record<string, number>>(() => {
    const q: Record<string, number> = {};
    for (const l of pending) q[l.lineItemId] = l.qty;
    return q;
  });

  if (!order) {
    return (
      <div className="page">
        <p>Order not found.</p>
        <Link to="/open-picks">&larr; Back to Open Picks</Link>
      </div>
    );
  }

  function lineFor(lineItemId: string) {
    return order!.lineItems.find((li) => li.id === lineItemId);
  }

  function setQty(lineItemId: string, value: number, max: number) {
    const clamped = Math.max(0, Math.min(value, max));
    setQtys((q) => ({ ...q, [lineItemId]: clamped }));
  }

  function markShipped() {
    if (!order) return;

    const shippedLines = pending
      .map((l) => ({ lineItemId: l.lineItemId, qty: qtys[l.lineItemId] ?? 0 }))
      .filter((l) => l.qty > 0);

    const shipmentHistory: ShipmentRecord[] = [
      ...(order.shipmentHistory ?? []),
      ...(shippedLines.length > 0
        ? [{ id: crypto.randomUUID(), shippedAt: new Date().toISOString(), lines: shippedLines }]
        : []),
    ];

    const shippedFor = (lineItemId: string) =>
      shipmentHistory.reduce((sum, rec) => {
        const line = rec.lines.find((l) => l.lineItemId === lineItemId);
        return sum + (line?.qty ?? 0);
      }, 0);

    const fullyShipped = order.lineItems.every((li) => shippedFor(li.id) >= li.ordered);

    updateOrder({
      ...order,
      status: fullyShipped ? "Shipped" : "Backordered",
      shipmentHistory,
      pendingShipment: [],
    });
    navigate(`/storage/${order.soNumber}`);
  }

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/open-picks" className="link-btn">
          &larr; Back to Open Picks
        </Link>
        <h1>Confirm Shipment S.O. #{order.soNumber}</h1>
        <p className="muted">
          P.O. #{order.poNumber || "—"} · {order.billTo.name}
        </p>
      </div>

      <div className="sales-order validation-panel">
        {pending.length === 0 ? (
          <p className="muted">Nothing staged to confirm for this order.</p>
        ) : (
          <table className="data-table line-item-table">
            <thead>
              <tr>
                <th className="col-item">Item</th>
                <th className="col-desc">Description</th>
                <th className="col-um">U/M</th>
                <th className="col-qty">Packed</th>
                <th className="col-qty">Actual Shipped</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((l) => {
                const li = lineFor(l.lineItemId);
                if (!li) return null;
                const qty = qtys[l.lineItemId] ?? 0;
                const short = qty < l.qty;
                return (
                  <tr key={l.lineItemId}>
                    <td>{li.item}</td>
                    <td>{li.description}</td>
                    <td>{li.um}</td>
                    <td className="amount-cell">{l.qty}</td>
                    <td>
                      <input
                        type="number"
                        className={`num-input allocate-qty-input ${short ? "short" : ""}`}
                        min={0}
                        max={l.qty}
                        value={qty}
                        onChange={(e) => setQty(l.lineItemId, Number(e.target.value), l.qty)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="decision-outcome outcome-success">
          <div className="decision-outcome-label">Mark as shipped</div>
          <div className="decision-outcome-detail">
            Match the "Actual Shipped" quantities to the physical pick list that came back from the
            warehouse. An order that shipped complete moves to Shipped; anything short goes back to the
            Back Order Queue for reallocation.
          </div>
          <button type="button" className="primary-btn" disabled={pending.length === 0} onClick={markShipped}>
            Mark Shipped
          </button>
        </div>
      </div>
    </div>
  );
}
