import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Pager from "../components/Pager";
import SyncPill from "../components/SyncPill";
import { money, searchCreditMemos, searchInvoices } from "../lib/invoiceStore";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { usePageForFilters } from "../lib/usePagedOrders";
import type { CreditMemo, Invoice } from "../types";

// Invoices (one per shipment) and credit memos (one per received return),
// raised automatically by the server. This page is where accounting checks
// what was billed and whether it reached QuickBooks.
type Tab = "invoices" | "credit-memos";
type StatusFilter = "" | "ISSUED" | "VOID";

export default function Invoices() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "credit-memos" ? "credit-memos" : "invoices";
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ISSUED");
  const [pageSize, setPageSize] = useState(50);
  const debounced = useDebouncedValue(query.trim(), 300);
  const [page, setPage] = usePageForFilters(`${tab}|${debounced}|${status}|${pageSize}`);
  const [invoices, setInvoices] = useState<{ rows: Invoice[]; total: number } | null>(null);
  const [memos, setMemos] = useState<{ rows: CreditMemo[]; total: number } | null>(null);

  // Which request the visible rows belong to; a mismatch means one is in flight.
  const requestKey = `${tab}|${debounced}|${status}|${page}|${pageSize}`;
  const [loadedKey, setLoadedKey] = useState("");
  useEffect(() => {
    let cancelled = false;
    const req = { q: debounced, status, page, pageSize };
    const done = () => {
      if (!cancelled) setLoadedKey(requestKey);
    };
    if (tab === "invoices") searchInvoices(req).then((r) => !cancelled && setInvoices(r)).catch(() => {}).finally(done);
    else searchCreditMemos(req).then((r) => !cancelled && setMemos(r)).catch(() => {}).finally(done);
    return () => {
      cancelled = true;
    };
  }, [tab, debounced, status, page, pageSize, requestKey]);
  const loading = loadedKey !== requestKey;

  function setTab(next: Tab) {
    setParams(next === "invoices" ? {} : { tab: next });
  }

  const total = tab === "invoices" ? invoices?.total ?? 0 : memos?.total ?? 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Invoices</h1>
        <p className="muted">
          An invoice is raised for every shipment and a credit memo for every received return, at the prices on the order.
          QuickBooks holds the receivables; the sync column shows whether each document has reached it.
        </p>
      </div>

      <div className="release-tabs" role="tablist" aria-label="Document type">
        <button type="button" role="tab" aria-selected={tab === "invoices"} className={`release-tab${tab === "invoices" ? " is-active" : ""}`} onClick={() => setTab("invoices")}>
          Invoices
        </button>
        <button type="button" role="tab" aria-selected={tab === "credit-memos"} className={`release-tab${tab === "credit-memos" ? " is-active" : ""}`} onClick={() => setTab("credit-memos")}>
          Credit Memos
        </button>
      </div>

      <div className="toolbar">
        <input
          id="invoice-search"
          className="search-input"
          placeholder={tab === "invoices" ? "Search by invoice #, S.O. #, P.O. # or customer..." : "Search by credit memo #, RA #, S.O. # or customer..."}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select id="invoice-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="ISSUED">Issued</option>
          <option value="VOID">Void</option>
          <option value="">All</option>
        </select>
      </div>

      {tab === "invoices" ? (
        !invoices ? (
          <p className="muted">Loading...</p>
        ) : invoices.rows.length === 0 ? (
          <p className="muted">{debounced ? "No invoices match your search." : "No invoices yet - one is raised each time a shipment is confirmed."}</p>
        ) : (
          <div className="scroll-window">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Due</th>
                  <th>Customer</th>
                  <th>S.O. #</th>
                  <th>P.O. #</th>
                  <th className="amount-cell">Total</th>
                  <th>Status</th>
                  <th>QuickBooks</th>
                </tr>
              </thead>
              <tbody>
                {invoices.rows.map((inv) => (
                  <tr key={inv.invoiceNumber} className={`clickable-row${inv.status === "VOID" ? " row-void" : ""}`} onClick={() => navigate(`/invoices/${inv.invoiceNumber}`)}>
                    <td>{inv.invoiceNumber}</td>
                    <td>{inv.invoiceDate}</td>
                    <td>{inv.dueDate}</td>
                    <td>{inv.customerName}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Link to={`/storage/${inv.soNumber}`} className="row-action-outline">
                        {inv.soNumber}
                      </Link>
                    </td>
                    <td>{inv.poNumber || "—"}</td>
                    <td className="amount-cell">{money(inv.total)}</td>
                    <td>
                      <span className={`status-pill ${inv.status === "VOID" ? "status-pill-cancelled" : "status-pill-shipped"}`}>{inv.status === "VOID" ? "Void" : "Issued"}</span>
                    </td>
                    <td>
                      <SyncPill sync={inv.sync} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : !memos ? (
        <p className="muted">Loading...</p>
      ) : memos.rows.length === 0 ? (
        <p className="muted">{debounced ? "No credit memos match your search." : "No credit memos yet - one is raised each time a return is received."}</p>
      ) : (
        <div className="scroll-window">
          <table className="data-table">
            <thead>
              <tr>
                <th>Credit Memo #</th>
                <th>Date</th>
                <th>Customer</th>
                <th>RA #</th>
                <th>S.O. #</th>
                <th className="amount-cell">Total</th>
                <th>Status</th>
                <th>QuickBooks</th>
              </tr>
            </thead>
            <tbody>
              {memos.rows.map((m) => (
                <tr key={m.creditMemoNumber} className={`clickable-row${m.status === "VOID" ? " row-void" : ""}`} onClick={() => navigate(`/invoices/credit-memos/${m.creditMemoNumber}`)}>
                  <td>{m.creditMemoNumber}</td>
                  <td>{m.memoDate}</td>
                  <td>{m.customerName}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to={`/returns/${m.raNumber}`} className="row-action-outline">
                      {m.raNumber}
                    </Link>
                  </td>
                  <td>{m.soNumber || "—"}</td>
                  <td className="amount-cell">{money(m.total)}</td>
                  <td>
                    <span className={`status-pill ${m.status === "VOID" ? "status-pill-cancelled" : "status-pill-shipped"}`}>{m.status === "VOID" ? "Void" : "Issued"}</span>
                  </td>
                  <td>
                    <SyncPill sync={m.sync} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager page={page} pageSize={pageSize} total={total} loading={loading} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}
