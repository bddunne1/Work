import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCapacityLookbackDays } from "../lib/settingsStore";
import type { CapacityMetrics } from "../lib/warehouseCapacity";
import { getCapacityMetrics, UTILIZATION_MESSAGES, utilizationLevel } from "../lib/warehouseCapacity";

// The one-line capacity verdict above Release Orders, from the server's
// figures (D-02) rather than every open order and the window's shipments.
export default function WarehouseCapacityBanner() {
  const [metrics, setMetrics] = useState<CapacityMetrics | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCapacityMetrics(getCapacityLookbackDays())
      .then((m) => !cancelled && setMetrics(m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!metrics) return null;
  const level = utilizationLevel(metrics.utilizationPct);

  return (
    <Link to="/warehouse-capacity" className={`capacity-banner capacity-banner-${level}`}>
      <div className="capacity-banner-headline">
        {metrics.utilizationPct !== null ? (
          <>
            Warehouse at <strong>{metrics.utilizationPct >= 999 ? ">999" : metrics.utilizationPct.toFixed(0)}%</strong> of estimated capacity
          </>
        ) : (
          "Warehouse capacity"
        )}
      </div>
      <div className="capacity-banner-detail">{UTILIZATION_MESSAGES[level]}</div>
    </Link>
  );
}
