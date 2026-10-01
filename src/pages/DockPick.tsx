import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PackCheckPanel from "../components/PackCheckPanel";
import { getOrder } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { statusLabel } from "../types";

// One pick on the dock screen: the lines to pick, then the pack check, then
// Mark Shipped at pickup. The shared floor login types the packer's initials.
export default function DockPick() {
  const { soNumber } = useParams<{ soNumber: string }>();
  return <DockPickInner key={soNumber} />;
}

function DockPickInner() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<PurchaseOrder | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!soNumber) return;
    getOrder(soNumber).then((o) => {
      setOrder(o);
      setLoading(false);
    });
  }, [soNumber]);

  if (loading) return <div className="page dock" />;
  if (!order) {
    return (
      <div className="page dock">
        <p>Order not found.</p>
        <Link to="/dock">&larr; Back to the dock</Link>
      </div>
    );
  }
  const onFloor = order.status === "Pick & Packed" && (order.pendingShipment?.length ?? 0) > 0;

  return (
    <div className="page dock">
      <div className="page-header no-print">
        <Link to="/dock" className="link-btn">
          &larr; Dock
        </Link>
        <h1>
          #{order.soNumber} · {order.shipTo.name || order.billTo.name}
        </h1>
        <p className="muted">
          P.O. {order.poNumber || "—"} · {statusLabel(order.status)}
          {order.shipTo.notes ? ` · ${order.shipTo.notes}` : ""}
          {order.notes ? ` · ${order.notes}` : ""}
        </p>
      </div>
      {!onFloor ? (
        <p className="stale-status-notice">This order is {statusLabel(order.status)} and has nothing staged on the floor.</p>
      ) : (
        <div className="sales-order no-print">
          <PackCheckPanel order={order} onChange={setOrder} askInitials onShipped={() => navigate("/dock")} />
        </div>
      )}
    </div>
  );
}
