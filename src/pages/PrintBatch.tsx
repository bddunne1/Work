import { useState } from "react";
import { Link } from "react-router-dom";
import { listOrders, updateOrder } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { shippedQtyFor } from "../types";

type DocumentMode = "pick" | "slip" | null;

function lineFor(order: PurchaseOrder, lineItemId: string) {
  return order.lineItems.find((li) => li.id === lineItemId);
}

export default function PrintBatch() {
  const [orders, setOrders] = useState<PurchaseOrder[]>(() =>
    listOrders().filter((o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0)
  );
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const s: Record<string, boolean> = {};
    for (const o of orders) s[o.soNumber] = true;
    return s;
  });
  const [document, setDocument] = useState<DocumentMode>(null);

  const selectedOrders = orders.filter((o) => selected[o.soNumber]);

  function toggleSelected(soNumber: string) {
    setSelected((s) => ({ ...s, [soNumber]: !s[soNumber] }));
  }

  function selectAll() {
    const s: Record<string, boolean> = {};
    for (const o of orders) s[o.soNumber] = true;
    setSelected(s);
  }

  function selectNone() {
    setSelected({});
  }

  function printBatch(mode: DocumentMode) {
    if (selectedOrders.length === 0) return;
    setDocument(mode);
    setTimeout(() => {
      window.print();
      const now = new Date().toISOString();
      for (const o of selectedOrders) {
        updateOrder({ ...o, batchPrintedAt: now });
      }
      setOrders((os) => os.map((o) => (selected[o.soNumber] ? { ...o, batchPrintedAt: now } : o)));
    }, 50);
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <h1>Print Batch</h1>
        <div className="inline-actions">
          <button
            className="secondary-btn print-btn"
            disabled={selectedOrders.length === 0}
            onClick={() => printBatch("pick")}
          >
            Print Pick Lists
          </button>
          <button
            className="secondary-btn print-btn"
            disabled={selectedOrders.length === 0}
            onClick={() => printBatch("slip")}
          >
            Print Packing Slips
          </button>
        </div>
      </div>

      <div className="no-print">
        <p className="muted">
          Orders completed in Pick &amp; Pack, staged here for a single combined print run.
        </p>

        {orders.length === 0 ? (
          <p className="muted">Nothing queued for batch printing right now.</p>
        ) : (
          <>
            <div className="toolbar">
              <p className="muted">
                {selectedOrders.length} of {orders.length} selected
              </p>
              <div className="inline-actions">
                <button type="button" className="secondary-btn" onClick={selectAll}>
                  Select All
                </button>
                <button type="button" className="secondary-btn" onClick={selectNone}>
                  Select None
                </button>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>S.O. #</th>
                  <th>P.O. #</th>
                  <th>Customer</th>
                  <th>Batch Printed</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.soNumber}>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[o.soNumber])}
                        onChange={() => toggleSelected(o.soNumber)}
                        aria-label={`Select S.O. ${o.soNumber}`}
                      />
                    </td>
                    <td>
                      <Link to={`/storage/${o.soNumber}`}>{o.soNumber}</Link>
                    </td>
                    <td>{o.poNumber}</td>
                    <td>{o.billTo.name}</td>
                    <td>
                      {o.batchPrintedAt ? (
                        <span className="status-pill">Printed</span>
                      ) : (
                        <span className="muted">Not printed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {document === "pick" &&
        selectedOrders.map((order, idx) => (
          <div
            key={order.soNumber}
            className={`sales-order print-only ${idx < selectedOrders.length - 1 ? "batch-page-break" : ""}`}
          >
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
                {(order.pendingShipment ?? []).map((l) => {
                  const li = lineFor(order, l.lineItemId);
                  if (!li) return null;
                  return (
                    <tr key={l.lineItemId}>
                      <td>{li.item}</td>
                      <td>{li.description}</td>
                      <td>{li.um}</td>
                      <td className="amount-cell">{l.qty}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {document === "slip" &&
        selectedOrders.map((order, idx) => (
          <div
            key={order.soNumber}
            className={`sales-order print-only ${idx < selectedOrders.length - 1 ? "batch-page-break" : ""}`}
          >
            <div className="so-header">
              <div className="so-company">
                <div className="so-company-name">Packing Slip</div>
                <div className="muted">
                  S.O. #{order.soNumber} · P.O. #{order.poNumber || "—"}
                </div>
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
                {(order.pendingShipment ?? []).map((l) => {
                  const li = lineFor(order, l.lineItemId);
                  if (!li) return null;
                  const previouslyShipped = shippedQtyFor(order, li.id);
                  const remaining = Math.max(0, li.ordered - previouslyShipped - l.qty);
                  return (
                    <tr key={l.lineItemId}>
                      <td>{li.item}</td>
                      <td>{li.description}</td>
                      <td>{li.um}</td>
                      <td className="amount-cell">{li.ordered}</td>
                      <td className="amount-cell">{previouslyShipped}</td>
                      <td className="amount-cell">{l.qty}</td>
                      <td className="amount-cell">{remaining}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
