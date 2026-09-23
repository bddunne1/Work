import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import AddressFields from "../components/AddressFields";
import ItemAutocompleteInput from "../components/ItemAutocompleteInput";
import { useAuth, useCanEdit } from "../lib/authContext";
import { listItems } from "../lib/itemStore";
import { getReturn, updateReturn } from "../lib/returnStore";
import type { Item, ReturnAuthorization, ReturnLine, ReturnStatus } from "../types";
import { returnTotal } from "../types";

const STATUSES: ReturnStatus[] = ["Issued", "Received", "Closed"];

export default function ReturnDetail() {
  const { raNumber } = useParams<{ raNumber: string }>();
  // Keyed so navigating directly between two RAs on this same route remounts
  // fresh instead of reusing local edit state from a previous return.
  return <ReturnDetailInner key={raNumber} />;
}

function ReturnDetailInner() {
  const { raNumber } = useParams<{ raNumber: string }>();
  const { account } = useAuth();
  const canEdit = useCanEdit();
  const [catalog] = useState<Item[]>(() => listItems());
  const [ra, setRa] = useState<ReturnAuthorization | undefined>(() =>
    raNumber ? getReturn(raNumber) : undefined
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReturnAuthorization | undefined>(undefined);

  if (!ra) {
    return (
      <div className="page">
        <p>Return not found.</p>
        <Link to="/returns">&larr; Back to Returns</Link>
      </div>
    );
  }

  const isWriter = Boolean(account && ra.writtenById && ra.writtenById === account.id);
  const canEditRa = canEdit || isWriter;
  const view = editing && draft ? draft : ra;

  function startEdit() {
    setDraft(ra);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(undefined);
    setEditing(false);
  }

  function setField<K extends keyof ReturnAuthorization>(key: K, value: ReturnAuthorization[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function updateLine(id: string, patch: Partial<ReturnLine>) {
    setDraft((d) => (d ? { ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) } : d));
  }

  function applyItemMatch(id: string, item: Item) {
    updateLine(id, { itemNumber: item.itemNumber, description: item.description, um: item.um, rate: item.rate });
  }

  function saveEdit() {
    if (!draft) return;
    updateReturn(draft);
    setRa(draft);
    setDraft(undefined);
    setEditing(false);
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <Link to="/returns" className="link-btn">
          &larr; Back to Returns
        </Link>
        <div className="inline-actions">
          {canEditRa && !editing && (
            <button type="button" className="secondary-btn" onClick={startEdit}>
              Edit Return
            </button>
          )}
          {editing && (
            <>
              <button type="button" className="primary-btn" onClick={saveEdit}>
                Save Changes
              </button>
              <button type="button" className="secondary-btn" onClick={cancelEdit}>
                Cancel
              </button>
            </>
          )}
          {!editing && (
            <button className="secondary-btn print-btn" onClick={() => window.print()}>
              Print / Preview
            </button>
          )}
        </div>
      </div>

      <div className="sales-order">
        <div className="so-header">
          <div className="so-company">
            <div className="so-company-name">Aamstrand Ropes &amp; Twines</div>
            <div className="muted">711 N Grove St, Manteno, IL 60950</div>
            <div className="muted">800-338-0557</div>
          </div>
          <div className="so-meta">
            <h2>Return Authorization</h2>
            <table className="meta-table">
              <thead>
                <tr>
                  <th>Request Date</th>
                  <th>RA No.</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    {editing ? (
                      <input
                        type="date"
                        value={view.requestDate}
                        onChange={(e) => setField("requestDate", e.target.value)}
                      />
                    ) : (
                      view.requestDate
                    )}
                  </td>
                  <td className="so-number-view">{view.raNumber}</td>
                  <td>
                    {editing ? (
                      <select
                        value={view.status}
                        onChange={(e) => setField("status", e.target.value as ReturnStatus)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="status-pill">{view.status}</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {editing ? (
          <div className="so-addresses">
            <AddressFields label="Bill To" value={view.billTo} onChange={(addr) => setField("billTo", addr)} />
          </div>
        ) : (
          <div className="so-addresses">
            <fieldset className="address-box">
              <legend>Bill To</legend>
              <div>{view.billTo.name}</div>
              <div>{view.billTo.addressLine1}</div>
              {view.billTo.addressLine2 && <div>{view.billTo.addressLine2}</div>}
              <div>
                {view.billTo.city}, {view.billTo.state} {view.billTo.zip}
              </div>
            </fieldset>
          </div>
        )}

        <table className="meta-table order-details-table">
          <thead>
            <tr>
              <th>Original S.O. #</th>
              <th>Reason for Return</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {editing ? (
                  <input value={view.soNumber ?? ""} onChange={(e) => setField("soNumber", e.target.value)} />
                ) : (
                  view.soNumber || "—"
                )}
              </td>
              <td>
                {editing ? (
                  <input value={view.reason} onChange={(e) => setField("reason", e.target.value)} />
                ) : (
                  view.reason || "—"
                )}
              </td>
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
                <th className="col-qty">Qty</th>
                <th className="col-rate">Credit Rate</th>
                <th className="col-amount">Amount</th>
                <th className="col-desc">Line Reason</th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {editing ? (
                      <ItemAutocompleteInput
                        value={l.itemNumber}
                        onChange={(itemNumber) => updateLine(l.id, { itemNumber })}
                        onMatch={(item) => applyItemMatch(l.id, item)}
                        catalog={catalog}
                      />
                    ) : (
                      l.itemNumber
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <input
                        value={l.description}
                        onChange={(e) => updateLine(l.id, { description: e.target.value })}
                      />
                    ) : (
                      l.description
                    )}
                  </td>
                  <td>{editing ? <input value={l.um} onChange={(e) => updateLine(l.id, { um: e.target.value })} /> : l.um}</td>
                  <td className="amount-cell">
                    {editing ? (
                      <input
                        type="number"
                        className="num-input"
                        value={l.qty}
                        onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) })}
                      />
                    ) : (
                      l.qty
                    )}
                  </td>
                  <td className="amount-cell">
                    {editing ? (
                      <input
                        type="number"
                        step="0.01"
                        className="num-input"
                        value={l.rate}
                        onChange={(e) => updateLine(l.id, { rate: Number(e.target.value) })}
                      />
                    ) : (
                      `$${l.rate.toFixed(2)}`
                    )}
                  </td>
                  <td className="amount-cell">${(l.qty * l.rate).toFixed(2)}</td>
                  <td>
                    {editing ? (
                      <input value={l.reason} onChange={(e) => updateLine(l.id, { reason: e.target.value })} />
                    ) : (
                      l.reason || "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="so-footer">
          <div className="so-notes">
            <div className="so-notes-label muted">Notes</div>
            {editing ? (
              <textarea
                className="so-notes-edit"
                rows={3}
                value={view.notes}
                onChange={(e) => setField("notes", e.target.value)}
              />
            ) : (
              <div className="so-notes-text">{view.notes || "—"}</div>
            )}
          </div>
          <table className="totals-table">
            <tbody>
              <tr className="total-row">
                <td>Total Credit</td>
                <td>${returnTotal(view).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {view.writtenBy && (
          <div className="so-signature">
            <span className="so-signature-initials">{view.writtenBy}</span>
            <span className="so-signature-label muted">Entered by</span>
          </div>
        )}
      </div>
    </div>
  );
}
