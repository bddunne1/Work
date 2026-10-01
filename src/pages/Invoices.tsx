import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Pager from "../components/Pager";
import SyncPill from "../components/SyncPill";
import { creditMemoPath, invoicePath, money, searchCreditMemos, searchInvoices } from "../lib/invoiceStore";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { usePageForFilters } from "../lib/usePagedOrders";
import type { CreditMemo, DocStatus, Invoice } from "../types";

// Invoices (one per shipment) and credit memos (one per received return).
// Both start as drafts: this page opens on the review queue, oldest first,
// where Accounting checks prices, adds freight and other charges, and
// issues each document, which assigns its number and sends it to
// QuickBooks. Issued and void documents are the history behind it.
type Tab = "invoices" | "credit-memos";
type StatusFilter = "" | DocStatus;

function StatusPill({ status }: { status: DocStatus }) {
  const cls = status === "VOID" ? "status-pill-cancelled" : status === "DRAFT" ? "status-pill-entered" : "status-pill-shipped";
  const label = status === "VOID" ? "Void" : status === "DRAFT" ? "Draft" : "Issued";
  return <span className={`status-pill ${cls}`}>{label}</span>;
}

export default function Invoices() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "credit-memos" ? "credit-memos" : "invoices";
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>(() => {
    const s = params.get("status");
    return s === "ISSUED" || s === "VOID" || s === "" ? (s as StatusFilter) : "DRAFT";
  });
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
  const emptyText = (what: string) =>
    debounced ? `No ${what} match your search.` : status === "DRAFT" ? `Nothing to review - every ${what.replace(/s$/, "")} has been issued.` : `No ${what} yet.`;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Invoices</h1>
        <p className="muted">
          A draft invoice is raised for every shipment and a draft credit memo for every received return. Review each one here: check the
          prices, add freight or other charges, then approve and issue it. Only an issued document has a number and goes to QuickBooks.
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
          <option value="DRAFT">To review (drafts)</option>
          <option value="ISSUED">Issued</option>
          <option value="VOID">Void</option>
          <option value="">All</option>
        </select>
      </div>

      {tab === "invoices" ? (
        !invoices ? (
          <p className="muted">Loading...</p>
        ) : invoices.rows.length === 0 ? (
          <p className="muted">{emptyText("invoices")}</p>
        ) : (
          <div className="scroll-window">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>{status === "DRAFT" ? "Shipped" : "Date"}</th>
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
                  <tr key={inv.id} className={`clickable-row${inv.status === "VOID" ? " row-void" : ""}`} onClick={() => navigate(invoicePath(inv))}>
                    <td>{inv.invoiceNumber ?? <span className="muted">Draft</span>}</td>
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
                      <StatusPill status={inv.status} />
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
        <p className="muted">{emptyText("credit memos")}</p>
      ) : (
        <div className="scroll-window">
          <table className="data-table">
            <thead>
              <tr>
                <th>Credit Memo #</th>
                <th>{status === "DRAFT" ? "Received" : "Date"}</th>
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
                <tr key={m.id} className={`clickable-row${m.status === "VOID" ? " row-void" : ""}`} onClick={() => navigate(creditMemoPath(m))}>
                  <td>{m.creditMemoNumber ?? <span className="muted">Draft</span>}</td>
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
                    <StatusPill status={m.status} />
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
