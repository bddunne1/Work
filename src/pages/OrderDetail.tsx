import { showToast } from "../lib/toast";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AddressFields from "../components/AddressFields";
import LineItemsTable from "../components/LineItemsTable";
import StatusPill from "../components/StatusPill";
import { isConflictError } from "../lib/apiClient";
import { useAuth, useCanEdit } from "../lib/authContext";
import { companyAddressLine, getCompanyInfo } from "../lib/companyStore";
import { invoicePath, invoicesForOrder, money } from "../lib/invoiceStore";
import { getCustomer } from "../lib/customerStore";
import { allocateOrder, cancelOrder, getOrder, undoShipment, updateOrder } from "../lib/orderStore";
import { canView, canEdit as canEditPath } from "../lib/permissions";
import type { Customer, Invoice, PurchaseOrder } from "../types";
import { allocatedQtyFor, itemLabel, orderSubtotal, orderTax, orderTotalLabel, remainingToShip } from "../types";

// Where "continue working this order" should go next, based on its current
// stage - so a Sales Order view can drop you straight into whatever screen
// is waiting on it instead of making you hunt for the right queue.
function nextStageFor(order: PurchaseOrder): { label: string; to: string } | null {
  switch (order.status) {
    case "Entered":
      return { label: "To Validation", to: `/validation/${order.soNumber}` };
    case "Checked":
      return { label: "To Allocation", to: `/allocation/${order.soNumber}` };
    case "Backordered":
      return { label: "Re-check Stock", to: `/allocation/${order.soNumber}` };
    case "Allocated":
      return { label: "To Release Orders", to: `/pick-pack/${order.soNumber}` };
    case "Pick & Packed":
      return order.pickListPrintedAt && order.packingSlipPrintedAt
        ? { label: "To Open Picks", to: `/open-picks/${order.soNumber}` }
        : { label: "To Release Orders", to: "/pick-pack" };
    default:
      return null;
  }
}

export default function OrderDetail() {
  const { soNumber } = useParams<{ soNumber: string }>();
  // Keyed so navigating directly between two orders on this same route
  // remounts fresh instead of reusing local order state from a previous order.
  return <OrderDetailInner key={soNumber} />;
}

