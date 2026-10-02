import { showToast } from "../lib/toast";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import BatchPrintDocs from "../components/BatchPrintDocs";
import LineItemsTable from "../components/LineItemsTable";
import PackCheckPanel from "../components/PackCheckPanel";
import StatusPill from "../components/StatusPill";
import { isConflictError } from "../lib/apiClient";
import { companyAddressLine, getCompanyInfo } from "../lib/companyStore";
import { getOrder, markPrinted } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { orderSubtotal, orderTax, orderTotalLabel } from "../types";

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

  const [includePick, setIncludePick] = useState(true);
  const [includeSlip, setIncludeSlip] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!soNumber) return;
    getOrder(soNumber).then((o) => {
      setOrder(o);
      setLoading(false);
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

  async function reprint() {
    if (!order || (!includePick && !includeSlip)) return;
    // Reprints the documents as they stand; quantities change at the pack
    // check, not here.
    try {
      // Keep the server's copy (new version) - otherwise Mark Shipped right
      // after a reprint is a guaranteed "changed by someone else" 409.
      setOrder(
        await markPrinted(
          order,
          { pickList: includePick, packingSlip: includeSlip },
          pending.map((l) => ({ lineItemId: l.lineItemId, qty: l.qty }))
        )
      );
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
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
          pricesHidden={order.pricesHidden}
        />

        <div className="so-footer">
          <div className="so-notes">
            <div className="so-notes-label muted">Notes</div>
            <div className="so-notes-text">{order.notes || "—"}</div>
          </div>
          {!order.pricesHidden && (
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
                <td>{orderTotalLabel(order)}</td>
              </tr>
            </tbody>
          </table>
          )}
        </div>

        <PackCheckPanel order={order} onChange={setOrder} onShipped={(shipped) => navigate(`/storage/${shipped.soNumber}`)} />

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
