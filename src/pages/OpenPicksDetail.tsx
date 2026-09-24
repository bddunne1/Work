import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import BatchPrintDocs from "../components/BatchPrintDocs";
import LineItemsTable from "../components/LineItemsTable";
import StatusPill from "../components/StatusPill";
import { isConflictError } from "../lib/apiClient";
import { companyAddressLine, getCompanyInfo } from "../lib/companyStore";
import { getOrder, shipOrder, updateOrder } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { orderSubtotal, orderTax, orderTotal, remainingToShip } from "../types";

export default function OpenPicksDetail() {
  const { soNumber } = useParams<{ soNumber: string }>();
  // Keyed so navigating directly between two orders on this same route
  // remounts fresh instead of reusing local edit state from a previous order.
  return <OpenPicksDetailInner key={soNumber} />;
}

function OpenPicksDetailInner() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<PurchaseOrder | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const pending = order?.pendingShipment ?? [];

  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [includePick, setIncludePick] = useState(true);
  const [includeSlip, setIncludeSlip] = useState(true);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!soNumber) return;
    getOrder(soNumber).then((o) => {
      setOrder(o);
      setLoading(false);
      const q: Record<string, number> = {};
      for (const l of o?.pendingShipment ?? []) q[l.lineItemId] = l.qty;
      setQtys(q);
    });
  }, [soNumber]);

  if (loading) {
    return <div className="page" />;
  }

  if (!order) {
    return (
      <div className="page">
        <p>Order not found.</p>
        <Link to="/open-picks">&larr; Back to Open Picks</Link>
      </div>
    );
  }

  const company = getCompanyInfo();

  function lineFor(lineItemId: string) {
    return order!.lineItems.find((li) => li.id === lineItemId);
  }

  function setQty(lineItemId: string, value: number, max: number) {
    const clamped = Math.max(0, Math.min(value, max));
    setQtys((q) => ({ ...q, [lineItemId]: clamped }));
  }

  async function markShipped() {
    if (!order) return;
    const lines = pending.map((l) => ({ lineItemId: l.lineItemId, qty: qtys[l.lineItemId] ?? 0 }));
    try {
      await shipOrder(order, lines);
    } catch (err) {
      if (isConflictError(err)) {
        alert(err.message);
        setOrder(await getOrder(order.soNumber));
        return;
      }
      throw err;
    }
    navigate(`/storage/${order.soNumber}`);
  }

  async function reprint() {
    if (!order || (!includePick && !includeSlip)) return;
    // Carry any corrected "Actual Shipped" quantities into the reprinted
    // documents (and persist them) so a stock shortfall discovered here
    // reprints a pick list the warehouse can actually fulfill.
    const now = new Date().toISOString();
    try {
      await updateOrder({
        ...order,
        pendingShipment: pending.map((l) => ({ lineItemId: l.lineItemId, qty: qtys[l.lineItemId] ?? l.qty })),
        pickListPrintedAt: includePick ? now : order.pickListPrintedAt,
        packingSlipPrintedAt: includeSlip ? now : order.packingSlipPrintedAt,
      });
    } catch (err) {
      if (isConflictError(err)) {
        alert(err.message);
        setOrder(await getOrder(order.soNumber));
        return;
      }
      throw err;
    }
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 50);
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <Link to="/open-picks" className="link-btn">
          &larr; Back to Open Picks
        </Link>
      </div>

      <div className="sales-order no-print">
        <div className="so-header">
          <div className="so-company">
            <div className="so-company-name">{company.name}</div>
            <div className="muted">{companyAddressLine(company)}</div>
            <div className="muted">{company.phone}</div>
          </div>
          <div className="so-meta">
            <h2>Sales Order</h2>
            <table className="meta-table">
              <thead>
                <tr>
                  <th>Order Date</th>
                  <th>Due Date</th>
                  <th>S.O. No.</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{order.orderDate}</td>
                  <td>{order.dueDate}</td>
                  <td className="so-number-view">{order.soNumber}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="so-addresses">
          <fieldset className="address-box">
            <legend>Bill To</legend>
            <div>{order.billTo.name}</div>
            <div>{order.billTo.addressLine1}</div>
            {order.billTo.addressLine2 && <div>{order.billTo.addressLine2}</div>}
            <div>
              {order.billTo.city}, {order.billTo.state} {order.billTo.zip}
            </div>
          </fieldset>
          <fieldset className="address-box">
            <legend>Ship To</legend>
            <div>{order.shipTo.name}</div>
            <div>{order.shipTo.addressLine1}</div>
            {order.shipTo.addressLine2 && <div>{order.shipTo.addressLine2}</div>}
            <div>
              {order.shipTo.city}, {order.shipTo.state} {order.shipTo.zip}
            </div>
            {order.shipTo.notes && (
              <div className="address-notes-view">
                <span className="muted">Shipping notes:</span> {order.shipTo.notes}
              </div>
            )}
          </fieldset>
        </div>

        <table className="meta-table order-details-table">
          <thead>
            <tr>
              <th>P.O. No.</th>
              <th>Terms</th>
              <th>Rep</th>
              <th>FOB</th>
              <th>Ship Via</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{order.poNumber}</td>
              <td>{order.terms}</td>
              <td>{order.rep}</td>
              <td>{order.fob}</td>
              <td>{order.shipVia}</td>
              <td>
                <StatusPill order={order} />
              </td>
            </tr>
          </tbody>
        </table>

        <LineItemsTable
          items={order.lineItems}
          onChange={() => {}}
          readOnly
          shipmentHistory={order.shipmentHistory}
        />

        <div className="so-footer">
          <div className="so-notes">
            <div className="so-notes-label muted">Notes</div>
            <div className="so-notes-text">{order.notes || "—"}</div>
          </div>
          <table className="totals-table">
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td>${orderSubtotal(order).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Sales Tax ({order.taxRate}%)</td>
                <td>${orderTax(order).toFixed(2)}</td>
              </tr>
              <tr className="total-row">
                <td>Total</td>
                <td>${orderTotal(order).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="line-items">
          <div className="ship-locations-header">
            <h3>Confirm Shipment</h3>
          </div>
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
                  // Cap against what's still open on the order, not what was
                  // originally packed - a reprint after finding more stock
                  // than first packed needs to raise the quantity back up.
                  const maxQty = remainingToShip(order, li);
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
                          max={maxQty}
                          value={qty}
                          onChange={(e) => setQty(l.lineItemId, Number(e.target.value), maxQty)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

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

        <div className="ship-locations-header">
          <h3>Reprint</h3>
        </div>
        <div className="button-row">
          <label className="checkbox-line">
            <input type="checkbox" checked={includePick} onChange={(e) => setIncludePick(e.target.checked)} />
            Pick List
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={includeSlip} onChange={(e) => setIncludeSlip(e.target.checked)} />
            Packing Slip
          </label>
          <button
            type="button"
            className="secondary-btn"
            disabled={!includePick && !includeSlip}
            onClick={reprint}
          >
            Reprint
          </button>
        </div>
      </div>

      {printing && <BatchPrintDocs orders={[order]} includePick={includePick} includeSlip={includeSlip} />}
    </div>
  );
}
