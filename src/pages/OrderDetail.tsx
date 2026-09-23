import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AddressFields from "../components/AddressFields";
import LineItemsTable from "../components/LineItemsTable";
import StatusPill from "../components/StatusPill";
import { useAuth, useCanEdit } from "../lib/authContext";
import { companyAddressLine, getCompanyInfo } from "../lib/companyStore";
import { getOrder, undoShipment, updateOrder } from "../lib/orderStore";
import { canView } from "../lib/permissions";
import type { PurchaseOrder } from "../types";
import { itemLabel, orderSubtotal, orderTax, orderTotal } from "../types";

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
      return { label: "To Review", to: `/pick-pack/${order.soNumber}` };
    case "Pick & Packed":
      return order.pickListPrintedAt && order.packingSlipPrintedAt
        ? { label: "To Open Picks", to: `/open-picks/${order.soNumber}` }
        : { label: "To Released Picks", to: "/pick-pack" };
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

  useEffect(() => {
    if (!soNumber) return;
    getOrder(soNumber).then((o) => {
      setOrder(o);
      setLoading(false);
    });
  }, [soNumber]);

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
  const canUndoShipment = canEdit && (order.shipmentHistory?.length ?? 0) > 0;
  // The order's own writer can fix a mistake later even without general
  // edit access to Sales Order View - a narrower carve-out than full canEdit.
  const isWriter = Boolean(account && order.writtenById && order.writtenById === account.id);
  const canEditOrder = canEdit || isWriter;
  const view = editing && draft ? draft : order;
  const company = getCompanyInfo();

  function startEdit() {
    setDraft(order);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(undefined);
    setEditing(false);
  }

  function setField<K extends keyof PurchaseOrder>(key: K, value: PurchaseOrder[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function saveEdit() {
    if (!draft) return;
    await updateOrder(draft);
    setOrder(draft);
    setDraft(undefined);
    setEditing(false);
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
    setOrder(await undoShipment(order));
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
          readOnly={!editing}
          shipmentHistory={view.shipmentHistory}
        />

        {view.shipmentHistory && view.shipmentHistory.length > 0 && (
          <div className="shipment-history">
            <div className="so-notes-label muted">Shipment History</div>
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
                  {editing ? (
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
                <td>${orderTotal(view).toFixed(2)}</td>
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
