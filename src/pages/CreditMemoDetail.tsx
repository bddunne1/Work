import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import SyncPill from "../components/SyncPill";
import { ApiError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { companyAddressLine, getCompanyInfo } from "../lib/companyStore";
import { getCreditMemo, money, voidCreditMemo } from "../lib/invoiceStore";
import type { CreditMemo } from "../types";

export default function CreditMemoDetail() {
  const { number } = useParams<{ number: string }>();
  return <CreditMemoDetailInner key={number} />;
}

function CreditMemoDetailInner() {
  const { number } = useParams<{ number: string }>();
  const canEdit = useCanEdit();
  const [memo, setMemo] = useState<CreditMemo | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!number) return;
    getCreditMemo(number).then((m) => {
      setMemo(m);
      setLoading(false);
    });
  }, [number]);

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

  async function handleVoid() {
    if (!memo) return;
    const reason = prompt(`Void ${memo.creditMemoNumber}? The return stands; the credit is marked void here and in QuickBooks.\n\nReason (required):`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    try {
      setMemo(await voidCreditMemo(memo.creditMemoNumber, reason.trim()));
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The credit memo wasn't voided.");
    }
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <Link to="/invoices?tab=credit-memos" className="link-btn">
          &larr; Back to Credit Memos
        </Link>
        <div className="inline-actions">
          <span className="muted">QuickBooks:</span> <SyncPill sync={memo.sync} />
          <button className="secondary-btn print-btn" onClick={() => window.print()}>
            Print / Preview
          </button>
          {canEdit && memo.status === "ISSUED" && (
            <button type="button" className="secondary-btn danger-btn" onClick={handleVoid}>
              Void Credit Memo
            </button>
          )}
        </div>
      </div>
      {error && <p className="login-error no-print">{error}</p>}

      <div className={`sales-order${memo.status === "VOID" ? " doc-void" : ""}`}>
        {memo.status === "VOID" && <div className="doc-void-banner">VOID{memo.voidReason ? ` · ${memo.voidReason}` : ""}</div>}
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
                  <td className="so-number-view">{memo.creditMemoNumber}</td>
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
              </tr>
            </thead>
            <tbody>
              {memo.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.item}</td>
                  <td>{l.description}</td>
                  <td>{l.um}</td>
                  <td className="amount-cell">{l.qty}</td>
                  <td className="amount-cell">{l.rate.toFixed(4).replace(/0{1,2}$/, "")}</td>
                  <td className="amount-cell">{money(l.amount)}</td>
                  <td>{l.invoiceNumber ? <Link to={`/invoices/${l.invoiceNumber}`}>{l.invoiceNumber}</Link> : <span className="muted">RA price</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="so-footer">
          <div className="so-notes" />
          <table className="totals-table">
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td>{money(memo.subtotal)}</td>
              </tr>
              <tr>
                <td>Sales Tax ({memo.taxRate}%)</td>
                <td>{money(memo.tax)}</td>
              </tr>
              <tr className="total-row">
                <td>Total Credit</td>
                <td>{money(memo.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
