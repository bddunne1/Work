import { showToast } from "../lib/toast";
import BackLink from "../components/BackLink";
import SearchSelect from "../components/SearchSelect";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isConflictError } from "../lib/apiClient";
import { useAuth, useCanEdit } from "../lib/authContext";
import { companyAddressLine, getCompanyInfo } from "../lib/companyStore";
import { listInboundForPo } from "../lib/inboundShipmentStore";
import { listItems } from "../lib/itemStore";
import { canEdit as canEditPath, canView } from "../lib/permissions";
import { getVendorPo, receivePo, updateVendorPo } from "../lib/vendorPoStore";
import { listVendors } from "../lib/vendorStore";
import type { InboundShipment, Item, Vendor, VendorPoLine, VendorPurchaseOrder, VendorReceivingLine } from "../types";
import { emptyVendorPoLine, inboundStatusSlug, vendorPoLineOutstanding } from "../types";

const ITEM_DATALIST_ID = "po-detail-item-options";
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Value of a PO: ordered, received and outstanding, at line cost.
function poValues(po: Pick<VendorPurchaseOrder, "lines">) {
  let ordered = 0;
  let received = 0;
  for (const l of po.lines) {
    ordered += l.orderedQty * l.cost;
    received += Math.min(l.receivedQty, l.orderedQty) * l.cost;
  }
  return { ordered, received, outstanding: Math.max(0, ordered - received) };
}

// The purchase order as a full-page document (sprint 5), in the style of
// the Sales Order View: header card, line table with values, totals,
// receiving, inbound shipments and the receiving history. Purchasing edits
// it in place through the version-checked PUT (received lines stay put);
// Receiving receives against it exactly as before; the card prints.
export default function PurchaseOrderDetail() {
  const { poNumber } = useParams<{ poNumber: string }>();
  // Keyed so navigating directly between two POs on this same route remounts
  // fresh instead of reusing local edit or receiving state from a previous PO.
  return <PurchaseOrderDetailInner key={poNumber} />;
}

