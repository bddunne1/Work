import { useEffect, useState } from "react";
import ListWindow from "../components/ListWindow";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Pager from "../components/Pager";
import { useCanEdit } from "../lib/authContext";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { usePageForFilters } from "../lib/usePagedOrders";
import { searchVendorPos } from "../lib/vendorPoStore";
import type { VendorPurchaseOrder } from "../types";
import { vendorPoCostTotal, vendorPoOutstandingTotal } from "../types";

type PoTab = "open" | "closed";

// Searched, filtered and paged on the server (PF-03) rather than
// downloading every PO ever written; newest first. Open (Open and Partially
// Received) and Closed (Received and Closed) are tabs, kept in the URL so a
// reload lands on the same one.
export default function PurchaseOrders() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [params, setParams] = useSearchParams();
  const tab: PoTab = params.get("tab") === "closed" ? "closed" : "open";
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const [page, setPage] = usePageForFilters(`${tab}|${debouncedQuery}|${pageSize}`);
  const requestKey = `${tab}|${debouncedQuery}|${pageSize}|${page}`;
  const [result, setResult] = useState<{ key: string; rows: VendorPurchaseOrder[]; total: number; counts: { open: number; closed: number } } | null>(null);

  useEffect(() => {
    let cancelled = false;
    searchVendorPos({ q: debouncedQuery, status: tab, page, pageSize }).then((r) => !cancelled && setResult({ key: requestKey, ...r }));
    return () => {
      cancelled = true;
    };
  }, [tab, debouncedQuery, page, pageSize, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const filtered = current?.rows ?? [];
  const loading = current === null;
  // The last known counts stay on the tabs while the next page loads.
  const counts = (current ?? result)?.counts;

  function setTab(next: PoTab) {
    setParams((p) => {
      if (next === "open") p.delete("tab");
      else p.set("tab", next);
      return p;
    });
  }

  const TABS: { key: PoTab; label: string; count?: number }[] = [
    { key: "open", label: "Open", count: counts?.open },
    { key: "closed", label: "Closed", count: counts?.closed },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Purchase Orders</h1>
        <p className="muted">Outbound orders to vendors for replenishing stock. Open is Open and Partially Received; Closed is Received and Closed.</p>
      </div>

      <div className="toolbar">
        <div className="release-tabs" role="tablist" aria-label="Purchase order status">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`release-tab${tab === t.key ? " is-active" : ""}`} onClick={() => setTab(t.key)}>
              {t.label}
              <span className="release-tab-count">{t.count ?? "…"}</span>
            </button>
          ))}
        </div>
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
        <p className="muted">{loading ? "Loading..." : debouncedQuery ? "No purchase orders match your search." : tab === "open" ? "No open purchase orders." : "No received or closed purchase orders yet."}</p>
      ) : (
        <ListWindow reserve={76}>
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
</ListWindow>
      )}

      <Pager page={page} pageSize={pageSize} total={current?.total ?? 0} loading={loading} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}
