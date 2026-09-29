import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import SyncPill from "../components/SyncPill";
import { ApiError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { companyAddressLine, getCompanyInfo } from "../lib/companyStore";
import { getInvoice, invoicePath, issueInvoice, money, saveInvoiceDraft, voidInvoice, type DraftLineInput } from "../lib/invoiceStore";
import { fromCents, lineAmountCents, taxCents, toCents } from "../lib/money";
import type { Invoice } from "../types";

// The invoice document. While it is a draft (the shipment has been
// confirmed, Accounting has not issued it yet) a reviewer can reprice a
// shipped line, add freight and other charges, write a note, and then
// approve and issue it, which assigns the number and sends it to
// QuickBooks. Issued, it is the printable invoice as before.
export default function InvoiceDetail() {
  const { invoiceNumber } = useParams<{ invoiceNumber: string }>();
  return <InvoiceDetailInner key={invoiceNumber} />;
}

const CHARGE_OPTIONS = [
  { code: "FREIGHT", label: "Freight" },
  { code: "HANDLING", label: "Handling" },
  { code: "OTHER", label: "Other charge" },
];

type EditLine = DraftLineInput & { key: string; amountText: string };

function toEditLines(invoice: Invoice): EditLine[] {
  return invoice.lines.map((l) => ({
    key: l.id,
    id: l.id,
    kind: l.kind,
    item: l.item,
    description: l.description,
    um: l.um,
    qty: l.qty,
    rate: l.rate,
    taxable: l.taxable,
    amountText: l.kind === "CHARGE" ? String(l.amount) : String(l.rate),
  }));
}

function InvoiceDetailInner() {
  const { invoiceNumber: ref } = useParams<{ invoiceNumber: string }>();
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [invoice, setInvoice] = useState<Invoice | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ref) return;
    getInvoice(ref).then((i) => {
      setInvoice(i);
      if (i) {
        setLines(toEditLines(i));
        setNotes(i.notes);
      }
      setLoading(false);
    });
  }, [ref]);

  const editing = Boolean(invoice && invoice.status === "DRAFT" && canEdit);

  // Live totals while editing, in cents with the server's rounding.
  const preview = useMemo(() => {
    const rows = lines.map((l) => ({ cents: l.kind === "CHARGE" ? Math.round(toCents(l.rate) * l.qty) : lineAmountCents(l.qty, l.rate), taxable: l.taxable }));
    const subtotal = rows.reduce((s, r) => s + r.cents, 0);
    const taxable = rows.reduce((s, r) => s + (r.taxable ? r.cents : 0), 0);
    const tax = taxCents(taxable, invoice?.taxRate ?? 0);
    return { rows: rows.map((r) => fromCents(r.cents)), subtotal: fromCents(subtotal), tax: fromCents(tax), total: fromCents(subtotal + tax) };
  }, [lines, invoice?.taxRate]);

  if (loading) return <div className="page" />;
  if (!invoice) {
    return (
      <div className="page">
        <p>Invoice not found.</p>
        <Link to="/invoices">&larr; Back to Invoices</Link>
      </div>
    );
  }

  const company = getCompanyInfo();
  const title = invoice.invoiceNumber ?? `Draft for S.O. #${invoice.soNumber}`;

  function updateLine(key: string, patch: Partial<EditLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  }
  function setAmount(l: EditLine, text: string) {
    const n = Number(text);
    updateLine(l.key, { amountText: text, rate: Number.isFinite(n) ? n : 0 });
  }
  function addCharge(code: string) {
    setLines((ls) => [...ls, { key: `new-${Date.now()}-${ls.length}`, kind: "CHARGE", item: code, description: "", um: "EA", qty: 1, rate: 0, taxable: false, amountText: "" }]);
    setDirty(true);
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
    setDirty(true);
  }

  const payload = (): DraftLineInput[] => lines.map(({ key: _key, amountText: _t, ...l }) => l);

  async function save(): Promise<Invoice | undefined> {
    if (!invoice) return undefined;
    setBusy(true);
    setError("");
    try {
      const saved = await saveInvoiceDraft(invoice.id, invoice.version, payload(), notes);
      setInvoice(saved);
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
    if (!invoice) return;
    const current = dirty ? await save() : invoice;
    if (!current) return;
    if (!confirm(`Issue this invoice for ${money(Number(current.total))}? It gets the next invoice number and is sent to QuickBooks. It can then only be voided, not edited.`)) return;
    setBusy(true);
    setError("");
    try {
      const issued = await issueInvoice(current.id, current.version);
      setInvoice(issued);
      setLines(toEditLines(issued));
      navigate(invoicePath(issued), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The invoice wasn't issued.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVoid() {
    if (!invoice) return;
    const reason = prompt(`Void ${invoice.invoiceNumber}? The shipment stands; the invoice is marked void here and in QuickBooks.\n\nReason (required):`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError("A reason is required to void an invoice.");
      return;
    }
    try {
      setInvoice(await voidInvoice(invoice.id, reason.trim()));
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The invoice wasn't voided.");
    }
  }

  const displayLines = editing ? lines : toEditLines(invoice);
  const subtotal = editing ? preview.subtotal : invoice.subtotal;
  const tax = editing ? preview.tax : invoice.tax;
  const total = editing ? preview.total : invoice.total;

  return (
    <div className="page">
      <div className="page-header no-print">
        <Link to={invoice.status === "DRAFT" ? "/invoices?status=DRAFT" : "/invoices"} className="link-btn">
          &larr; Back to Invoices
        </Link>
        <div className="inline-actions">
          <span className="muted">QuickBooks:</span> <SyncPill sync={invoice.sync} />
          <button className="secondary-btn print-btn" onClick={() => window.print()} disabled={invoice.status === "DRAFT"} title={invoice.status === "DRAFT" ? "Issue the invoice before printing it" : undefined}>
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
          {canEdit && invoice.status === "ISSUED" && (
            <button type="button" className="secondary-btn danger-btn" onClick={handleVoid}>
              Void Invoice
            </button>
          )}
        </div>
      </div>
      {error && <p className="login-error no-print">{error}</p>}
      {invoice.status === "DRAFT" && (
        <div className="doc-draft-notice no-print">
          <b>Draft.</b> Confirmed shipment, not yet invoiced. {editing ? "Check the prices, add freight or other charges, then approve and issue. Nothing reaches the customer or QuickBooks until then." : "Waiting for Accounting to review and issue it."}
        </div>
      )}

      <div className={`sales-order${invoice.status === "VOID" ? " doc-void" : ""}${invoice.status === "DRAFT" ? " doc-draft" : ""}`}>
        {invoice.status === "VOID" && <div className="doc-void-banner">VOID{invoice.voidReason ? ` · ${invoice.voidReason}` : ""}</div>}
        {invoice.status === "DRAFT" && <div className="doc-void-banner doc-draft-banner">DRAFT</div>}
        <div className="so-header">
          <div className="so-company">
            <div className="so-company-name">{company.name}</div>
            <div className="muted">{companyAddressLine(company)}</div>
            <div className="muted">{company.phone}</div>
          </div>
          <div className="so-meta">
            <h2>Invoice</h2>
            <table className="meta-table">
              <thead>
                <tr>
                  <th>Invoice Date</th>
                  <th>Due Date</th>
                  <th>Terms</th>
                  <th>Invoice No.</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{invoice.invoiceDate}</td>
                  <td>{invoice.dueDate}</td>
                  <td>{invoice.terms || "—"}</td>
                  <td className="so-number-view">{invoice.invoiceNumber ?? <span className="muted">draft</span>}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="so-addresses">
          <fieldset className="address-box">
            <legend>Bill To</legend>
            <div>{invoice.billTo.name}</div>
            <div>{invoice.billTo.addressLine1}</div>
            {invoice.billTo.addressLine2 && <div>{invoice.billTo.addressLine2}</div>}
            <div>
              {invoice.billTo.city}, {invoice.billTo.state} {invoice.billTo.zip}
            </div>
          </fieldset>
          <fieldset className="address-box">
            <legend>Ship To</legend>
            <div>{invoice.shipTo.name}</div>
            <div>{invoice.shipTo.addressLine1}</div>
            {invoice.shipTo.addressLine2 && <div>{invoice.shipTo.addressLine2}</div>}
            <div>
              {invoice.shipTo.city}, {invoice.shipTo.state} {invoice.shipTo.zip}
            </div>
          </fieldset>
        </div>

        <table className="meta-table order-details-table">
          <thead>
            <tr>
              <th>Your P.O. No.</th>
              <th>Our S.O. No.</th>
              <th>Rep</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{invoice.poNumber || "—"}</td>
              <td>
                <Link to={`/storage/${invoice.soNumber}`}>{invoice.soNumber}</Link>
              </td>
              <td>{invoice.rep || "—"}</td>
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
                <th className="col-qty">Shipped</th>
                <th className="col-rate">Rate</th>
                {editing && <th className="col-um">Taxed</th>}
                <th className="col-amount">Amount</th>
                {editing && <th></th>}
              </tr>
            </thead>
            <tbody>
              {displayLines.map((l, i) => (
                <tr key={l.key} className={l.kind === "CHARGE" ? "doc-charge-row" : undefined}>
                  <td>
                    {l.kind === "CHARGE" && editing ? (
                      <select value={l.item} onChange={(e) => updateLine(l.key, { item: e.target.value })} aria-label="Charge type">
                        {CHARGE_OPTIONS.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    ) : l.kind === "CHARGE" ? (
                      CHARGE_OPTIONS.find((c) => c.code === l.item)?.label ?? l.item
                    ) : (
                      l.item
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <input value={l.description} placeholder={l.kind === "CHARGE" ? "e.g. UPS Ground, 2 cartons" : ""} onChange={(e) => updateLine(l.key, { description: e.target.value })} aria-label="Description" />
                    ) : (
                      l.description
                    )}
                  </td>
                  <td>{l.kind === "CHARGE" ? "" : l.um}</td>
                  <td className="amount-cell">{l.kind === "CHARGE" ? "" : l.qty}</td>
                  <td className="amount-cell">
                    {editing && l.kind === "ITEM" ? (
                      <input type="number" step="0.0001" min={0} className="num-input" value={l.amountText} onChange={(e) => setAmount(l, e.target.value)} aria-label="Rate" />
                    ) : editing ? (
                      <input type="number" step="0.01" min={0} className="num-input" value={l.amountText} placeholder="0.00" onChange={(e) => setAmount(l, e.target.value)} aria-label="Amount" />
                    ) : l.kind === "CHARGE" ? (
                      ""
                    ) : (
                      l.rate.toFixed(4).replace(/0{1,2}$/, "")
                    )}
                  </td>
                  {editing && (
                    <td className="amount-cell">
                      <input type="checkbox" checked={l.taxable} onChange={(e) => updateLine(l.key, { taxable: e.target.checked })} aria-label="Taxable" />
                    </td>
                  )}
                  <td className="amount-cell">{money(editing ? preview.rows[i] : Number(invoice.lines.find((x) => x.id === l.id)?.amount ?? 0))}</td>
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
              ))}
            </tbody>
          </table>
          {editing && (
            <div className="inline-actions no-print" style={{ marginTop: "0.5rem" }}>
              {CHARGE_OPTIONS.map((c) => (
                <button key={c.code} type="button" className="secondary-btn" onClick={() => addCharge(c.code)}>
                  + {c.label}
                </button>
              ))}
              <span className="muted">Charges are added to the invoice; tick Taxed if sales tax applies to them.</span>
            </div>
          )}
        </div>

        <div className="so-footer">
          <div className="so-notes">
            <div className="so-notes-label muted">Notes</div>
            {editing ? (
              <textarea rows={3} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="Shown on the invoice" />
            ) : (
              <div className="so-notes-text">{invoice.notes || "Thank you for your business."}</div>
            )}
          </div>
          <table className="totals-table">
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td>{money(subtotal)}</td>
              </tr>
              <tr>
                <td>Sales Tax ({invoice.taxRate}%)</td>
                <td>{money(tax)}</td>
              </tr>
              <tr className="total-row">
                <td>Total Due</td>
                <td>{money(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {invoice.status === "ISSUED" && invoice.approvedBy && (
        <p className="muted no-print">
          Issued by {invoice.approvedBy}
          {invoice.approvedAt ? ` on ${new Date(invoice.approvedAt).toLocaleString()}` : ""}.
        </p>
      )}
      {invoice.status === "VOID" && (
        <p className="stale-status-notice no-print">
          Voided{invoice.voidedBy ? ` by ${invoice.voidedBy}` : ""}
          {invoice.voidedAt ? ` on ${new Date(invoice.voidedAt).toLocaleDateString()}` : ""}
          {invoice.voidReason ? ` - ${invoice.voidReason}` : ""}
        </p>
      )}
      <span hidden>{title}</span>
    </div>
  );
}