function PurchaseOrderDetailInner() {
  const { poNumber } = useParams<{ poNumber: string }>();
  const { account } = useAuth();
  // Purchase Orders edit writes the PO; Receiving edit (the dock) may only receive.
  const canEditPo = useCanEdit();
  const canReceive = canEditPo || (account ? canEditPath("/receiving", account) : false);
  const canSeeInbound = Boolean(account && canView("/inbound-shipments", account));
  const canSeeVendor = Boolean(account && canView("/vendors", account));
  const [po, setPo] = useState<VendorPurchaseOrder | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [inbound, setInbound] = useState<InboundShipment[] | null>(null);
  // In-place editing: a draft copy; a refused save keeps the typed values.
  const [draft, setDraft] = useState<VendorPurchaseOrder | undefined>(undefined);
  const [saveError, setSaveError] = useState<{ message: string; stale: boolean } | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorQuery, setVendorQuery] = useState("");
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const company = getCompanyInfo();

  useEffect(() => {
    if (!poNumber) return;
    getVendorPo(poNumber).then((p) => {
      setPo(p);
      setLoading(false);
    });
  }, [poNumber]);

  useEffect(() => {
    if (!poNumber) return;
    // The server lets every PO reader list them; the link only shows where
    // the account can open the page.
    listInboundForPo(poNumber)
      .then(setInbound)
      .catch(() => setInbound([]));
  }, [poNumber, po?.version]);

  if (loading) return <div className="page" />;
  if (!po) {
    return (
      <div className="page">
        <p>Purchase order not found.</p>
        <BackLink fallback="/purchase-orders" label="Purchase Orders" />
      </div>
    );
  }

  const editing = Boolean(draft);
  const view = draft ?? po;
  const closed = po.status === "Closed";
  const values = poValues(view);
  const lineOutstanding = (l: VendorPoLine) => vendorPoLineOutstanding(l);
  const anyOutstanding = po.lines.some((l) => lineOutstanding(l) > 0);
  const anyQtyEntered = Object.values(qtys).some((q) => q > 0);

  // ---- Receiving (unchanged) -------------------------------------------------

  function setQty(lineId: string, value: number, max: number) {
    setQtys((q) => ({ ...q, [lineId]: Math.max(0, Math.min(value, max)) }));
  }

  async function handleReceive() {
    if (!po) return;
    const lines: VendorReceivingLine[] = po.lines.map((l) => ({ lineId: l.id, qty: qtys[l.id] ?? 0 })).filter((l) => l.qty > 0);
    if (lines.length === 0) return;
    try {
      setPo(await receivePo(po, lines));
      setQtys({});
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
        setPo(await getVendorPo(po.poNumber));
        setQtys({});
        return;
      }
      throw err;
    }
  }

  // Receive all outstanding (G-08): every line filled with what is still
  // owed; the exceptions are edited before Receive.
  function fillOutstanding() {
    if (!po) return;
    setQtys(Object.fromEntries(po.lines.filter((l) => lineOutstanding(l) > 0).map((l) => [l.id, lineOutstanding(l)])));
  }

  // ---- Editing -----------------------------------------------------------------

  function startEdit() {
    if (!po) return;
    setDraft({ ...po, lines: po.lines.map((l) => ({ ...l })) });
    setVendorQuery(po.vendorName);
    setSaveError(null);
    if (vendors.length === 0) listVendors().then((vs) => setVendors(vs.filter((v) => v.active !== false || v.id === po.vendorId)));
    if (catalog.length === 0) listItems().then(setCatalog);
  }

  function cancelEdit() {
    setDraft(undefined);
    setSaveError(null);
  }

  function setField<K extends keyof VendorPurchaseOrder>(key: K, value: VendorPurchaseOrder[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function updateLine(id: string, patch: Partial<VendorPoLine>) {
    setDraft((d) => (d ? { ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) } : d));
  }

  function applyItemLookup(id: string, itemNumber: string) {
    const q = itemNumber.trim().toLowerCase();
    const match = catalog.find((c) => c.itemNumber.trim().toLowerCase() === q);
    if (!match) return;
    // A new line starts from the item's last purchase cost (E-05).
    updateLine(id, { itemNumber: match.itemNumber, description: match.description, cost: match.cost ?? 0 });
  }

  function selectVendor(id: string) {
    const v = vendors.find((x) => x.id === id);
    if (!v) return;
    setVendorQuery(v.name);
    setDraft((d) => (d ? { ...d, vendorId: v.id, vendorName: v.name } : d));
  }

  async function saveEdit() {
    if (!draft) return;
    const lines = draft.lines.filter((l) => l.itemNumber.trim() && l.orderedQty > 0);
    if (!draft.vendorId || lines.length === 0) {
      setSaveError({ message: "A purchase order needs a vendor and at least one line with a quantity.", stale: false });
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      const saved = await updateVendorPo({ ...draft, lines, expectedDate: draft.expectedDate || undefined });
      setPo(saved);
      setDraft(undefined);
      showToast(`${saved.poNumber} saved.`);
    } catch (err) {
      // The typed values stay on screen; a stale copy needs a reload first.
      const message = err instanceof Error ? err.message : String(err);
      setSaveError({ message, stale: isConflictError(err) });
      showToast(message);
    } finally {
      setBusy(false);
    }
  }

  async function reloadAfterConflict() {
    if (!po) return;
    setPo(await getVendorPo(po.poNumber));
    cancelEdit();
  }

  // Close / Reopen through the same PUT (status is the only field a plain
  // save may set; Received / Partially Received stay derived from the lines).
  async function setClosed(next: boolean) {
    if (!po || busy) return;
    if (next && !confirm(`Close ${po.poNumber}? Nothing more can be received against it until it is reopened.`)) return;
    setBusy(true);
    try {
      setPo(await updateVendorPo({ ...po, status: next ? "Closed" : "Open" }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
      if (isConflictError(err)) setPo(await getVendorPo(po.poNumber));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page po-detail-page">
      <div className="page-header no-print">
        <BackLink fallback="/purchase-orders" label="Purchase Orders" />
        <div className="inline-actions">
          {!editing && canEditPo && !closed && (
            <button type="button" className="secondary-btn" onClick={startEdit}>
              Edit PO
            </button>
          )}
          {!editing && canEditPo && (
            <button type="button" className="secondary-btn" disabled={busy} onClick={() => setClosed(!closed)}>
              {closed ? "Reopen" : "Close PO"}
            </button>
          )}
          {editing && (
            <>
              <button type="button" className="primary-btn" disabled={busy} onClick={saveEdit}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className="secondary-btn" disabled={busy} onClick={cancelEdit}>
                Cancel
              </button>
            </>
          )}
          {!editing && (
            <button type="button" className="secondary-btn print-btn" onClick={() => window.print()}>
              Print
            </button>
          )}
        </div>
      </div>

      {saveError && (
        <div className="form-error no-print" role="alert">
          {saveError.message}
          {saveError.stale && (
            <>
              {" "}
              <button type="button" className="link-btn" onClick={reloadAfterConflict}>
                Reload the PO
              </button>
            </>
          )}
        </div>
      )}

      <div className="sales-order po-document">
        <div className="so-header">
          <div className="so-company">
            <div className="so-company-name">{company.name}</div>
            <div className="muted">{companyAddressLine(company)}</div>
            <div className="muted">{company.phone}</div>
          </div>
          <div className="so-meta">
            <h2>Purchase Order</h2>
            <table className="meta-table">
              <thead>
                <tr>
                  <th>Order Date</th>
                  <th>Expected</th>
                  <th>Status</th>
                  <th>PO No.</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{editing ? <input type="date" value={view.orderDate} onChange={(e) => setField("orderDate", e.target.value)} /> : view.orderDate}</td>
                  <td>{editing ? <input type="date" value={view.expectedDate ?? ""} onChange={(e) => setField("expectedDate", e.target.value || undefined)} /> : (view.expectedDate ?? "—")}</td>
                  <td>
                    <span className={`status-pill po-pill po-pill-${po.status.toLowerCase().replace(/\s+/g, "-")}`}>{po.status}</span>
                  </td>
                  <td className="so-number-view">{po.poNumber}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="so-addresses">
          <fieldset className="address-box">
            <legend>Vendor</legend>
            {editing ? (
              <div className="customer-picker po-vendor-picker">
                <SearchSelect
                  id="po-detail-vendor"
                  options={vendors.map((v) => ({ id: v.id, label: v.name, sublabel: v.contactName }))}
                  value={vendorQuery}
                  onQueryChange={setVendorQuery}
                  onSelect={selectVendor}
                  placeholder="Search vendors..."
                />
              </div>
            ) : (
              <>
                <div className="po-vendor-name">{canSeeVendor ? <Link to={`/vendors/${po.vendorId}`}>{po.vendorName}</Link> : po.vendorName}</div>
                <div className="muted">Vendor profile: open POs, items and notes</div>
              </>
            )}
          </fieldset>
          <fieldset className="address-box">
            <legend>Details</legend>
            <div>
              <span className="muted">Written by</span> {po.createdBy ?? "—"} <span className="muted">on</span> {new Date(po.createdAt).toLocaleDateString()}
            </div>
            <div>
              <span className="muted">Lines</span> {view.lines.length} · <span className="muted">Received</span> {po.lines.reduce((s, l) => s + l.receivedQty, 0).toLocaleString()} of{" "}
              {po.lines.reduce((s, l) => s + l.orderedQty, 0).toLocaleString()} units
            </div>
            {inbound && inbound.length > 0 && (
              <div>
                <span className="muted">Inbound</span> {inbound.filter((s) => !["Received", "Cancelled"].includes(s.status)).length} open shipment(s)
              </div>
            )}
          </fieldset>
        </div>

        {editing && (
          <datalist id={ITEM_DATALIST_ID}>
            {catalog.map((c) => (
              <option key={c.id} value={c.itemNumber}>
                {c.description}
              </option>
            ))}
          </datalist>
        )}
        <div className="scroll-window">
          <table className="data-table line-item-table po-lines">
            <thead>
              <tr>
                <th className="col-item">Item #</th>
                <th className="col-desc">Description</th>
                <th className="col-qty">Ordered</th>
                <th className="col-qty">Received</th>
                <th className="col-qty">Outstanding</th>
                <th className="col-rate">Cost</th>
                <th className="col-amount">Ext. cost</th>
                <th className="col-amount">Received value</th>
                {!editing && canReceive && anyOutstanding && !closed && <th className="col-qty no-print">Receive now</th>}
                {editing && <th className="col-remove" />}
              </tr>
            </thead>
            <tbody>
              {view.lines.map((l) => {
                const outstanding = lineOutstanding(l);
                return (
                  <tr key={l.id}>
                    <td>
                      {editing && l.receivedQty === 0 ? (
                        <input value={l.itemNumber} list={ITEM_DATALIST_ID} onChange={(e) => updateLine(l.id, { itemNumber: e.target.value })} onBlur={(e) => applyItemLookup(l.id, e.target.value)} />
                      ) : (
                        l.itemNumber
                      )}
                    </td>
                    <td>{editing ? <input value={l.description} onChange={(e) => updateLine(l.id, { description: e.target.value })} /> : l.description}</td>
                    <td className="amount-cell">
                      {editing ? (
                        <input type="number" min={Math.max(1, l.receivedQty)} step={1} className="num-input" value={l.orderedQty} onChange={(e) => updateLine(l.id, { orderedQty: Number(e.target.value) })} />
                      ) : (
                        l.orderedQty
                      )}
                    </td>
                    <td className="amount-cell">{l.receivedQty}</td>
                    <td className="amount-cell">{outstanding}</td>
                    <td className="amount-cell">
                      {editing ? <input type="number" step="0.01" min={0} className="num-input" value={l.cost} onChange={(e) => updateLine(l.id, { cost: Number(e.target.value) })} /> : money(l.cost)}
                    </td>
                    <td className="amount-cell">{money(l.orderedQty * l.cost)}</td>
                    <td className="amount-cell">{money(Math.min(l.receivedQty, l.orderedQty) * l.cost)}</td>
                    {!editing && canReceive && anyOutstanding && !closed && (
                      <td className="no-print">
                        {outstanding > 0 ? (
                          <input type="number" className="num-input allocate-qty-input" min={0} max={outstanding} value={qtys[l.id] ?? 0} onChange={(e) => setQty(l.id, Number(e.target.value), outstanding)} aria-label={`${l.itemNumber}: receive now`} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    )}
                    {editing && (
                      <td>
                        {l.receivedQty === 0 ? (
                          <button type="button" className="icon-btn" aria-label="Remove line" onClick={() => setDraft((d) => (d ? { ...d, lines: d.lines.filter((x) => x.id !== l.id) } : d))}>
                            &times;
                          </button>
                        ) : (
                          <span className="muted" title="This line has received stock and stays on the PO">
                            ·
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editing && (
          <button type="button" className="secondary-btn" onClick={() => setDraft((d) => (d ? { ...d, lines: [...d.lines, emptyVendorPoLine()] } : d))}>
            + Add Line
          </button>
        )}

        <div className="so-footer">
          <div className="so-notes">
            <div className="so-notes-label muted">Notes</div>
            {editing ? <textarea className="so-notes-edit" rows={3} value={view.notes} onChange={(e) => setField("notes", e.target.value)} /> : <div className="so-notes-text">{view.notes || "—"}</div>}
          </div>
          <table className="totals-table">
            <tbody>
              <tr>
                <td>Ordered value</td>
                <td>{money(values.ordered)}</td>
              </tr>
              <tr>
                <td>Received value</td>
                <td>{money(values.received)}</td>
              </tr>
              <tr className="total-row">
                <td>Outstanding value</td>
                <td>{money(values.outstanding)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {!editing && canReceive && anyOutstanding && !closed && (
        <div className="decision-outcome outcome-success no-print">
          <div className="decision-outcome-label">Receive stock</div>
          <div className="decision-outcome-detail">Enter what actually arrived against each line, then receive. Received units are added straight to on-hand inventory.</div>
          <div className="button-row">
            <button type="button" className="secondary-btn" onClick={fillOutstanding}>
              Receive all outstanding
            </button>
            <button type="button" className="primary-btn" disabled={!anyQtyEntered} onClick={handleReceive}>
              Receive
            </button>
          </div>
        </div>
      )}
      {closed && anyOutstanding && <p className="stale-status-notice no-print">This PO is closed with stock still outstanding. Reopen it to receive against it.</p>}

      {inbound && inbound.length > 0 && (
        <div className="shipment-history">
          <div className="so-notes-label muted">Inbound Shipments</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Carrier</th>
                <th>Status</th>
                <th>ETA</th>
                <th>Lines from this PO</th>
              </tr>
            </thead>
            <tbody>
              {inbound.map((s) => (
                <tr key={s.id}>
                  <td>{canSeeInbound ? <Link to={`/inbound-shipments/${s.id}`}>{s.reference}</Link> : s.reference}</td>
                  <td>{s.carrier || "—"}</td>
                  <td>
                    <span className={`status-pill inbound-pill inbound-pill-${inboundStatusSlug(s.status)}`}>{s.status}</span>
                  </td>
                  <td>{s.eta ?? "—"}</td>
                  <td>
                    {s.lines
                      .filter((l) => l.poNumber === po.poNumber)
                      .map((l) => `${l.itemNumber} × ${l.qty}`)
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {po.receivingHistory && po.receivingHistory.length > 0 && (
        <div className="shipment-history">
          <div className="so-notes-label muted">Receiving History</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Lines Received</th>
              </tr>
            </thead>
            <tbody>
              {po.receivingHistory.map((rec) => (
                <tr key={rec.id}>
                  <td>{new Date(rec.receivedAt).toLocaleString()}</td>
                  <td>
                    {rec.lines
                      .map((l) => {
                        const line = po.lines.find((x) => x.id === l.lineId);
                        return `${line?.itemNumber ?? l.lineId} × ${l.qty}`;
                      })
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
