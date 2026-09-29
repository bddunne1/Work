import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import SyncPill from "../components/SyncPill";
import { ApiError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { companyAddressLine, getCompanyInfo } from "../lib/companyStore";
import { getInvoice, money, voidInvoice } from "../lib/invoiceStore";
import type { Invoice } from "../types";

// The printable invoice, laid out like the sales order it came from.
export default function InvoiceDetail() {
  const { invoiceNumber } = useParams<{ invoiceNumber: string }>();
  return <InvoiceDetailInner key={invoiceNumber} />;
}

function InvoiceDetailInner() {
  const { invoiceNumber } = useParams<{ invoiceNumber: string }>();
  const canEdit = useCanEdit();
  const [invoice, setInvoice] = useState<Invoice | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!invoiceNumber) return;
    getInvoice(invoiceNumber).then((i) => {
      setInvoice(i);
      setLoading(false);
    });
  }, [invoiceNumber]);

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

  async function handleVoid() {
    if (!invoice) return;
    const reason = prompt(`Void ${invoice.invoiceNumber}? The shipment stands; the invoice is marked void here and in QuickBooks.\n\nReason (required):`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError("A reason is required to void an invoice.");
      return;
    }
    try {
      setInvoice(await voidInvoice(invoice.invoiceNumber, reason.trim()));
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The invoice wasn't voided.");
    }
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <Link to="/invoices" className="link-btn">
          &larr; Back to Invoices
        </Link>
        <div className="inline-actions">
          <span className="muted">QuickBooks:</span> <SyncPill sync={invoice.sync} />
          <button className="secondary-btn print-btn" onClick={() => window.print()}>
            Print / Preview
          </button>
          {canEdit && invoice.status === "ISSUED" && (
            <button type="button" className="secondary-btn danger-btn" onClick={handleVoid}>
              Void Invoice
            </button>
          )}
        </div>
      </div>
      {error && <p className="login-error no-print">{error}</p>}

      <div className={`sales-order${invoice.status === "VOID" ? " doc-void" : ""}`}>
        {invoice.status === "VOID" && <div className="doc-void-banner">VOID{invoice.voidReason ? ` · ${invoice.voidReason}` : ""}</div>}
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
                  <td className="so-number-view">{invoice.invoiceNumber}</td>
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
                <th className="col-amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.item}</td>
                  <td>{l.description}</td>
                  <td>{l.um}</td>
                  <td className="amount-cell">{l.qty}</td>
                  <td className="amount-cell">{l.rate.toFixed(4).replace(/0{1,2}$/, "")}</td>
                  <td className="amount-cell">{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="so-footer">
          <div className="so-notes">
            <div className="so-notes-label muted">Notes</div>
            <div className="so-notes-text">{invoice.notes || "Thank you for your business."}</div>
          </div>
          <table className="totals-table">
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td>{money(invoice.subtotal)}</td>
              </tr>
              <tr>
                <td>Sales Tax ({invoice.taxRate}%)</td>
                <td>{money(invoice.tax)}</td>
              </tr>
              <tr className="total-row">
                <td>Total Due</td>
                <td>{money(invoice.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {invoice.status === "VOID" && (
        <p className="stale-status-notice no-print">
          Voided{invoice.voidedBy ? ` by ${invoice.voidedBy}` : ""}
          {invoice.voidedAt ? ` on ${new Date(invoice.voidedAt).toLocaleDateString()}` : ""}
          {invoice.voidReason ? ` - ${invoice.voidReason}` : ""}
        </p>
      )}
    </div>
  );
}
