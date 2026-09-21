import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getOrder, updateOrder } from "../lib/orderStore";
import type { LineItem } from "../types";
import { allocatedQtyFor } from "../types";

export default function PickPackDetail() {
  const { soNumber } = useParams<{ soNumber: string }>();
  // Keyed so navigating directly between two orders on this same route
  // (e.g. via browser back/forward) remounts fresh instead of reusing
  // this component's local edit state with the previous order's line ids.
  return <PickPackDetailInner key={soNumber} />;
}

function PickPackDetailInner() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const order = soNumber ? getOrder(soNumber) : undefined;

  const pickableLines: LineItem[] = (order?.lineItems ?? []).filter(
    (li) => allocatedQtyFor(order!, li.id) > 0
  );

  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const s: Record<string, boolean> = {};
    for (const li of pickableLines) s[li.id] = true;
    return s;
  });
  const [packQty, setPackQty] = useState<Record<string, number>>(() => {
    const q: Record<string, number> = {};
    for (const li of pickableLines) q[li.id] = allocatedQtyFor(order!, li.id);
    return q;
  });

  if (!order) {
    return (
      <div className="page">
        <p>Order not found.</p>
        <Link to="/pick-pack">&larr; Back to Pick &amp; Pack</Link>
      </div>
    );
  }

  const selectedLines = pickableLines.filter((li) => selected[li.id] && (packQty[li.id] ?? 0) > 0);
  const readyToComplete = selectedLines.length > 0;

  function toggleSelected(lineItemId: string) {
    setSelected((s) => ({ ...s, [lineItemId]: !s[lineItemId] }));
  }

  function selectAll() {
    const s: Record<string, boolean> = {};
    for (const li of pickableLines) s[li.id] = true;
    setSelected(s);
  }

  function selectNone() {
    setSelected({});
  }

  function setQty(lineItemId: string, value: number, max: number) {
    const clamped = Math.max(0, Math.min(value, max));
    setPackQty((q) => ({ ...q, [lineItemId]: clamped }));
  }

  function completePickPack() {
    if (!order || !readyToComplete) return;

    const pendingShipment = selectedLines.map((li) => ({ lineItemId: li.id, qty: packQty[li.id] ?? 0 }));

    const newAllocationLines = order.lineItems.map((li) => ({
      lineItemId: li.id,
      allocatedQty: selected[li.id] ? 0 : allocatedQtyFor(order, li.id),
    }));

    updateOrder({
      ...order,
      status: "Pick & Packed",
      pickedAt: new Date().toISOString(),
      pendingShipment,
      pickListPrintedAt: undefined,
      packingSlipPrintedAt: undefined,
      allocation: order.allocation
        ? { ...order.allocation, lines: newAllocationLines }
        : order.allocation,
    });
    navigate("/pick-pack");
  }

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/pick-pack" className="link-btn">
          &larr; Back to Pick &amp; Pack
        </Link>
        <h1>Pick &amp; Pack S.O. #{order.soNumber}</h1>
        <p className="muted">
          P.O. #{order.poNumber || "—"} · {order.billTo.name}
        </p>
      </div>

      <div className="sales-order">
        <div className="line-items">
          <div className="ship-locations-header">
            <h3>Select and adjust lines to pack</h3>
            <div className="inline-actions">
              <button type="button" className="secondary-btn" onClick={selectAll}>
                Select All
              </button>
              <button type="button" className="secondary-btn" onClick={selectNone}>
                Select None
              </button>
            </div>
          </div>
          <table className="data-table line-item-table">
            <thead>
              <tr>
                <th>Select</th>
                <th className="col-item">Item</th>
                <th className="col-desc">Description</th>
                <th className="col-um">U/M</th>
                <th className="col-qty">Ordered</th>
                <th className="col-qty">Allocated</th>
                <th className="col-qty">Pack Qty</th>
              </tr>
            </thead>
            <tbody>
              {pickableLines.map((li) => {
                const allocated = allocatedQtyFor(order, li.id);
                const isSelected = Boolean(selected[li.id]);
                const qty = packQty[li.id] ?? 0;
                const short = qty < allocated;
                return (
                  <tr key={li.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(li.id)}
                        aria-label={`Select ${li.item}`}
                      />
                    </td>
                    <td>{li.item}</td>
                    <td>{li.description}</td>
                    <td>{li.um}</td>
                    <td className="amount-cell">{li.ordered}</td>
                    <td className="amount-cell">{allocated}</td>
                    <td>
                      <input
                        type="number"
                        className={`num-input allocate-qty-input ${short ? "short" : ""}`}
                        min={0}
                        max={allocated}
                        value={qty}
                        disabled={!isSelected}
                        onChange={(e) => setQty(li.id, Number(e.target.value), allocated)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="button-row">
          <button type="button" className="primary-btn" disabled={!readyToComplete} onClick={completePickPack}>
            Complete Pick &amp; Pack
          </button>
          <span className="muted">Adds this order to the print batch queue.</span>
        </div>
      </div>
    </div>
  );
}
