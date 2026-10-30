import { showToast } from "../lib/toast";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isConflictError } from "../lib/apiClient";
import { useAuth, useCanEdit } from "../lib/authContext";
import { canEdit as canEditPath } from "../lib/permissions";
import { listInboundForPo } from "../lib/inboundShipmentStore";
import { canView } from "../lib/permissions";
import { getVendorPo, receivePo } from "../lib/vendorPoStore";
import type { InboundShipment, VendorPurchaseOrder, VendorReceivingLine } from "../types";
import { inboundStatusSlug, vendorPoCostTotal, vendorPoLineOutstanding } from "../types";

export default function PurchaseOrderDetail() {
  const { poNumber } = useParams<{ poNumber: string }>();
  // Keyed so navigating directly between two POs on this same route remounts
  // fresh instead of reusing local receiving-quantity state from a previous PO.
  return <PurchaseOrderDetailInner key={poNumber} />;
}

function PurchaseOrderDetailInner() {
  const { poNumber } = useParams<{ poNumber: string }>();
  const { account } = useAuth();
  // Receiving happens here too: the Receiving page links each PO to this
  // view, so dock staff with Receiving edit access (but no Purchase Orders
  // edit access) must be able to receive - the server allows the same.
  const canEdit = useCanEdit() || (account ? canEditPath("/receiving", account) : false);
  const [po, setPo] = useState<VendorPurchaseOrder | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  // Inbound shipments carrying a line of this PO (sprint 4).
  const [inbound, setInbound] = useState<InboundShipment[] | null>(null);
  const canSeeInbound = Boolean(account && canView("/inbound-shipments", account));

  useEffect(() => {
    if (!poNumber) return;
    getVendorPo(poNumber).then((p) => {
      setPo(p);
      setLoading(false);
    });
  }, [poNumber]);

  useEffect(() => {
    if (!poNumber) return;
    // The server lets every PO reader list them; the link only shows where
    // the account can open the page.
    listInboundForPo(poNumber)
      .then(setInbound)
      .catch(() => setInbound([]));
  }, [poNumber, po?.version]);

  if (loading) {
    return <div className="page" />;
  }

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

  async function handleReceive() {
    if (!po) return;
    const lines: VendorReceivingLine[] = po.lines
      .map((l) => ({ lineId: l.id, qty: qtys[l.id] ?? 0 }))
      .filter((l) => l.qty > 0);
    if (lines.length === 0) return;
    try {
      setPo(await receivePo(po, lines));
      setQtys({});
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
        setPo(await getVendorPo(po.poNumber));
        setQtys({});
        return;
      }
      throw err;
    }
  }

  const anyOutstanding = po.lines.some((l) => vendorPoLineOutstanding(l) > 0);
  const anyQtyEntered = Object.values(qtys).some((q) => q > 0);

  // Receive all outstanding (G-08): every line filled with what is still
  // owed; the exceptions are edited before Receive.
  function fillOutstanding() {
    if (!po) return;
    setQtys(Object.fromEntries(po.lines.filter((l) => vendorPoLineOutstanding(l) > 0).map((l) => [l.id, vendorPoLineOutstanding(l)])));
  }

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

      <div className="scroll-window">
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
      </div>

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
          <div className="button-row">
            <button type="button" className="secondary-btn" onClick={fillOutstanding}>
              Receive all outstanding
            </button>
            <button type="button" className="primary-btn" disabled={!anyQtyEntered} onClick={handleReceive}>
              Receive
            </button>
          </div>
        </div>
      )}

      {inbound && inbound.length > 0 && (
        <div className="shipment-history">
          <div className="so-notes-label muted">Inbound Shipments</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Carrier</th>
                <th>Status</th>
                <th>ETA</th>
                <th>Lines from this PO</th>
              </tr>
            </thead>
            <tbody>
              {inbound.map((s) => (
                <tr key={s.id}>
                  <td>{canSeeInbound ? <Link to={`/inbound-shipments/${s.id}`}>{s.reference}</Link> : s.reference}</td>
                  <td>{s.carrier || "—"}</td>
                  <td>
                    <span className={`status-pill inbound-pill inbound-pill-${inboundStatusSlug(s.status)}`}>{s.status}</span>
                  </td>
                  <td>{s.eta ?? "—"}</td>
                  <td>
                    {s.lines
                      .filter((l) => l.poNumber === po.poNumber)
                      .map((l) => `${l.itemNumber} × ${l.qty}`)
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
