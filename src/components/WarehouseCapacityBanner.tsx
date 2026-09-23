import { Link } from "react-router-dom";
import { listItems } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";
import { computeCapacityMetrics, UTILIZATION_MESSAGES, utilizationLevel } from "../lib/warehouseCapacity";

const LOOKBACK_DAYS = 30;

export default function WarehouseCapacityBanner() {
  const metrics = computeCapacityMetrics(listOrders(), listItems(), LOOKBACK_DAYS);
  const level = utilizationLevel(metrics.utilizationPct);

  return (
    <Link to="/warehouse-capacity" className={`capacity-banner capacity-banner-${level}`}>
      <div className="capacity-banner-headline">
        {metrics.utilizationPct !== null ? (
          <>
            Warehouse at <strong>{metrics.utilizationPct.toFixed(0)}%</strong> of estimated capacity
          </>
        ) : (
          "Warehouse capacity"
        )}
      </div>
      <div className="capacity-banner-detail">{UTILIZATION_MESSAGES[level]}</div>
    </Link>
  );
}
