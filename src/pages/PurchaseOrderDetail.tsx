import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCanEdit } from "../lib/authContext";
import { getVendorPo, receivePo } from "../lib/vendorPoStore";
import type { VendorPurchaseOrder, VendorReceivingLine } from "../types";
import { vendorPoCostTotal, vendorPoLineOutstanding } from "../types";

export default function PurchaseOrderDetail() {
  const { poNumber } = useParams<{ poNumber: string }>();
  // Keyed so navigating directly between two POs on this same route remounts
  // fresh instead of reusing local receiving-quantity state from a previous PO.
  return <PurchaseOrderDetailInner key={poNumber} />;
}

function PurchaseOrderDetailInner() {
  const { poNumber } = useParams<{ poNumber: string }>();
  const canEdit = useCanEdit();
  const [po, setPo] = useState<VendorPurchaseOrder | undefined>(() =>
    poNumber ? getVendorPo(poNumber) : undefined
  );
  const [qtys, setQtys] = useState<Record<string, number>>({});

  if (!po) {
    return (
      <div className="page">
        <p>Purchase order not found.</p>
        <Link to="/purchase-orders">&larr; Back to Purchase Orders</Link>
      </div>
    );
  }

  function setQty(lineId: string, value: number, max: number) {
    setQtys((q) => ({ ...q, [lineId]: Math.max(0, Math.min(value, max)) }));
  }

  function handleReceive() {
    if (!po) return;
    const lines: VendorReceivingLine[] = po.lines
      .map((l) => ({ lineId: l.id, qty: qtys[l.id] ?? 0 }))
      .filter((l) => l.qty > 0);
    if (lines.length === 0) return;
    setPo(receivePo(po, lines));
    setQtys({});
  }

  const anyOutstanding = po.lines.some((l) => vendorPoLineOutstanding(l) > 0);
  const anyQtyEntered = Object.values(qtys).some((q) => q > 0);

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/purchase-orders" className="link-btn">
          &larr; Back to Purchase Orders
        </Link>
        <h1>Purchase Order #{po.poNumber}</h1>
        <p className="muted">
          {po.vendorName} · Ordered {po.orderDate}
          {po.expectedDate && <> · Expected {po.expectedDate}</>} ·{" "}
          <span className="status-pill">{po.status}</span>
        </p>
      </div>

      <table className="data-table line-item-table">
        <thead>
          <tr>
            <th className="col-item">Item #</th>
            <th className="col-desc">Description</th>
            <th className="col-qty">Ordered</th>
            <th className="col-qty">Received</th>
            <th className="col-qty">Outstanding</th>
            <th className="col-rate">Cost</th>
            {canEdit && anyOutstanding && <th className="col-qty">Receive Now</th>}
          </tr>
        </thead>
        <tbody>
          {po.lines.map((l) => {
            const outstanding = vendorPoLineOutstanding(l);
            return (
              <tr key={l.id}>
                <td>{l.itemNumber}</td>
                <td>{l.description}</td>
                <td className="amount-cell">{l.orderedQty}</td>
                <td className="amount-cell">{l.receivedQty}</td>
                <td className="amount-cell">{outstanding}</td>
                <td className="amount-cell">${l.cost.toFixed(2)}</td>
                {canEdit && anyOutstanding && (
                  <td>
                    {outstanding > 0 ? (
                      <input
                        type="number"
                        className="num-input allocate-qty-input"
                        min={0}
                        max={outstanding}
                        value={qtys[l.id] ?? 0}
                        onChange={(e) => setQty(l.id, Number(e.target.value), outstanding)}
                      />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <table className="totals-table">
        <tbody>
          <tr className="total-row">
            <td>Total Cost</td>
            <td>${vendorPoCostTotal(po).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      {po.notes && (
        <div className="label-notes">
          <span className="muted">Notes</span> {po.notes}
        </div>
      )}

      {canEdit && anyOutstanding && (
        <div className="decision-outcome outcome-success">
          <div className="decision-outcome-label">Receive stock</div>
          <div className="decision-outcome-detail">
            Enter what actually arrived against each line, then receive. Received units are added straight
            to on-hand inventory.
          </div>
          <button type="button" className="primary-btn" disabled={!anyQtyEntered} onClick={handleReceive}>
            Receive
          </button>
        </div>
      )}

      {po.receivingHistory && po.receivingHistory.length > 0 && (
        <div className="shipment-history">
          <div className="so-notes-label muted">Receiving History</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Lines Received</th>
              </tr>
            </thead>
            <tbody>
              {po.receivingHistory.map((rec) => (
                <tr key={rec.id}>
                  <td>{new Date(rec.receivedAt).toLocaleString()}</td>
                  <td>
                    {rec.lines
                      .map((l) => {
                        const line = po.lines.find((x) => x.id === l.lineId);
                        return `${line?.itemNumber ?? l.lineId} × ${l.qty}`;
                      })
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