function OrderDetailInner() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const { account } = useAuth();
  const canEdit = useCanEdit();
  const [order, setOrder] = useState<PurchaseOrder | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PurchaseOrder | undefined>(undefined);
  // Lines and prices open for editing. Always on an Entered order; on a
  // Checked order only after an explicit Re-open, since saving such a change
  // sends the order back to Validation (A-22). Later stages are read-only.
  const [linesOpen, setLinesOpen] = useState(false);
  // A refused save keeps the typed values on screen (C-07).
  const [saveError, setSaveError] = useState<{ message: string; stale: boolean } | null>(null);
  const [customer, setCustomer] = useState<Customer | undefined>(undefined);
  const [revising, setRevising] = useState(false);
  const [reviseQtys, setReviseQtys] = useState<Record<string, number>>({});
  const [reviseError, setReviseError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    if (!soNumber) return;
    getOrder(soNumber).then((o) => {
      setOrder(o);
      setLoading(false);
    });
    invoicesForOrder(soNumber).then(setInvoices);
  }, [soNumber]);
  // A shipment or undo changes the invoices; refresh them with the order.
  const shipmentCount = order?.shipmentHistory?.length ?? 0;
  useEffect(() => {
    if (soNumber && !loading) invoicesForOrder(soNumber).then(setInvoices);
  }, [soNumber, shipmentCount, loading]);

  if (loading) {
    return <div className="page" />;
  }

  if (!order) {
    return (
      <div className="page">
        <p>Order not found.</p>
        <Link to="/open-orders">&larr; Back to Open Orders</Link>
      </div>
    );
  }

  const nextStage = nextStageFor(order);
  const showStageButton = nextStage && account && canView(nextStage.to, account);
  // Undo is logistics' call (Open Picks / Shipment History), same as the server.
  const canUndoShipment =
    Boolean(account && (canEditPath("/open-picks", account) || canEditPath("/shipment-history", account))) &&
    order.status !== "Cancelled" &&
    (order.shipmentHistory?.length ?? 0) > 0;
  // Customer service (Sales Order View edit) or the analysts who own allocation.
  const canCancel =
    Boolean(account && (canEdit || canEditPath("/allocation", account))) &&
    order.status !== "Shipped" &&
    order.status !== "Cancelled";
  // The order's own writer can fix a mistake later even without general
  // edit access to Sales Order View - a narrower carve-out than full canEdit.
  const isWriter = Boolean(account && order.writtenById && order.writtenById === account.id);
  const canEditOrder = canEdit || isWriter;
  const view = editing && draft ? draft : order;
  const company = getCompanyInfo();
  const linesEditable = editing && (order.status === "Entered" || (order.status === "Checked" && linesOpen));
  // Analysts revise what is allocated to an Allocated or Backordered order
  // from here too (C-07), through the same allocate command as the queue.
  const canRevise =
    Boolean(account && (canEditPath("/allocation", account) || canEditPath("/back-orders", account))) &&
    (order.status === "Allocated" || order.status === "Backordered");
  const onFloor = order.status === "Pick & Packed" && Boolean(order.pickListPrintedAt || order.packingSlipPrintedAt);

  function startEdit() {
    if (!order) return;
    setDraft(order);
    setLinesOpen(false);
    setSaveError(null);
    setEditing(true);
    // The customer's price sheet and part numbers, so an added line prices
    // the way Order Entry would.
    if (order.customerId) getCustomer(order.customerId).then(setCustomer);
  }

  function cancelEdit() {
    setDraft(undefined);
    setEditing(false);
    setSaveError(null);
  }

  async function reloadAfterConflict() {
    if (!order) return;
    setOrder(await getOrder(order.soNumber));
    cancelEdit();
  }

  function startRevise() {
    if (!order) return;
    const qtys: Record<string, number> = {};
    for (const li of order.lineItems) qtys[li.id] = allocatedQtyFor(order, li.id);
    setReviseQtys(qtys);
    setReviseError(null);
    setRevising(true);
  }

  async function applyRevision() {
    if (!order) return;
    try {
      const lines = order.lineItems.map((li) => ({ lineItemId: li.id, allocatedQty: Math.max(0, Math.min(reviseQtys[li.id] ?? 0, remainingToShip(order, li))) }));
      setOrder(await allocateOrder(order, lines));
      setRevising(false);
    } catch (err) {
      setReviseError(err instanceof Error ? err.message : String(err));
      if (isConflictError(err)) setOrder(await getOrder(order.soNumber));
    }
  }

  function setField<K extends keyof PurchaseOrder>(key: K, value: PurchaseOrder[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function saveEdit() {
    if (!draft) return;
    setSaveError(null);
    try {
      const saved = await updateOrder(draft);
      setOrder(saved);
      setDraft(undefined);
      setEditing(false);
      if (order?.status === "Checked" && saved.status === "Entered") {
        showToast(`S.O. #${saved.soNumber} goes back to Validation: its lines, prices or customer changed after it was checked.`);
      }
    } catch (err) {
      // The typed values stay on screen; a stale copy needs a reload first.
      setSaveError({ message: err instanceof Error ? err.message : String(err), stale: isConflictError(err) });
    }
  }

  async function handleCancel() {
    if (!order) return;
    const reason = prompt(
      `Cancel S.O. #${order.soNumber}? Any allocated or packed stock is released and the order leaves every queue.${
        (order.shipmentHistory?.length ?? 0) > 0 ? " Units already shipped stay shipped." : ""
      }${onFloor ? "\n\nIts pick list has printed: the warehouse will be asked, on Open Picks, to pull the staged goods back off the floor." : ""}\n\nReason (required):`
    );
    if (reason === null) return;
    if (!reason.trim()) {
      showToast("A reason is required to cancel an order.");
      return;
    }
    try {
      setOrder(await cancelOrder(order, reason.trim()));
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
        setOrder(await getOrder(order.soNumber));
        return;
      }
      throw err;
    }
  }

  async function handleUndoShipment() {
    if (!order) return;
    const last = (order.shipmentHistory ?? []).at(-1);
    if (!last) return;
    const summary = last.lines.map((l) => `${itemLabel(order, l.lineItemId)} × ${l.qty}`).join(", ");
    if (
      !confirm(
        `Undo the most recent shipment on S.O. #${order.soNumber}? This restores the shipped quantities (${summary}) to on-hand inventory and moves the order back to Open Picks.`
      )
    ) {
      return;
    }
    try {
      setOrder(await undoShipment(order));
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
        setOrder(await getOrder(order.soNumber));
        return;
      }
      throw err;
    }
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <button className="link-btn" onClick={() => navigate(-1)}>
          &larr; Back
        </button>
        <div className="inline-actions">
          {canEditOrder && !editing && (
            <button type="button" className="secondary-btn" onClick={startEdit}>
              Edit Order
            </button>
          )}
          {editing && (
            <>
              {order.status === "Checked" && !linesOpen && (
                <button type="button" className="secondary-btn" onClick={() => setLinesOpen(true)} title="Saving a change to lines, prices or the customer sends the order back to Validation">
                  Re-open lines
                </button>
              )}
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

      {saveError && (
        <div className="form-error no-print" role="alert">
          {saveError.message}
          {saveError.stale && (
            <>
              {" "}
              <button type="button" className="link-btn" onClick={reloadAfterConflict}>
                Reload the order
              </button>{" "}
              (your changes are discarded).
            </>
          )}
        </div>
      )}
      {editing && order.status === "Checked" && (
        <p className="muted no-print">
          {linesOpen
            ? "Lines re-opened: saving a change to items, quantities, prices or the customer sends this order back to Validation."
            : "This order is checked. Header fields can be corrected; use Re-open lines to change items, quantities or prices."}
        </p>
      )}
      {editing && !["Entered", "Checked"].includes(order.status) && (
        <p className="muted no-print">Stock is committed to this order: items and quantities are fixed. Unallocate it to change them.</p>
      )}

      <div className="sales-order">
        <div className="so-header">
          <div className="so-company">
            <div className="so-company-name">{company.name}</div>
            <div className="muted">{companyAddressLine(company)}</div>
            <div className="muted">{company.phone}</div>
          </div>
          {view.checkedBy && (
            <div
              className="checked-stamp"
              style={view.checkedByColor ? ({ "--stamp-color": view.checkedByColor } as React.CSSProperties) : undefined}
            >
              <span className="checked-stamp-initials">{view.checkedBy}</span>
              {view.checkedAt && (
                <span className="checked-stamp-date">{new Date(view.checkedAt).toLocaleDateString()}</span>
              )}
            </div>
          )}
          <div className="so-meta">
            <h2>Sales Order</h2>
            <table className="meta-table">
              <thead>
                <tr>
                  <th>Order Date</th>
                  <th>Due Date</th>
                  <th>Est. Ship</th>
                  <th>S.O. No.</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    {editing ? (
                      <input
                        type="date"
                        value={view.orderDate}
                        onChange={(e) => setField("orderDate", e.target.value)}
                      />
                    ) : (
                      view.orderDate
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <input
                        type="date"
                        value={view.dueDate}
                        onChange={(e) => setField("dueDate", e.target.value)}
                      />
                    ) : (
                      view.dueDate
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <input
                        type="date"
                        value={view.estimatedShipDate ?? ""}
                        onChange={(e) => setField("estimatedShipDate", e.target.value || undefined)}
                      />
                    ) : (
                      view.estimatedShipDate || "—"
                    )}
                  </td>
                  <td className="so-number-view">{view.soNumber}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {editing ? (
          <div className="so-addresses">
            <AddressFields label="Bill To" value={view.billTo} onChange={(addr) => setField("billTo", addr)} />
            <AddressFields
              label="Ship To"
              value={view.shipTo}
              onChange={(addr) => setField("shipTo", addr)}
              showNotes
            />
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
            <fieldset className="address-box">
              <legend>Ship To</legend>
              <div>{view.shipTo.name}</div>
              <div>{view.shipTo.addressLine1}</div>
              {view.shipTo.addressLine2 && <div>{view.shipTo.addressLine2}</div>}
              <div>
                {view.shipTo.city}, {view.shipTo.state} {view.shipTo.zip}
              </div>
              {view.shipTo.notes && (
                <div className="address-notes-view">
                  <span className="muted">Shipping notes:</span> {view.shipTo.notes}
                </div>
              )}
            </fieldset>
          </div>
        )}

        <table className="meta-table order-details-table">
          <thead>
            <tr>
              <th>P.O. No.</th>
              <th>Terms</th>
              <th>Rep</th>
              <th>FOB</th>
              <th>Ship Via</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {editing ? (
                  <input value={view.poNumber} onChange={(e) => setField("poNumber", e.target.value)} />
                ) : (
                  view.poNumber
                )}
              </td>
              <td>
                {editing ? (
                  <input value={view.terms} onChange={(e) => setField("terms", e.target.value)} />
                ) : (
                  view.terms
                )}
              </td>
              <td>
                {editing ? (
                  <input value={view.rep} onChange={(e) => setField("rep", e.target.value)} />
                ) : (
                  view.rep
                )}
              </td>
              <td>
                {editing ? (
                  <input value={view.fob} onChange={(e) => setField("fob", e.target.value)} />
                ) : (
                  view.fob
                )}
              </td>
              <td>
                {editing ? (
                  <input value={view.shipVia} onChange={(e) => setField("shipVia", e.target.value)} />
                ) : (
                  view.shipVia
                )}
              </td>
              <td>
                <StatusPill order={view} />
              </td>
            </tr>
          </tbody>
        </table>

        <LineItemsTable
          items={view.lineItems}
          onChange={(items) => setField("lineItems", items)}
          readOnly={!linesEditable}
          shipmentHistory={view.shipmentHistory}
          customerPartMap={customer?.partNumberMap}
          customerPriceOverrides={customer?.priceOverrides}
        />

        {view.shipmentHistory && view.shipmentHistory.length > 0 && (
          <div className="shipment-history">
            <div className="so-notes-label muted">Shipment History</div>
            <div className="scroll-window">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Lines Shipped</th>
                  </tr>
                </thead>
                <tbody>
                  {view.shipmentHistory.map((rec) => (
                    <tr key={rec.id}>
                      <td>{new Date(rec.shippedAt).toLocaleString()}</td>
                      <td>{rec.lines.map((l) => `${itemLabel(view, l.lineItemId)} × ${l.qty}`).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
              <tr>
                <td>Subtotal</td>
                <td>${orderSubtotal(view).toFixed(2)}</td>
              </tr>
              <tr>
                <td>
                  Sales Tax (
                  {linesEditable ? (
                    <input
                      type="number"
                      step="0.1"
                      className="tax-input"
                      value={view.taxRate}
                      onChange={(e) => setField("taxRate", Number(e.target.value))}
                    />
                  ) : (
                    view.taxRate
                  )}
                  %)
                </td>
                <td>${orderTax(view).toFixed(2)}</td>
              </tr>
              <tr className="total-row">
                <td>Total</td>
                <td>{orderTotalLabel(view)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {view.writtenBy && (
          <div className="so-signature">
            <span
              className="so-signature-initials"
              style={view.writtenByColor ? ({ "--stamp-color": view.writtenByColor } as React.CSSProperties) : undefined}
            >
              {view.writtenBy}
            </span>
            <span className="so-signature-label muted">Entered by</span>
          </div>
        )}
      </div>

      {!editing && showStageButton && nextStage && (
        <div className="button-row no-print stage-nav-row">
          <button type="button" className="primary-btn" onClick={() => navigate(nextStage.to)}>
            {nextStage.label}
          </button>
        </div>
      )}

      {invoices.length > 0 && (
        <div className="shipment-history no-print">
          <div className="so-notes-label muted">Invoices</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <Link to={invoicePath(inv)}>{inv.invoiceNumber ?? "Draft"}</Link>
                  </td>
                  <td>{inv.invoiceDate}</td>
                  <td>{money(inv.total)}</td>
                  <td>{inv.status === "VOID" ? <span className="danger-link">Void</span> : inv.status === "DRAFT" ? <span className="muted">Draft - awaiting review</span> : "Issued"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {order.status === "Cancelled" && (
        <p className="stale-status-notice no-print">
          Cancelled{order.cancelledBy ? ` by ${order.cancelledBy}` : ""}
          {order.cancelledAt ? ` on ${new Date(order.cancelledAt).toLocaleDateString()}` : ""}
          {order.cancelReason ? ` - ${order.cancelReason}` : ""}
          {order.pullRequestedAt && !order.pullAcknowledgedAt && " · Its pick is still on the floor, waiting to be pulled (see Open Picks)."}
          {order.pullAcknowledgedAt && ` · Pulled from the floor ${new Date(order.pullAcknowledgedAt).toLocaleDateString()}.`}
        </p>
      )}

      {!editing && canRevise && (
        <div className="shipment-history no-print">
          <div className="so-notes-label muted">Allocation</div>
          {!revising ? (
            <div className="button-row">
              <button type="button" className="secondary-btn" onClick={startRevise}>
                {order.status === "Backordered" ? "Allocate stock now" : "Revise allocation"}
              </button>
              <Link to={`/allocation/${order.soNumber}`} className="link-btn">
                Open in Allocation
              </Link>
            </div>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="col-qty">Remaining</th>
                    <th className="col-qty">Allocated</th>
                    <th className="col-qty">Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lineItems.map((li) => {
                    const remaining = remainingToShip(order, li);
                    return (
                      <tr key={li.id}>
                        <td>{li.item}</td>
                        <td className="amount-cell">{remaining}</td>
                        <td className="amount-cell">{allocatedQtyFor(order, li.id)}</td>
                        <td>
                          <input
                            type="number"
                            className="num-input allocate-qty-input"
                            min={0}
                            max={remaining}
                            value={reviseQtys[li.id] ?? 0}
                            onChange={(e) => setReviseQtys((q) => ({ ...q, [li.id]: Math.max(0, Math.min(remaining, Number(e.target.value) || 0)) }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {reviseError && <div className="form-error" role="alert">{reviseError}</div>}
              <div className="button-row">
                <button type="button" className="primary-btn" onClick={applyRevision}>
                  Apply
                </button>
                <button type="button" className="secondary-btn" onClick={() => setRevising(false)}>
                  Cancel
                </button>
                <span className="muted">Checked against free stock the same way the Allocation page is.</span>
              </div>
            </>
          )}
        </div>
      )}

      {!editing && canCancel && (
        <div className="button-row no-print stage-nav-row">
          <button type="button" className="secondary-btn danger-btn" onClick={handleCancel}>
            Cancel Order
          </button>
        </div>
      )}

      {!editing && canUndoShipment && (
        <div className="button-row no-print stage-nav-row">
          <button type="button" className="secondary-btn danger-btn" onClick={handleUndoShipment}>
            Undo Last Shipment
          </button>
        </div>
      )}
    </div>
  );
}
