import type { PurchaseOrder } from "../types";

// "Pick & Packed" -> "pick-packed", for a stable per-status CSS hook.
function statusSlug(status: string): string {
  return status
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function StatusPill({
  order,
}: {
  order: Pick<PurchaseOrder, "status" | "pickPackStatus">;
}) {
  return (
    <span className="status-pill-group">
      <span className={`status-pill status-pill-${statusSlug(order.status)}`}>{order.status}</span>
      {order.status === "Pick & Packed" && order.pickPackStatus && (
        <span className={`pickpack-flag pickpack-flag-${order.pickPackStatus.toLowerCase()}`}>
          {order.pickPackStatus}
        </span>
      )}
    </span>
  );
}
