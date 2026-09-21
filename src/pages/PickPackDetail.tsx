import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getOrder, updateOrder } from "../lib/orderStore";
import type { LineItem } from "../types";
import { allocatedQtyFor, shippedQtyFor } from "../types";

type DocumentMode = "pick" | "slip" | null;

export default function PickPackDetail() {
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
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [document, setDocument] = useState<DocumentMode>(null);

  if (!order) {
    return (
      <div className="page">
        <p>Order not found.</p>
        <Link to="/pick-pack">&larr; Back to Pick &amp; Pack</Link>
      </div>
    );
  }

  const selectedLines = pickableLines.filter((li) => selected[li.id]);
  const readyToComplete = pickableLines.length > 0 && pickableLines.every((li) => picked[li.id]);

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

  function togglePicked(lineItemId: string) {
    setPicked((p) => ({ ...p, [lineItemId]: !p[lineItemId] }));
  }

  function printDocument(mode: DocumentMode) {
    setDocument(mode);
    setTimeout(() => window.print(), 50);
  }

  function completePickPack() {
    if (!order || !readyToComplete) return;

    const pendingShipment = pickableLines
      .map((li) => ({ lineItemId: li.id, qty: packQty[li.id] ?? 0 }))
      .filter((l) => l.qty > 0);

    const newAllocationLines = order.lineItems.map((li) => ({
      lineItemId: li.id,
      allocatedQty: 0,
    }));

    updateOrder({
      ...order,
      status: "Pick & Packed",
      pickedAt: new Date().toISOString(),
      pendingShipment,
      allocation: order.allocation
        ? { ...order.allocation, lines: newAllocationLines }
        : order.allocation,
    });
    navigate("/open-picks");
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <button className="link-btn" onClick={() => navigate("/pick-pack")}>
          &larr; Back to Pick &amp; Pack
        </button>
        <div className="inline-actions">
          <button
            className="secondary-btn print-btn"
            disabled={selectedLines.length === 0}
            onClick={() => printDocument("pick")}
          >
            Print Pick List
          </button>
          <button
            className="secondary-btn print-btn"
            disabled={selectedLines.length === 0}
            onClick={() => printDocument("slip")}
          >
            Print Packing Slip
          </button>
        </div>
      </div>

      <div className="sales-order no-print">
        <div className="so-header">
          <div className="so-company">
            <div className="so-company-name">Pick &amp; Pack</div>
            <div className="muted">S.O. #{order.soNumber} · P.O. #{order.poNumber || "—"}</div>
            <div className="muted">{order.billTo.name}</div>
          </div>
        </div>

        <div className="line-items">
          <div className="ship-locations-header">
            <h3>Line items</h3>
            <div className="inline-actions">
              <span className="muted select-hint">Select lines to include on the printed documents</span>
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
                <th>Picked</th>
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
                        onChange={(e) => setQty(li.id, Number(e.target.value), allocated)}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(picked[li.id])}
                        onChange={() => togglePicked(li.id)}
                        aria-label={`Mark ${li.item} picked`}
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
        </div>
      </div>

      {document === "pick" && (
        <div className="sales-order print-only">
          <div className="so-header">
            <div className="so-company">
              <div className="so-company-name">Pick List</div>
              <div className="muted">S.O. #{order.soNumber}</div>
            </div>
            <div className="so-meta">
              <table className="meta-table">
                <thead>
                  <tr>
                    <th>P.O. No.</th>
                    <th>Customer</th>
                    <th>Ship Via</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{order.poNumber || "—"}</td>
                    <td>{order.billTo.name}</td>
                    <td>{order.shipVia || "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <table className="data-table line-item-table">
            <thead>
              <tr>
                <th className="col-item">Item</th>
                <th className="col-desc">Description</th>
                <th className="col-um">U/M</th>
                <th className="col-qty">Qty to Pick</th>
              </tr>
            </thead>
            <tbody>
              {selectedLines.map((li) => (
                <tr key={li.id}>
                  <td>{li.item}</td>
                  <td>{li.description}</td>
                  <td>{li.um}</td>
                  <td className="amount-cell">{packQty[li.id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {document === "slip" && (
        <div className="sales-order print-only">
          <div className="so-header">
            <div className="so-company">
              <div className="so-company-name">Packing Slip</div>
              <div className="muted">S.O. #{order.soNumber} · P.O. #{order.poNumber || "—"}</div>
            </div>
          </div>

          <div className="so-addresses">
            <fieldset className="address-box">
              <legend>Ship To</legend>
              <div>{order.shipTo.name}</div>
              <div>{order.shipTo.addressLine1}</div>
              {order.shipTo.addressLine2 && <div>{order.shipTo.addressLine2}</div>}
              <div>
                {order.shipTo.city}, {order.shipTo.state} {order.shipTo.zip}
              </div>
            </fieldset>
          </div>

          <table className="data-table line-item-table">
            <thead>
              <tr>
                <th className="col-item">Item</th>
                <th className="col-desc">Description</th>
                <th className="col-um">U/M</th>
                <th className="col-qty">Ordered</th>
                <th className="col-qty">Prev. Shipped</th>
                <th className="col-qty">Shipping Now</th>
                <th className="col-qty">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {selectedLines.map((li) => {
                const previouslyShipped = shippedQtyFor(order, li.id);
                const shippingNow = packQty[li.id] ?? 0;
                const remaining = Math.max(0, li.ordered - previouslyShipped - shippingNow);
                return (
                  <tr key={li.id}>
                    <td>{li.item}</td>
                    <td>{li.description}</td>
                    <td>{li.um}</td>
                    <td className="amount-cell">{li.ordered}</td>
                    <td className="amount-cell">{previouslyShipped}</td>
                    <td className="amount-cell">{shippingNow}</td>
                    <td className="amount-cell">{remaining}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
