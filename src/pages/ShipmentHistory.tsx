import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Pager from "../components/Pager";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { undoShipment } from "../lib/orderStore";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { usePagedOrders, usePageForFilters } from "../lib/usePagedOrders";
import type { PurchaseOrder } from "../types";
import { itemLabel, orderTotal } from "../types";

function lastShippedAt(shipmentHistory: { shippedAt: string }[]): string | undefined {
  return shipmentHistory.reduce<string | undefined>(
    (latest, rec) => (!latest || rec.shippedAt > latest ? rec.shippedAt : latest),
    undefined
  );
}

// Shipped orders, most recently shipped first - searched, sorted and paged
// on the server (see searchOrders) rather than downloading every order.
export default function ShipmentHistory() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const [page, setPage] = usePageForFilters(`${debouncedQuery}|${pageSize}`);

  const {
    rows: filtered,
    total,
    loading,
    loaded,
    reload,
  } = usePagedOrders({
    status: ["Shipped"],
    q: debouncedQuery,
    page,
    pageSize,
    sort: "shippedAt",
    dir: "desc",
  });

  async function handleUndo(order: PurchaseOrder) {
    const last = (order.shipmentHistory ?? []).at(-1);
    if (!last) return;
    const summary = last.lines.map((l) => `${itemLabel(order, l.lineItemId)} × ${l.qty}`).join(", ");
    if (
      !confirm(
        `Undo the most recent shipment on S.O. #${order.soNumber}? This restores the shipped quantities (${summary}) to on-hand inventory and moves the order back to Open Picks.`
      )
    ) {
      return;
    }
    try {
      await undoShipment(order);
    } catch (err) {
      if (isConflictError(err)) {
        alert(err.message);
        reload();
        return;
      }
      throw err;
    }
    // The order is back in Open Picks now - drop it from this page. If it
    // was the only row on the last page, step back a page.
    if (filtered.length === 1 && page > 1) setPage(page - 1);
    else reload();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Shipment History</h1>
        <p className="muted">Orders that have shipped complete.</p>
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
        <p className="muted">
          {!loaded ? "Loading..." : debouncedQuery ? "No shipped orders match your search." : "No orders have shipped yet."}
        </p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Ship To</th>
              <th>Last Shipped</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const shipped = lastShippedAt(o.shipmentHistory ?? []);
              return (
                <tr
                  key={o.soNumber}
                  className="clickable-row"
                  onClick={() => navigate(`/storage/${o.soNumber}`)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
                      {o.soNumber}
                    </Link>
                  </td>
                  <td>{o.poNumber}</td>
                  <td>{o.billTo.name}</td>
                  <td>
                    {o.shipTo.city}, {o.shipTo.state}
                  </td>
                  <td>{shipped ? new Date(shipped).toLocaleString() : "—"}</td>
                  <td>${orderTotal(o).toFixed(2)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <button
                        type="button"
                        className="row-action-outline danger-link"
                        onClick={() => handleUndo(o)}
                      >
                        Undo Shipment
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Pager
        page={page}
        pageSize={pageSize}
        total={total}
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}
