import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AddressFields from "../components/AddressFields";
import ItemAutocompleteInput from "../components/ItemAutocompleteInput";
import SearchSelect from "../components/SearchSelect";
import { useAuth } from "../lib/authContext";
import { listCustomers } from "../lib/customerStore";
import { listItems } from "../lib/itemStore";
import { nextReturnNumber, saveReturn } from "../lib/returnStore";
import type { Customer, Item, ReturnAuthorization, ReturnLine } from "../types";
import { emptyReturn, emptyReturnLine, returnTotal } from "../types";

export default function ReturnForm() {
  const navigate = useNavigate();
  const { account } = useAuth();
  const [ra, setRa] = useState<ReturnAuthorization>(() => emptyReturn(nextReturnNumber()));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [catalog] = useState<Item[]>(() => listItems());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    listCustomers().then(setCustomers);
  }, []);

  const selectedCustomer = customers.find((c) => c.id === ra.customerId);

  function set<K extends keyof ReturnAuthorization>(key: K, value: ReturnAuthorization[K]) {
    setRa((r) => ({ ...r, [key]: value }));
  }

  function handleSelectCustomer(id: string) {
    const customer = customers.find((c) => c.id === id);
    if (!customer) return;
    setCustomerQuery(customer.name);
    setRa((r) => ({ ...r, customerId: customer.id, billTo: { ...customer.billTo } }));
  }

  function updateLine(id: string, patch: Partial<ReturnLine>) {
    setRa((r) => ({ ...r, lines: r.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  }

  function applyItemMatch(id: string, item: Item) {
    updateLine(id, { itemNumber: item.itemNumber, description: item.description, um: item.um, rate: item.rate });
  }

  function addLine() {
    setRa((r) => ({ ...r, lines: [...r.lines, emptyReturnLine()] }));
  }

  function removeLine(id: string) {
    setRa((r) => ({ ...r, lines: r.lines.filter((l) => l.id !== id) }));
  }

  const validLines = ra.lines.filter((l) => l.itemNumber.trim() && l.qty > 0);
  const canSave = Boolean(selectedCustomer) && validLines.length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    const finalRa: ReturnAuthorization = {
      ...ra,
      lines: validLines,
      writtenBy: account?.initials,
      writtenById: account?.id,
    };
    saveReturn(finalRa);
    setRa(finalRa);
    setSaved(true);
  }

  function startNew() {
    setRa(emptyReturn(nextReturnNumber()));
    setCustomerQuery("");
    setSaved(false);
  }

  if (saved) {
    return (
      <div className="page">
        <div className="confirm-box">
          <h2>Return Authorization {ra.raNumber} saved</h2>
          <p className="muted">{selectedCustomer?.name} - {validLines.length} line item(s).</p>
          <div className="button-row">
            <button className="primary-btn" onClick={startNew}>
              Start Another Return
            </button>
            <button className="secondary-btn" onClick={() => navigate(`/returns/${ra.raNumber}`)}>
              View / Print RA
            </button>
            <button className="secondary-btn" onClick={() => navigate("/returns")}>
              Go to Returns
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/returns" className="link-btn">
          &larr; Returns
        </Link>
        <h1>New Return Authorization</h1>
        <p className="muted">
          Record a customer return and generate a Return Authorization (RA) form.
        </p>
      </div>

      <form className="sales-order" onSubmit={handleSubmit}>
        <div className="customer-picker">
          <label htmlFor="return-customer-search">Customer</label>
          <SearchSelect
            id="return-customer-search"
            options={customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.accountNumber }))}
            value={customerQuery}
            onQueryChange={setCustomerQuery}
            onSelect={handleSelectCustomer}
            placeholder="Search customers by name or account #..."
          />
        </div>

        <div className="so-addresses">
          <AddressFields label="Bill To" value={ra.billTo} onChange={(addr) => set("billTo", addr)} />
        </div>

        <table className="meta-table order-details-table">
          <thead>
            <tr>
              <th>RA No.</th>
              <th>Request Date</th>
              <th>Original S.O. #</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input value={ra.raNumber} disabled className="so-number" />
              </td>
              <td>
                <input
                  type="date"
                  value={ra.requestDate}
                  onChange={(e) => set("requestDate", e.target.value)}
                  required
                />
              </td>
              <td>
                <input
                  placeholder="e.g. 10042 (optional)"
                  value={ra.soNumber ?? ""}
                  onChange={(e) => set("soNumber", e.target.value)}
                />
              </td>
            </tr>
          </tbody>
        </table>

        <label className="form-field">
          Reason for Return
          <input
            placeholder="e.g. Damaged in transit, wrong item shipped, overstock..."
            value={ra.reason}
            onChange={(e) => set("reason", e.target.value)}
          />
        </label>

        <div className="line-items">
          <div className="ship-locations-header">
            <h3>Items Being Returned</h3>
            <button type="button" className="secondary-btn" onClick={addLine}>
              + Add Line Item
            </button>
          </div>
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
                <th className="col-remove" />
              </tr>
            </thead>
            <tbody>
              {ra.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <ItemAutocompleteInput
                      value={l.itemNumber}
                      onChange={(itemNumber) => updateLine(l.id, { itemNumber })}
                      onMatch={(item) => applyItemMatch(l.id, item)}
                      catalog={catalog}
                    />
                  </td>
                  <td>
                    <input
                      value={l.description}
                      onChange={(e) => updateLine(l.id, { description: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="col-um-input"
                      value={l.um}
                      onChange={(e) => updateLine(l.id, { um: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="num-input"
                      min={0}
                      value={l.qty}
                      onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      className="num-input"
                      value={l.rate}
                      onChange={(e) => updateLine(l.id, { rate: Number(e.target.value) })}
                    />
                  </td>
                  <td className="amount-cell">${(l.qty * l.rate).toFixed(2)}</td>
                  <td>
                    <input
                      placeholder="Reason"
                      value={l.reason}
                      onChange={(e) => updateLine(l.id, { reason: e.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => removeLine(l.id)}
                      aria-label="Remove line"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="so-footer">
          <div className="so-notes">
            <label>
              Notes
              <textarea value={ra.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
            </label>
          </div>
          <table className="totals-table">
            <tbody>
              <tr className="total-row">
                <td>Total Credit</td>
                <td>${returnTotal(ra).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="button-row">
          <button type="submit" className="primary-btn" disabled={!canSave}>
            Save Return Authorization
          </button>
        </div>
      </form>
    </div>
  );
}
