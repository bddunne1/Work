import type { PurchaseOrder } from "../types";
import { shippedQtyFor } from "../types";

interface Props {
  orders: PurchaseOrder[];
  includePick: boolean;
  includeSlip: boolean;
}

function lineFor(order: PurchaseOrder, lineItemId: string) {
  return order.lineItems.find((li) => li.id === lineItemId);
}

function PickListDoc({ order, pageClass }: { order: PurchaseOrder; pageClass: string }) {
  return (
    <div className={pageClass}>
      <div className="so-header">
        <div className="so-company">
          <div className="so-company-name">Pick List</div>
          <div className="muted">S.O. #{order.soNumber}</div>
        </div>
        <div className="so-meta">
          <table className="meta-table">
            <thead>
              <tr>
                <th>P.O. No.</th>
                <th>Customer</th>
                <th>Ship Via</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{order.poNumber || "—"}</td>
                <td>{order.billTo.name}</td>
                <td>{order.shipVia || "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <table className="data-table line-item-table">
        <thead>
          <tr>
            <th className="col-item">Item</th>
            <th className="col-desc">Description</th>
            <th className="col-um">U/M</th>
            <th className="col-qty">Qty to Pick</th>
          </tr>
        </thead>
        <tbody>
          {(order.pendingShipment ?? []).map((l) => {
            const li = lineFor(order, l.lineItemId);
            if (!li) return null;
            return (
              <tr key={l.lineItemId}>
                <td>{li.item}</td>
                <td>{li.description}</td>
                <td>{li.um}</td>
                <td className="amount-cell">{l.qty}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PackingSlipDoc({ order, pageClass }: { order: PurchaseOrder; pageClass: string }) {
  return (
    <div className={pageClass}>
      <div className="so-header">
        <div className="so-company">
          <div className="so-company-name">Packing Slip</div>
          <div className="muted">
            S.O. #{order.soNumber} · P.O. #{order.poNumber || "—"}
          </div>
        </div>
      </div>

      <div className="so-addresses">
        <fieldset className="address-box">
          <legend>Ship To</legend>
          <div>{order.shipTo.name}</div>
          <div>{order.shipTo.addressLine1}</div>
          {order.shipTo.addressLine2 && <div>{order.shipTo.addressLine2}</div>}
          <div>
            {order.shipTo.city}, {order.shipTo.state} {order.shipTo.zip}
          </div>
        </fieldset>
      </div>

      <table className="data-table line-item-table">
        <thead>
          <tr>
            <th className="col-item">Item</th>
            <th className="col-desc">Description</th>
            <th className="col-um">U/M</th>
            <th className="col-qty">Ordered</th>
            <th className="col-qty">Prev. Shipped</th>
            <th className="col-qty">Shipping Now</th>
            <th className="col-qty">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {(order.pendingShipment ?? []).map((l) => {
            const li = lineFor(order, l.lineItemId);
            if (!li) return null;
            const previouslyShipped = shippedQtyFor(order, li.id);
            const remaining = Math.max(0, li.ordered - previouslyShipped - l.qty);
            return (
              <tr key={l.lineItemId}>
                <td>{li.item}</td>
                <td>{li.description}</td>
                <td>{li.um}</td>
                <td className="amount-cell">{li.ordered}</td>
                <td className="amount-cell">{previouslyShipped}</td>
                <td className="amount-cell">{l.qty}</td>
                <td className="amount-cell">{remaining}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function BatchPrintDocs({ orders, includePick, includeSlip }: Props) {
  type Doc = { type: "pick" | "slip"; order: PurchaseOrder };
  const docs: Doc[] = [];
  if (includePick) for (const order of orders) docs.push({ type: "pick", order });
  if (includeSlip) for (const order of orders) docs.push({ type: "slip", order });

  return (
    <>
      {docs.map((doc, idx) => {
        const isLast = idx === docs.length - 1;
        const pageClass = `sales-order print-only ${isLast ? "" : "batch-page-break"}`;
        return doc.type === "pick" ? (
          <PickListDoc key={`pick-${doc.order.soNumber}`} order={doc.order} pageClass={pageClass} />
        ) : (
          <PackingSlipDoc key={`slip-${doc.order.soNumber}`} order={doc.order} pageClass={pageClass} />
        );
      })}
    </>
  );
}
