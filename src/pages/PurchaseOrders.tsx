import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Pager from "../components/Pager";
import { useCanEdit } from "../lib/authContext";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { usePageForFilters } from "../lib/usePagedOrders";
import { searchVendorPos } from "../lib/vendorPoStore";
import type { VendorPurchaseOrder } from "../types";
import { vendorPoCostTotal, vendorPoOutstandingTotal } from "../types";

// Searched and paged on the server (PF-03) rather than downloading every
// PO ever written; newest first.
export default function PurchaseOrders() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const [page, setPage] = usePageForFilters(`${debouncedQuery}|${pageSize}`);
  const requestKey = `${debouncedQuery}|${pageSize}|${page}`;
  const [result, setResult] = useState<{ key: string; rows: VendorPurchaseOrder[]; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    searchVendorPos({ q: debouncedQuery, page, pageSize }).then((r) => !cancelled && setResult({ key: requestKey, ...r }));
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, page, pageSize, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const filtered = current?.rows ?? [];
  const loading = current === null;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Purchase Orders</h1>
        <p className="muted">Outbound orders to vendors for replenishing stock.</p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by PO # or vendor..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {canEdit && (
          <div className="inline-actions">
            <Link to="/purchase-orders/new" className="primary-btn">
              + New Purchase Order
            </Link>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="muted">{loading ? "Loading..." : debouncedQuery ? "No purchase orders match your search." : "No purchase orders yet."}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>PO #</th>
              <th>Vendor</th>
              <th>Order Date</th>
              <th>Status</th>
              <th>Outstanding Qty</th>
              <th>Total Cost</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.poNumber}
                className="clickable-row"
                onClick={() => navigate(`/purchase-orders/${p.poNumber}`)}
              >
                <td>{p.poNumber}</td>
                <td>{p.vendorName}</td>
                <td>{p.orderDate}</td>
                <td>{p.status}</td>
                <td>{vendorPoOutstandingTotal(p)}</td>
                <td>${vendorPoCostTotal(p).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pager page={page} pageSize={pageSize} total={current?.total ?? 0} loading={loading} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}
