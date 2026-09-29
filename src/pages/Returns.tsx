import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Pager from "../components/Pager";
import { useCanEdit } from "../lib/authContext";
import { searchReturns } from "../lib/returnStore";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { usePageForFilters } from "../lib/usePagedOrders";
import type { ReturnAuthorization } from "../types";
import { returnTotal } from "../types";

// Searched and paged on the server (PF-03); newest first.
export default function Returns() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const [page, setPage] = usePageForFilters(`${debouncedQuery}|${pageSize}`);
  const requestKey = `${debouncedQuery}|${pageSize}|${page}`;
  const [result, setResult] = useState<{ key: string; rows: ReturnAuthorization[]; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    searchReturns({ q: debouncedQuery, page, pageSize }).then((r) => !cancelled && setResult({ key: requestKey, ...r }));
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
        <h1>Returns</h1>
        <p className="muted">Return Authorizations (RAs) issued to customers.</p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by RA #, S.O. #, or customer..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {canEdit && (
          <div className="inline-actions">
            <Link to="/returns/new" className="primary-btn">
              + New Return
            </Link>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="muted">{loading ? "Loading..." : debouncedQuery ? "No returns match your search." : "No returns yet."}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>RA #</th>
              <th>Customer</th>
              <th>Request Date</th>
              <th>Original S.O. #</th>
              <th>Status</th>
              <th>Total Credit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.raNumber}
                className="clickable-row"
                onClick={() => navigate(`/returns/${r.raNumber}`)}
              >
                <td>{r.raNumber}</td>
                <td>{r.billTo.name}</td>
                <td>{r.requestDate}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {r.soNumber ? (
                    <Link to={`/storage/${r.soNumber}`} className="row-action-outline">
                      {r.soNumber}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <span className="status-pill">{r.status}</span>
                </td>
                <td>${returnTotal(r).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pager page={page} pageSize={pageSize} total={current?.total ?? 0} loading={loading} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}
