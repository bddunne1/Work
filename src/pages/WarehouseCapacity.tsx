import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import LineChart from "../components/charts/LineChart";
import { listItems } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";
import { computeCapacityMetrics, UTILIZATION_MESSAGES, utilizationLevel } from "../lib/warehouseCapacity";

const LOOKBACK_OPTIONS = [14, 30, 60, 90];

function lbs(v: number): string {
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs`;
}

function days(v: number): string {
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} d`;
}

function monthDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}

export default function WarehouseCapacity() {
  const [lookbackDays, setLookbackDays] = useState(30);
  const [orders] = useState(() => listOrders());
  const [items] = useState(() => listItems());

  const metrics = useMemo(
    () => computeCapacityMetrics(orders, items, lookbackDays),
    [orders, items, lookbackDays]
  );
  const level = utilizationLevel(metrics.utilizationPct);

  const throughputPoints = metrics.dailyThroughput.map((p) => ({ label: monthDay(p.date), value: p.weight }));
  const itemsMissingWeight = items.filter((i) => !i.weight).length;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Warehouse Capacity</h1>
        <p className="muted">
          How much weight is currently staged on the warehouse floor, how long picks typically dwell
          before shipping, and how much the warehouse can hold at once based on that history -
          use it to judge when it's safe to release more picks.
        </p>
      </div>

      {itemsMissingWeight > 0 && (
        <p className="muted capacity-weight-warning">
          {itemsMissingWeight} item{itemsMissingWeight === 1 ? "" : "s"} in the catalog{" "}
          {itemsMissingWeight === 1 ? "has" : "have"} no weight set, so orders containing{" "}
          {itemsMissingWeight === 1 ? "it" : "them"} will under-count. Add weights from{" "}
          <Link to="/items">the Item Catalog</Link> for accurate numbers.
        </p>
      )}

      <div className={`capacity-recommendation capacity-recommendation-${level}`}>
        <div className="capacity-recommendation-headline">
          {metrics.utilizationPct !== null
            ? `${metrics.utilizationPct.toFixed(0)}% of estimated capacity`
            : "Capacity not yet estimated"}
        </div>
        <div className="capacity-recommendation-detail">{UTILIZATION_MESSAGES[level]}</div>
      </div>

      <div className="stat-row analytics-stat-row">
        <div className="stat-card">
          <div className="stat-value">{lbs(metrics.currentLoadWeight)}</div>
          <div className="stat-label">Current Warehouse Load</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{metrics.currentLoadOrders}</div>
          <div className="stat-label">Orders on the Floor</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{metrics.estimatedCapacityWeight !== null ? lbs(metrics.estimatedCapacityWeight) : "—"}</div>
          <div className="stat-label">Estimated Capacity</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{metrics.avgDwellDays !== null ? days(metrics.avgDwellDays) : "—"}</div>
          <div className="stat-label">Avg Dwell Time</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {metrics.avgDailyThroughputWeight !== null ? lbs(metrics.avgDailyThroughputWeight) : "—"}
          </div>
          <div className="stat-label">Avg Daily Shipped</div>
        </div>
      </div>

      <section className="lane-section">
        <div className="ship-locations-header">
          <h2 className="lane-title" style={{ borderColor: "#7c6ff2" }}>
            Daily Shipped Weight
          </h2>
          <label className="form-field capacity-lookback-field">
            Lookback
            <select value={lookbackDays} onChange={(e) => setLookbackDays(Number(e.target.value))}>
              {LOOKBACK_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">
          Estimated capacity and avg dwell time are also computed over this same window, using every
          shipment confirmed in it.
        </p>
        <LineChart points={throughputPoints} valueFormatter={(v) => lbs(v)} color="#7c6ff2" />
      </section>

      <section className="lane-section">
        <h2 className="lane-title" style={{ borderColor: "#7c6ff2" }}>
          Currently on the Floor
        </h2>
        {metrics.agingPicks.length === 0 ? (
          <p className="muted">Nothing staged in the warehouse right now.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>S.O. #</th>
                <th>P.O. #</th>
                <th>Customer</th>
                <th>Released to Floor</th>
                <th>Days in Warehouse</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {metrics.agingPicks.map((p) => {
                const overDwell = metrics.avgDwellDays !== null && p.daysInWarehouse > metrics.avgDwellDays;
                return (
                  <tr key={p.soNumber}>
                    <td>
                      <Link to={`/storage/${p.soNumber}`}>{p.soNumber}</Link>
                    </td>
                    <td>{p.poNumber}</td>
                    <td>{p.customer}</td>
                    <td>{new Date(p.pickedAt).toLocaleDateString()}</td>
                    <td className={overDwell ? "capacity-aging-over" : undefined}>
                      {p.daysInWarehouse.toFixed(1)}
                    </td>
                    <td className="amount-cell">{lbs(p.weight)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
