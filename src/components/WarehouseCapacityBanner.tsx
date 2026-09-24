import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listItems } from "../lib/itemStore";
import { listCapacityOrders } from "../lib/orderStore";
import { getCapacityLookbackDays } from "../lib/settingsStore";
import type { CapacityMetrics } from "../lib/warehouseCapacity";
import { computeCapacityMetrics, UTILIZATION_MESSAGES, utilizationLevel } from "../lib/warehouseCapacity";

export default function WarehouseCapacityBanner() {
  const [metrics, setMetrics] = useState<CapacityMetrics | null>(null);

  useEffect(() => {
    const lookbackDays = getCapacityLookbackDays();
    Promise.all([listItems(), listCapacityOrders(lookbackDays)]).then(([items, orders]) => {
      setMetrics(computeCapacityMetrics(orders, items, lookbackDays));
    });
  }, []);

  if (!metrics) return null;
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
