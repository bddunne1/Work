import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import SearchSelect from "../components/SearchSelect";
import { listItems } from "../lib/itemStore";
import { saveVendorPo } from "../lib/vendorPoStore";
import { listVendors } from "../lib/vendorStore";
import { localIsoDate } from "../lib/dateUtils";
import type { Item, Vendor, VendorPoLine, VendorPurchaseOrder } from "../types";
import { emptyVendorPoLine, vendorPoCostTotal } from "../types";

const ITEM_DATALIST_ID = "po-item-catalog-options";

function today(): string {
  return localIsoDate();
}

export default function PurchaseOrderForm() {
  const navigate = useNavigate();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [catalog, setCatalog] = useState<Item[]>([]);

  useEffect(() => {
    listVendors().then(setVendors);
    listItems().then(setCatalog);
  }, []);
  const [vendorQuery, setVendorQuery] = useState("");
  const [vendorId, setVendorId] = useState<string | undefined>();
  const [orderDate, setOrderDate] = useState(() => today());
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<VendorPoLine[]>([emptyVendorPoLine()]);

  const selectedVendor = vendors.find((v) => v.id === vendorId);

  function handleSelectVendor(id: string) {
    const v = vendors.find((x) => x.id === id);
    if (!v) return;
    setVendorId(id);
    setVendorQuery(v.name);
  }

  function updateLine(id: string, patch: Partial<VendorPoLine>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function applyItemLookup(id: string, itemNumber: string) {
    const q = itemNumber.trim().toLowerCase();
    const match = catalog.find((c) => c.itemNumber.trim().toLowerCase() === q);
    if (!match) return;
    updateLine(id, { itemNumber: match.itemNumber, description: match.description, cost: match.rate });
  }

  function addLine() {
    setLines((ls) => [...ls, emptyVendorPoLine()]);
  }

  function removeLine(id: string) {
    setLines((ls) => ls.filter((l) => l.id !== id));
  }

  const validLines = lines.filter((l) => l.itemNumber.trim() && l.orderedQty > 0);
  const canSave = Boolean(selectedVendor) && validLines.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || !selectedVendor) return;
    const po: Omit<VendorPurchaseOrder, "poNumber"> = {
      vendorId: selectedVendor.id,
      vendorName: selectedVendor.name,
      orderDate,
      expectedDate: expectedDate || undefined,
      lines: validLines,
      status: "Open",
      notes,
      createdAt: new Date().toISOString(),
    };
    const saved = await saveVendorPo(po);
    navigate(`/purchase-orders/${saved.poNumber}`);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>New Purchase Order</h1>
        <p className="muted">
          Order stock from a vendor. Receiving against it later will add straight to on-hand and update
          the item's On PO figure.
        </p>
      </div>

      <form className="sales-order" onSubmit={handleSubmit}>
        <div className="customer-picker">
          <label htmlFor="po-vendor-search">Vendor</label>
          <SearchSelect
            id="po-vendor-search"
            options={vendors.map((v) => ({ id: v.id, label: v.name, sublabel: v.contactName }))}
            value={vendorQuery}
            onQueryChange={setVendorQuery}
            onSelect={handleSelectVendor}
            placeholder="Search vendors..."
          />
          <Link to="/vendors" target="_blank" className="link-btn">
            + New Vendor
          </Link>
        </div>

        <table className="meta-table order-details-table">
          <thead>
            <tr>
              <th>Order Date</th>
              <th>Expected Date</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required />
              </td>
              <td>
                <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              </td>
            </tr>
          </tbody>
        </table>

        <datalist id={ITEM_DATALIST_ID}>
          {catalog.map((c) => (
            <option key={c.id} value={c.itemNumber}>
              {c.description}
            </option>
          ))}
        </datalist>
        <div className="scroll-window">
          <table className="data-table line-item-table">
            <thead>
              <tr>
                <th className="col-item">Item #</th>
                <th className="col-desc">Description</th>
                <th className="col-qty">Qty</th>
                <th className="col-rate">Cost</th>
                <th className="col-amount">Amount</th>
                <th className="col-remove" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <input
                      value={l.itemNumber}
                      list={ITEM_DATALIST_ID}
                      onChange={(e) => updateLine(l.id, { itemNumber: e.target.value })}
                      onBlur={(e) => applyItemLookup(l.id, e.target.value)}
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
                      type="number"
                      className="num-input"
                      value={l.orderedQty}
                      onChange={(e) => updateLine(l.id, { orderedQty: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      className="num-input"
                      value={l.cost}
                      onChange={(e) => updateLine(l.id, { cost: Number(e.target.value) })}
                    />
                  </td>
                  <td className="amount-cell">${(l.orderedQty * l.cost).toFixed(2)}</td>
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
        <button type="button" className="secondary-btn" onClick={addLine}>
          + Add Line
        </button>

        <label className="form-field">
          Notes
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div className="so-footer">
          <div />
          <table className="totals-table">
            <tbody>
              <tr className="total-row">
                <td>Total Cost</td>
                <td>${vendorPoCostTotal({ lines }).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="button-row">
          <button type="submit" className="primary-btn" disabled={!canSave}>
            Save Purchase Order
          </button>
        </div>
      </form>
    </div>
  );
}
