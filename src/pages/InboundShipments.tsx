import { useEffect, useState } from "react";
import ListWindow from "../components/ListWindow";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import LoadFailed from "../components/LoadFailed";
import Pager from "../components/Pager";
import { useCanEdit } from "../lib/authContext";
import { searchInboundShipments } from "../lib/inboundShipmentStore";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { usePageForFilters } from "../lib/usePagedOrders";
import type { InboundShipment } from "../types";
import { inboundStatusSlug } from "../types";

// Containers and shipments on their way from vendors, soonest ETA first.
// The default view is what is still expected; "All" adds received and
// cancelled shipments. Searched and paged on the server.
export default function InboundShipments() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [params, setParams] = useSearchParams();
  const showAll = params.get("all") === "1";
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const [page, setPage] = usePageForFilters(`${debouncedQuery}|${pageSize}|${showAll}`);
  const requestKey = `${debouncedQuery}|${pageSize}|${showAll}|${page}`;
  const [reloads, setReloads] = useState(0);
  const fetchKey = `${requestKey}|${reloads}`;
  const [result, setResult] = useState<{ key: string; rows: InboundShipment[]; total: number; failed: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    searchInboundShipments({ q: debouncedQuery, open: !showAll, page, pageSize })
      .then((r) => !cancelled && setResult({ key: fetchKey, failed: false, ...r }))
      .catch(() => !cancelled && setResult({ key: fetchKey, rows: [], total: 0, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, page, pageSize, showAll, fetchKey]);

  const current = result?.key === fetchKey ? result : null;
  const loadFailed = current?.failed ?? false;
  const rows = current && !current.failed ? current.rows : [];
  const loading = current === null;
  const today = new Date().toLocaleDateString("en-CA");

  function setShowAll(all: boolean) {
    setParams((p) => {
      if (all) p.set("all", "1");
      else p.delete("all");
      return p;
    });
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Inbound Shipments</h1>
        <p className="muted">
          Containers and shipments on their way from vendors, soonest first. Each one carries lines from one or more purchase orders; the
          Back Order Queue uses its ETA as the projected arrival. Receiving still happens on the PO.
        </p>
      </div>
      {loadFailed && <LoadFailed what="inbound shipments" onRetry={() => setReloads((n) => n + 1)} />}

      <div className="toolbar">
        <div className="release-tabs" role="tablist" aria-label="Which shipments">
          <button type="button" role="tab" aria-selected={!showAll} className={`release-tab${!showAll ? " is-active" : ""}`} onClick={() => setShowAll(false)}>
            Expected
          </button>
          <button type="button" role="tab" aria-selected={showAll} className={`release-tab${showAll ? " is-active" : ""}`} onClick={() => setShowAll(true)}>
            All
          </button>
        </div>
        <input className="search-input" placeholder="Search by reference, carrier, vendor or PO #..." value={query} onChange={(e) => setQuery(e.target.value)} />
        {canEdit && (
          <div className="inline-actions">
            <Link to="/inbound-shipments/new" className="primary-btn">
              + New Inbound Shipment
            </Link>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="muted">
          {loading ? "Loading..." : debouncedQuery ? "No inbound shipments match your search." : showAll ? "No inbound shipments yet." : "Nothing on the water right now."}
        </p>
      ) : (
        <ListWindow reserve={76}>
          <table className="data-table">
            <thead>
              <tr>
                <th>ETA</th>
                <th>Reference</th>
                <th>Carrier</th>
                <th>Vendor</th>
                <th>Status</th>
                <th>ETD</th>
                <th>Purchase Orders</th>
                <th className="col-qty">Units</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const late = s.eta && s.eta < today && !["Received", "Cancelled", "Arrived"].includes(s.status);
                return (
                  <tr key={s.id} className="clickable-row" onClick={() => navigate(`/inbound-shipments/${s.id}`)}>
                    <td className={late ? "is-late" : undefined}>{s.eta ?? <span className="muted">—</span>}{late ? <span className="muted"> · overdue</span> : null}</td>
                    <td>
                      <Link to={`/inbound-shipments/${s.id}`} className="row-action-outline" onClick={(e) => e.stopPropagation()}>
                        {s.reference}
                      </Link>
                    </td>
                    <td>{s.carrier || "—"}</td>
                    <td>{s.vendorName ?? "—"}</td>
                    <td>
                      <span className={`status-pill inbound-pill inbound-pill-${inboundStatusSlug(s.status)}`}>{s.status}</span>
                    </td>
                    <td>{s.etd ?? "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {s.poNumbers.length === 0
                        ? "—"
                        : s.poNumbers.map((po, i) => (
                            <span key={po}>
                              {i > 0 && ", "}
                              <Link to={`/purchase-orders/${po}`}>{po}</Link>
                            </span>
                          ))}
                    </td>
                    <td className="amount-cell">{s.units.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ListWindow>
      )}

      <Pager page={page} pageSize={pageSize} total={current?.total ?? 0} loading={loading} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}
