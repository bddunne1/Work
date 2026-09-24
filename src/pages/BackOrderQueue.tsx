import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import StatusPill from "../components/StatusPill";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { estimateBackorderShipDate } from "../lib/backorderForecast";
import { listItems } from "../lib/itemStore";
import { listOrders, updateOrder } from "../lib/orderStore";
import { listVendorPos } from "../lib/vendorPoStore";
import type { Item, PurchaseOrder, VendorPurchaseOrder } from "../types";
import { matchesOrderQuery, orderTotal } from "../types";

export default function BackOrderQueue() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [vendorPos, setVendorPos] = useState<VendorPurchaseOrder[]>([]);
  const [applyingFor, setApplyingFor] = useState<string | null>(null);

  useEffect(() => {
    listOrders().then(setAllOrders);
    listItems().then(setItems);
    listVendorPos().then(setVendorPos);
  }, []);

  const orders = useMemo(() => allOrders.filter((o) => o.status === "Backordered"), [allOrders]);
  const filtered = useMemo(() => orders.filter((o) => matchesOrderQuery(o, query)), [orders, query]);

  const estimates = useMemo(() => {
    const map = new Map<string, ReturnType<typeof estimateBackorderShipDate>>();
    for (const o of filtered) {
      map.set(o.soNumber, estimateBackorderShipDate(o, items, vendorPos, allOrders));
    }
    return map;
  }, [filtered, items, vendorPos, allOrders]);

  async function applyEstimate(order: PurchaseOrder, date: string) {
    setApplyingFor(order.soNumber);
    try {
      await updateOrder({ ...order, estimatedShipDate: date });
      setAllOrders(await listOrders());
    } catch (err) {
      if (isConflictError(err)) {
        alert(err.message);
        setAllOrders(await listOrders());
        return;
      }
      throw err;
    } finally {
      setApplyingFor(null);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Back Order Queue</h1>
        <p className="muted">
          Orders that couldn't be fully allocated. Re-check stock to re-run the allocation decision. Est.
          Ship Date is projected from the next open vendor PO covering each short item.
        </p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by S.O. #, P.O. #, or customer..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="muted">No orders waiting on stock.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Total</th>
              <th>Est. Ship Date (Projected)</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const estimate = estimates.get(o.soNumber);
              return (
                <tr key={o.soNumber} className="clickable-row" onClick={() => navigate(`/allocation/${o.soNumber}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
                      {o.soNumber}
                    </Link>
                  </td>
                  <td>{o.poNumber}</td>
                  <td>{o.billTo.name}</td>
                  <td>
                    <StatusPill order={o} />
                  </td>
                  <td>${orderTotal(o).toFixed(2)}</td>
                  <td>
                    {estimate?.estimatedShipDate ? (
                      <span className="schedule-ship-date">{estimate.estimatedShipDate}</span>
                    ) : (
                      <span className="muted">
                        {estimate?.lines.length ? "No open PO covers all short items" : "—"}
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {estimate?.estimatedShipDate && (
                        <button
                          type="button"
                          className="row-action-outline"
                          disabled={applyingFor === o.soNumber || o.estimatedShipDate === estimate.estimatedShipDate}
                          onClick={() => applyEstimate(o, estimate.estimatedShipDate!)}
                        >
                          {o.estimatedShipDate === estimate.estimatedShipDate
                            ? "Applied"
                            : applyingFor === o.soNumber
                              ? "Applying..."
                              : "Apply to Schedule"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
