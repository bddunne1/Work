import { showToast } from "../lib/toast";
import BackLink from "../components/BackLink";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import BatchPrintDocs from "../components/BatchPrintDocs";
import PackCheckPanel from "../components/PackCheckPanel";
import StatusPill from "../components/StatusPill";
import { isConflictError } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { getOrder, markPrinted } from "../lib/orderStore";
import { canEdit as canEditPath, canView } from "../lib/permissions";
import type { PurchaseOrder } from "../types";
import { statusLabel } from "../types";

// The one pack check page (sprint 5): a printed pick's lines, the pack
// check, Ready to ship and Mark Shipped at pickup. Reached from Open Picks
// (Logistics) and the Dock (the shared floor login) alike; the server takes
// the commands from either page's edit access. Never shows a price.
export default function PackCheck() {
  const { soNumber } = useParams<{ soNumber: string }>();
  return <PackCheckInner key={soNumber} />;
}

function PackCheckInner() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const { account } = useAuth();
  const [order, setOrder] = useState<PurchaseOrder | undefined>();
  const [loading, setLoading] = useState(true);
  // The pick list reprint: stays mounted, remounts (and prints) on each click.
  const [printing, setPrinting] = useState<{ order: PurchaseOrder; key: number } | null>(null);

  useEffect(() => {
    if (!soNumber) return;
    getOrder(soNumber).then((o) => {
      setOrder(o);
      setLoading(false);
    });
  }, [soNumber]);

  // Office logins are stamped from their account; the shared floor login
  // (Dock only, no Open Picks) types who picked and who checked.
  const office = Boolean(account && canEditPath("/open-picks", account));
  const canOpenOrder = Boolean(account && canView("/storage", account));
  // Reprinting the pick list is a save (mark-printed): Release Orders or Open Picks edit.
  const canReprintPick = Boolean(account && (canEditPath("/pick-pack", account) || canEditPath("/open-picks", account)));
  const home = account && canView("/open-picks", account) ? "/open-picks" : "/dock";

  if (loading) return <div className="page dock" />;
  if (!order) {
    return (
      <div className="page dock">
        <p>Order not found.</p>
        <BackLink fallback={home} label={home === "/open-picks" ? "Open Picks" : "Dock"} />
      </div>
    );
  }
  const onFloor = order.status === "Pick & Packed" && (order.pendingShipment?.length ?? 0) > 0;

  async function reprintPick() {
    if (!order) return;
    let stamped: PurchaseOrder;
    try {
      // Keep the server's copy (new version) - otherwise Mark Shipped right
      // after a reprint is a guaranteed "changed by someone else" 409.
      stamped = await markPrinted(order, { pickList: true }, (order.pendingShipment ?? []).map((l) => ({ lineItemId: l.lineItemId, qty: l.qty })));
      setOrder(stamped);
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
        setOrder(await getOrder(order.soNumber));
        return;
      }
      throw err;
    }
    setPrinting((p) => ({ order: stamped, key: (p?.key ?? 0) + 1 }));
  }

  return (
    <div className="page dock pack-check-page">
      <div className="page-header no-print">
        <BackLink fallback={home} label={home === "/open-picks" ? "Open Picks" : "Dock"} />
        <h1>
          #{order.soNumber} · {order.shipTo.name || order.billTo.name}
        </h1>
        <div className="review-meta">
          <span>
            P.O. #<strong>{order.poNumber || "—"}</strong>
          </span>
          <span className="review-meta-sep">·</span>
          <StatusPill order={order} />
          {order.shipVia && (
            <>
              <span className="review-meta-sep">·</span>
              <span>Ship via {order.shipVia}</span>
            </>
          )}
          {canOpenOrder && (
            <Link to={`/storage/${order.soNumber}`} className="link-btn">
              Sales Order View
            </Link>
          )}
        </div>
      </div>

      {!onFloor ? (
        <p className="stale-status-notice no-print">This order is {statusLabel(order.status)} and has nothing staged on the floor.</p>
      ) : (
        <div className="sales-order no-print">
          <div className="pack-check-shipto">
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
            {order.notes && (
              <div className="so-notes">
                <div className="so-notes-label muted">Order notes</div>
                <div className="so-notes-text">{order.notes}</div>
              </div>
            )}
          </div>

          <PackCheckPanel
            order={order}
            onChange={setOrder}
            askInitials={!office}
            onShipped={(shipped) => navigate(canOpenOrder && office ? `/storage/${shipped.soNumber}` : "/dock")}
          />

          {canReprintPick && (
            <div className="button-row pack-check-reprint">
              <button type="button" className="secondary-btn" onClick={reprintPick}>
                Reprint pick list
              </button>
            </div>
          )}
        </div>
      )}
      {printing && <BatchPrintDocs key={printing.key} orders={[printing.order]} includePick includeSlip={false} autoPrint />}
    </div>
  );
}
