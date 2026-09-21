import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getOrder, updateOrder } from "../lib/orderStore";
import { allocatedQtyFor } from "../types";

export default function PickPackDetail() {
  const { soNumber } = useParams<{ soNumber: string }>();
  const navigate = useNavigate();
  const order = soNumber ? getOrder(soNumber) : undefined;

  const pickableLines = (order?.lineItems ?? []).filter((li) => allocatedQtyFor(order!, li.id) > 0);

  const [picked, setPicked] = useState<Record<string, boolean>>({});

  if (!order) {
    return (
      <div className="page">
        <p>Order not found.</p>
        <Link to="/pick-pack">&larr; Back to Pick &amp; Pack</Link>
      </div>
    );
  }

  const allPicked = pickableLines.length > 0 && pickableLines.every((li) => picked[li.id]);

  function togglePicked(lineItemId: string) {
    setPicked((p) => ({ ...p, [lineItemId]: !p[lineItemId] }));
  }

  function completePickPack() {
    if (!order || !allPicked) return;
    updateOrder({ ...order, status: "Pick & Packed", pickedAt: new Date().toISOString() });
    navigate(`/storage/${order.soNumber}`);
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <button className="link-btn" onClick={() => navigate("/pick-pack")}>
          &larr; Back to Pick &amp; Pack
        </button>
        <button className="secondary-btn print-btn" onClick={() => window.print()}>
          Print Pick List
        </button>
      </div>

      <div className="sales-order">
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
              <th className="no-print">Picked</th>
              <th className="col-item">Item</th>
              <th className="col-desc">Description</th>
              <th className="col-um">U/M</th>
              <th className="col-qty">Qty to Pick</th>
            </tr>
          </thead>
          <tbody>
            {order.lineItems.map((li) => {
              const qty = allocatedQtyFor(order, li.id);
              const partial = qty > 0 && qty < li.ordered;
              const none = qty === 0;
              return (
                <tr key={li.id} className={none ? "pick-row-skip" : ""}>
                  <td className="no-print">
                    {!none && (
                      <input
                        type="checkbox"
                        checked={Boolean(picked[li.id])}
                        onChange={() => togglePicked(li.id)}
                        aria-label={`Mark ${li.item} picked`}
                      />
                    )}
                  </td>
                  <td>{li.item}</td>
                  <td>{li.description}</td>
                  <td>{li.um}</td>
                  <td className="amount-cell">
                    {none ? (
                      <span className="muted">Backordered</span>
                    ) : (
                      <>
                        {qty}
                        {partial && <span className="muted"> of {li.ordered}</span>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="button-row no-print">
          <button type="button" className="primary-btn" disabled={!allPicked} onClick={completePickPack}>
            Complete Pick &amp; Pack
          </button>
        </div>
      </div>
    </div>
  );
}
