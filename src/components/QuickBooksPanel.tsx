import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/apiClient";
import {
  disconnectQuickBooks, getQuickBooksStatus, listOutbox, reconcileQuickBooks, retryQuickBooks, startQuickBooksConnect, syncQuickBooksNow,
  type OutboxRow, type QuickBooksStatus, type ReconcileReport, type SyncRunSummary,
} from "../lib/integrationStore";

// Settings > QuickBooks: connect the company, watch the queue, retry what
// failed, and reconcile a date range.
export default function QuickBooksPanel() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<QuickBooksStatus | null>(null);
  const [problems, setProblems] = useState<OutboxRow[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);

  async function refresh() {
    try {
      const [s, rows] = await Promise.all([getQuickBooksStatus(), listOutbox("FAILED,DEAD")]);
      setStatus(s);
      setProblems(rows);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Couldn't load the QuickBooks status.");
    }
  }

  useEffect(() => {
    refresh();
    // Back from Intuit's consent screen.
    const result = params.get("quickbooks");
    if (result) {
      setMessage(result === "connected" ? "QuickBooks connected." : `QuickBooks connection failed (${result.replace("error:", "")}).`);
      const next = new URLSearchParams(params);
      next.delete("quickbooks");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(true);
    setMessage("");
    try {
      const out = await fn();
      if (out) setMessage(out);
      await refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  }

  const summarize = (s: SyncRunSummary) =>
    s.reason ? s.reason : `Sync ran: ${s.done} sent, ${s.failed} to retry, ${s.dead} failed for good${s.attempted === 0 ? " (nothing was waiting)" : ""}.`;

  return (
    <div className="import-panel">
      <div className="import-panel-header">
        <div>
          <h3>QuickBooks</h3>
          <p className="muted">
            Invoices and credit memos raised here are pushed to QuickBooks, which keeps the receivables, payments and ledger.
            Customers and items are created there as needed (items as non-inventory; this system is the stock record).
          </p>
        </div>
      </div>

      {!status ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <table className="meta-table">
            <thead>
              <tr>
                <th>Connection</th>
                <th>Company</th>
                <th>Environment</th>
                <th>Queue</th>
                <th>Last success</th>
                <th>Last failure</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  {status.fake ? (
                    <span className="status-pill">Local fake</span>
                  ) : !status.configured ? (
                    <span className="status-pill status-pill-cancelled">Not configured</span>
                  ) : status.connected ? (
                    <span className="status-pill status-pill-shipped">Connected</span>
                  ) : (
                    <span className="status-pill status-pill-backordered">Not connected</span>
                  )}
                  {status.connectedBy && <div className="muted">by {status.connectedBy}</div>}
                </td>
                <td>{status.company?.companyName ?? (status.companyError ? <span className="login-error">{status.companyError}</span> : "—")}</td>
                <td>
                  {status.environment}
                  {!status.tokensEncrypted && status.connected && !status.fake && <div className="muted">tokens not encrypted</div>}
                </td>
                <td>
                  {status.queue.pending} queued · {status.queue.failed} retrying · {status.queue.dead} failed
                </td>
                <td>{status.lastSuccess ? `${new Date(status.lastSuccess.at).toLocaleString()}` : "—"}</td>
                <td>{status.lastFailure ? `${new Date(status.lastFailure.at).toLocaleString()} · ${status.lastFailure.entity}` : "—"}</td>
              </tr>
            </tbody>
          </table>

          <div className="inline-actions">
            {!status.fake && status.configured && !status.connected && (
              <button
                type="button"
                className="primary-btn"
                disabled={busy}
                onClick={() =>
                  run("Connect", async () => {
                    const { url } = await startQuickBooksConnect();
                    window.location.assign(url);
                  })
                }
              >
                Connect to QuickBooks
              </button>
            )}
            {!status.fake && status.connected && (
              <button
                type="button"
                className="secondary-btn danger-btn"
                disabled={busy}
                onClick={() => {
                  if (confirm("Disconnect QuickBooks? Queued documents stay queued until it is reconnected.")) {
                    run("Disconnect", async () => {
                      await disconnectQuickBooks();
                      return "QuickBooks disconnected.";
                    });
                  }
                }}
              >
                Disconnect
              </button>
            )}
            <button type="button" className="secondary-btn" disabled={busy || !status.connected} onClick={() => run("Sync", async () => summarize(await syncQuickBooksNow()))}>
              Sync now
            </button>
            {problems.length > 0 && (
              <button
                type="button"
                className="secondary-btn"
                disabled={busy || !status.connected}
                onClick={() => run("Retry", async () => summarize(await retryQuickBooks(problems.map((p) => p.id))))}
              >
                Retry {problems.length} failed
              </button>
            )}
          </div>
          {!status.configured && !status.fake && (
            <p className="muted">
              To enable: create an app at developer.intuit.com, then set <code>QBO_CLIENT_ID</code>, <code>QBO_CLIENT_SECRET</code> and{" "}
              <code>QBO_REDIRECT_URI</code> (this API's <code>/api/integrations/quickbooks/callback</code>) on the server and restart it.
            </p>
          )}
          {message && <p className={message.includes("failed") ? "login-error" : "muted"}>{message}</p>}

          {problems.length > 0 && (
            <div className="scroll-window">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Last error</th>
                    <th>Next try</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.entityType} {p.entityId}
                      </td>
                      <td>{p.action}</td>
                      <td>{p.status === "DEAD" ? <span className="danger-link">Failed</span> : "Retrying"}</td>
                      <td>{p.attempts}</td>
                      <td>{p.lastError}</td>
                      <td>{p.status === "DEAD" ? "—" : new Date(p.nextAttemptAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="form-row" style={{ alignItems: "flex-end" }}>
            <label className="form-field">
              Reconcile from
              <input id="qbo-reconcile-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="form-field">
              to
              <input id="qbo-reconcile-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <div className="form-field form-field-btn">
              <button
                type="button"
                className="secondary-btn"
                disabled={busy || !status.connected}
                onClick={() =>
                  run("Reconcile", async () => {
                    setReport(await reconcileQuickBooks(from, to));
                  })
                }
              >
                Compare with QuickBooks
              </button>
            </div>
          </div>
          {report && (
            <div className="prose">
              <p className="muted">
                {report.from} to {report.to}: {report.ours} invoice{report.ours === 1 ? "" : "s"} here, {report.theirs} in QuickBooks.
                {report.missingInQuickBooks.length + report.missingHere.length + report.totalMismatch.length + report.voidMismatch.length === 0 && " Everything matches."}
              </p>
              {report.missingInQuickBooks.length > 0 && (
                <p>
                  <b>Not in QuickBooks:</b> {report.missingInQuickBooks.map((m) => `${m.invoiceNumber} (${m.customerName}, $${m.total}, ${m.syncStatus.toLowerCase()})`).join("; ")}
                </p>
              )}
              {report.missingHere.length > 0 && (
                <p>
                  <b>In QuickBooks but not here:</b> {report.missingHere.map((m) => `${m.docNumber} (${m.customerName}, $${m.total})`).join("; ")}
                </p>
              )}
              {report.totalMismatch.length > 0 && (
                <p>
                  <b>Different totals:</b> {report.totalMismatch.map((m) => `${m.invoiceNumber} here $${m.ours}, QuickBooks $${m.theirs}`).join("; ")}
                </p>
              )}
              {report.voidMismatch.length > 0 && (
                <p>
                  <b>Void on one side only:</b> {report.voidMismatch.map((m) => `${m.invoiceNumber} (${m.oursVoid ? "void here" : "void in QuickBooks"})`).join("; ")}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
