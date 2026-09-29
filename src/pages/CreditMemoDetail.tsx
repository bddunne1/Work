import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import SyncPill from "../components/SyncPill";
import { ApiError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { companyAddressLine, getCompanyInfo } from "../lib/companyStore";
import { creditMemoPath, getCreditMemo, issueCreditMemo, money, saveCreditMemoDraft, voidCreditMemo, type DraftLineInput } from "../lib/invoiceStore";
import { fromCents, lineAmountCents, taxCents, toCents } from "../lib/money";
import type { CreditMemo } from "../types";

// The credit memo document. A draft (the return has been received,
// Accounting has not issued the credit yet) can have its rates checked and a
// deduction added (a restocking fee) before it is issued and sent to
// QuickBooks.
export default function CreditMemoDetail() {
  const { number } = useParams<{ number: string }>();
  return <CreditMemoDetailInner key={number} />;
}

type EditLine = DraftLineInput & { key: string; amountText: string };

function toEditLines(memo: CreditMemo): EditLine[] {
  return memo.lines.map((l) => ({
    key: l.id,
    id: l.id,
    kind: l.kind,
    item: l.item,
    description: l.description,
    um: l.um,
    qty: l.qty,
    rate: l.rate,
    taxable: l.taxable,
    // A deduction is stored negative and typed as a positive amount.
    amountText: l.kind === "CHARGE" ? String(Math.abs(l.amount)) : String(l.rate),
  }));
}

function CreditMemoDetailInner() {
  const { number: ref } = useParams<{ number: string }>();
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [memo, setMemo] = useState<CreditMemo | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ref) return;
    getCreditMemo(ref).then((m) => {
      setMemo(m);
      if (m) setLines(toEditLines(m));
      setLoading(false);
    });
  }, [ref]);

  const editing = Boolean(memo && memo.status === "DRAFT" && canEdit);

  const preview = useMemo(() => {
    const rows = lines.map((l) => ({ cents: l.kind === "CHARGE" ? Math.round(toCents(l.rate) * l.qty) : lineAmountCents(l.qty, l.rate), taxable: l.taxable }));
    const subtotal = rows.reduce((s, r) => s + r.cents, 0);
    const taxable = rows.reduce((s, r) => s + (r.taxable ? r.cents : 0), 0);
    const tax = taxCents(taxable, memo?.taxRate ?? 0);
    return { rows: rows.map((r) => fromCents(r.cents)), subtotal: fromCents(subtotal), tax: fromCents(tax), total: fromCents(subtotal + tax) };
  }, [lines, memo?.taxRate]);

  if (loading) return <div className="page" />;
  if (!memo) {
    return (
      <div className="page">
        <p>Credit memo not found.</p>
        <Link to="/invoices?tab=credit-memos">&larr; Back to Credit Memos</Link>
      </div>
    );
  }

  const company = getCompanyInfo();

  function updateLine(key: string, patch: Partial<EditLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  }
  function setAmount(l: EditLine, text: string) {
    const n = Number(text);
    const value = Number.isFinite(n) ? n : 0;
    updateLine(l.key, { amountText: text, rate: l.kind === "CHARGE" ? -Math.abs(value) : value });
  }
  function addDeduction() {
    setLines((ls) => [...ls, { key: `new-${Date.now()}-${ls.length}`, kind: "CHARGE", item: "DEDUCTION", description: "Restocking fee", um: "EA", qty: 1, rate: 0, taxable: false, amountText: "" }]);
    setDirty(true);
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
    setDirty(true);
  }
  const payload = (): DraftLineInput[] => lines.map(({ key: _key, amountText: _t, ...l }) => l);

  async function save(): Promise<CreditMemo | undefined> {
    if (!memo) return undefined;
    setBusy(true);
    setError("");
    try {
      const saved = await saveCreditMemoDraft(memo.id, memo.version, payload());
      setMemo(saved);
      setLines(toEditLines(saved));
      setDirty(false);
      return saved;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The draft wasn't saved.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function approveAndIssue() {
    if (!memo) return;
    const current = dirty ? await save() : memo;
    if (!current) return;
    if (!confirm(`Issue this credit for ${money(Number(current.total))}? It gets the next credit memo number and is sent to QuickBooks.`)) return;
    setBusy(true);
    setError("");
    try {
      const issued = await issueCreditMemo(current.id, current.version);
      setMemo(issued);
      setLines(toEditLines(issued));
      navigate(creditMemoPath(issued), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The credit memo wasn't issued.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVoid() {
    if (!memo) return;
    const reason = prompt(`Void ${memo.creditMemoNumber}? The return stands; the credit is marked void here and in QuickBooks.\n\nReason (required):`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    try {
      setMemo(await voidCreditMemo(memo.id, reason.trim()));
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The credit memo wasn't voided.");
    }
  }

  const displayLines = editing ? lines : toEditLines(memo);
  const subtotal = editing ? preview.subtotal : memo.subtotal;
  const tax = editing ? preview.tax : memo.tax;
  const total = editing ? preview.total : memo.total;

  return (
    <div className="page">
      <div className="page-header no-print">
        <Link to="/invoices?tab=credit-memos" className="link-btn">
          &larr; Back to Credit Memos
        </Link>
        <div className="inline-actions">
          <span className="muted">QuickBooks:</span> <SyncPill sync={memo.sync} />
          <button className="secondary-btn print-btn" onClick={() => window.print()} disabled={memo.status === "DRAFT"}>
            Print / Preview
          </button>
          {editing && (
            <>
              <button type="button" className="secondary-btn" onClick={save} disabled={busy || !dirty}>
                Save draft
              </button>
              <button type="button" className="primary-btn" onClick={approveAndIssue} disabled={busy}>
                Approve and issue
              </button>
            </>
          )}
          {canEdit && memo.status === "ISSUED" && (
            <button type="button" className="secondary-btn danger-btn" onClick={handleVoid}>
              Void Credit Memo
            </button>
          )}
        </div>
      </div>
      {error && <p className="login-error no-print">{error}</p>}
      {memo.status === "DRAFT" && (
        <div className="doc-draft-notice no-print">
          <b>Draft.</b> Return received, credit not yet issued. {editing ? "Check the credit rates, add a restocking deduction if one applies, then approve and issue." : "Waiting for Accounting to review and issue it."}
        </div>
      )}

      <div className={`sales-order${memo.status === "VOID" ? " doc-void" : ""}${memo.status === "DRAFT" ? " doc-draft" : ""}`}>
        {memo.status === "VOID" && <div className="doc-void-banner">VOID{memo.voidReason ? ` · ${memo.voidReason}` : ""}</div>}
        {memo.status === "DRAFT" && <div className="doc-void-banner doc-draft-banner">DRAFT</div>}
        <div className="so-header">
          <div className="so-company">
            <div className="so-company-name">{company.name}</div>
            <div className="muted">{companyAddressLine(company)}</div>
            <div className="muted">{company.phone}</div>
          </div>
          <div className="so-meta">
            <h2>Credit Memo</h2>
            <table className="meta-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Return No.</th>
                  <th>Credit Memo No.</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{memo.memoDate}</td>
                  <td>
                    <Link to={`/returns/${memo.raNumber}`}>{memo.raNumber}</Link>
                  </td>
                  <td className="so-number-view">{memo.creditMemoNumber ?? <span className="muted">draft</span>}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="so-addresses">
          <fieldset className="address-box">
            <legend>Credit To</legend>
            <div>{memo.billTo.name}</div>
            <div>{memo.billTo.addressLine1}</div>
            {memo.billTo.addressLine2 && <div>{memo.billTo.addressLine2}</div>}
            <div>
              {memo.billTo.city}, {memo.billTo.state} {memo.billTo.zip}
            </div>
          </fieldset>
        </div>

        <table className="meta-table order-details-table">
          <thead>
            <tr>
              <th>Original S.O. No.</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{memo.soNumber ? <Link to={`/storage/${memo.soNumber}`}>{memo.soNumber}</Link> : "—"}</td>
              <td>{memo.reason || "—"}</td>
            </tr>
          </tbody>
        </table>

        <div className="line-items">
          <table className="data-table line-item-table">
            <thead>
              <tr>
                <th className="col-item">Item</th>
                <th className="col-desc">Description</th>
                <th className="col-um">U/M</th>
                <th className="col-qty">Returned</th>
                <th className="col-rate">Rate</th>
                <th className="col-amount">Credit</th>
                <th>Billed On</th>
                {editing && <th></th>}
              </tr>
            </thead>
            <tbody>
              {displayLines.map((l, i) => {
                const stored = memo.lines.find((x) => x.id === l.id);
                return (
                  <tr key={l.key} className={l.kind === "CHARGE" ? "doc-charge-row" : undefined}>
                    <td>{l.kind === "CHARGE" ? "Deduction" : l.item}</td>
                    <td>{editing ? <input value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} aria-label="Description" /> : l.description}</td>
                    <td>{l.kind === "CHARGE" ? "" : l.um}</td>
                    <td className="amount-cell">{l.kind === "CHARGE" ? "" : l.qty}</td>
                    <td className="amount-cell">
                      {editing && l.kind === "ITEM" ? (
                        <input type="number" step="0.0001" min={0} className="num-input" value={l.amountText} onChange={(e) => setAmount(l, e.target.value)} aria-label="Rate" />
                      ) : editing ? (
                        <span className="inline-actions">
                          <span className="muted">−</span>
                          <input type="number" step="0.01" min={0} className="num-input" value={l.amountText} placeholder="0.00" onChange={(e) => setAmount(l, e.target.value)} aria-label="Deduction" />
                        </span>
                      ) : l.kind === "CHARGE" ? (
                        ""
                      ) : (
                        l.rate.toFixed(4).replace(/0{1,2}$/, "")
                      )}
                    </td>
                    <td className="amount-cell">{money(editing ? preview.rows[i] : Number(stored?.amount ?? 0))}</td>
                    <td>{l.kind === "CHARGE" ? "" : stored?.invoiceNumber ? <Link to={`/invoices/${stored.invoiceNumber}`}>{stored.invoiceNumber}</Link> : <span className="muted">RA price</span>}</td>
                    {editing && (
                      <td>
                        {l.kind === "CHARGE" && (
                          <button type="button" className="row-action-outline danger-link" onClick={() => removeLine(l.key)}>
                            Remove
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {editing && (
            <div className="inline-actions no-print" style={{ marginTop: "0.5rem" }}>
              <button type="button" className="secondary-btn" onClick={addDeduction}>
                + Deduction
              </button>
              <span className="muted">A deduction (restocking, damage) reduces the credit.</span>
            </div>
          )}
        </div>

        <div className="so-footer">
          <div className="so-notes" />
          <table className="totals-table">
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td>{money(subtotal)}</td>
              </tr>
              <tr>
                <td>Sales Tax ({memo.taxRate}%)</td>
                <td>{money(tax)}</td>
              </tr>
              <tr className="total-row">
                <td>Total Credit</td>
                <td>{money(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      {memo.status === "ISSUED" && memo.approvedBy && (
        <p className="muted no-print">
          Issued by {memo.approvedBy}
          {memo.approvedAt ? ` on ${new Date(memo.approvedAt).toLocaleString()}` : ""}.
        </p>
      )}
    </div>
  );
}
