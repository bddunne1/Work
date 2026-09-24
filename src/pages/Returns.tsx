import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCanEdit } from "../lib/authContext";
import { listReturns } from "../lib/returnStore";
import type { ReturnAuthorization } from "../types";
import { matchesReturnQuery, returnTotal } from "../types";

export default function Returns() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [returns, setReturns] = useState<ReturnAuthorization[]>([]);

  useEffect(() => {
    listReturns().then(setReturns);
  }, []);

  const filtered = useMemo(() => returns.filter((r) => matchesReturnQuery(r, query)), [returns, query]);

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
        <p className="muted">No returns yet.</p>
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
    </div>
  );
}
