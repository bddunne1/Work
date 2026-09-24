import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listOrders } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { matchesOrderQuery, orderTotal } from "../types";

type SortKey = "soNumber" | "customer" | "orderDate" | "total";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "orderDate", label: "Order Date" },
  { value: "soNumber", label: "S.O. #" },
  { value: "customer", label: "Customer" },
  { value: "total", label: "Total" },
];

export default function Allocation() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("orderDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    listOrders().then(setAllOrders);
  }, []);

  const pending = useMemo(() => allOrders.filter((o) => o.status === "Checked"), [allOrders]);
  const filtered = useMemo(() => pending.filter((o) => matchesOrderQuery(o, query)), [pending, query]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "soNumber":
          return (Number(a.soNumber) - Number(b.soNumber)) * dir;
        case "customer":
          return a.billTo.name.localeCompare(b.billTo.name) * dir;
        case "total":
          return (orderTotal(a) - orderTotal(b)) * dir;
        case "orderDate":
        default:
          return a.orderDate.localeCompare(b.orderDate) * dir;
      }
    });
  }, [filtered, sortBy, sortDir]);

  function startQueue() {
    if (pending.length === 0) return;
    const queue = pending.map((o) => o.soNumber);
    navigate(`/allocation/${queue[0]}`, { state: { queue, pos: 0 } });
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Allocation</h1>
        <p className="muted">
          Confirm stock availability and allocate full, partial, or hold each checked order per the
          customer's shipping rules.
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
          <label className="sort-control">
            Sort by
            <select
              className="status-filter-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              aria-label="Sort orders by"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary-btn sort-dir-btn"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            title={sortDir === "asc" ? "Ascending - click for descending" : "Descending - click for ascending"}
          >
            {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
          </button>
          <p className="muted">
            {pending.length} order{pending.length === 1 ? "" : "s"} awaiting allocation.
          </p>
          <button type="button" className="primary-btn" disabled={pending.length === 0} onClick={startQueue}>
            Review Queue
          </button>
          <Link to="/back-orders" className="secondary-btn">
            Back Order Queue
          </Link>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="muted">Nothing to allocate right now.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Order Date</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => (
              <tr
                key={o.soNumber}
                className="clickable-row"
                onClick={() => navigate(`/allocation/${o.soNumber}`)}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
                    {o.soNumber}
                  </Link>
                </td>
                <td>{o.poNumber}</td>
                <td>{o.billTo.name}</td>
                <td>{o.orderDate}</td>
                <td>${orderTotal(o).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
