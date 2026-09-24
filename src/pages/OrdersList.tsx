import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Pager from "../components/Pager";
import StatusPill from "../components/StatusPill";
import { CLOSED_ORDER_STATUSES, OPEN_ORDER_STATUSES } from "../lib/orderStore";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { usePagedOrders, usePageForFilters } from "../lib/usePagedOrders";
import { orderTotal } from "../types";

interface Props {
  closed: boolean;
}

export default function OrdersList({ closed }: Props) {
  return <OrdersListInner key={closed ? "closed" : "open"} closed={closed} />;
}

// Searched, sorted and paged on the server (see searchOrders) - Closed
// Orders alone grows by ~150 orders a day, far too many to download whole.
function OrdersListInner({ closed }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const [page, setPage] = usePageForFilters(`${debouncedQuery}|${pageSize}`);

  const { rows: filtered, total, loading, loaded } = usePagedOrders({
    status: closed ? CLOSED_ORDER_STATUSES : OPEN_ORDER_STATUSES,
    q: debouncedQuery,
    page,
    pageSize,
    sort: "soNumber",
    dir: "desc",
  });

  return (
    <div className="page">
      <div className="page-header">
        <h1>{closed ? "Closed Orders" : "Open Orders"}</h1>
        <p className="muted">
          {closed
            ? "Orders that have shipped complete or been cancelled."
            : "Orders still moving through validation, allocation, and fulfillment."}
        </p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by S.O. #, P.O. #, or customer..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="inline-actions">
          <Link to={closed ? "/open-orders" : "/closed-orders"} className="secondary-btn">
            {closed ? "View Open Orders" : "View Closed Orders"}
          </Link>
          <Link to="/order-entry" className="primary-btn">
            + New Order
          </Link>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="muted">{loaded ? "No orders found." : "Loading..."}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Order Date</th>
              <th>Ship Via</th>
              <th>Status</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
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
                <td>{o.orderDate}</td>
                <td>{o.shipVia}</td>
                <td>
                  <StatusPill order={o} />
                </td>
                <td>${orderTotal(o).toFixed(2)}</td>
              </tr>
            ))}
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
