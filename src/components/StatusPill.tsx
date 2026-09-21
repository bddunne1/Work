import type { PurchaseOrder } from "../types";

export default function StatusPill({
  order,
}: {
  order: Pick<PurchaseOrder, "status" | "pickPackStatus">;
}) {
  return (
    <span className="status-pill-group">
      <span className="status-pill">{order.status}</span>
      {order.status === "Pick & Packed" && order.pickPackStatus && (
        <span className={`pickpack-flag pickpack-flag-${order.pickPackStatus.toLowerCase()}`}>
          {order.pickPackStatus}
        </span>
      )}
    </span>
  );
}
