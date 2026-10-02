import { Link } from "react-router-dom";
import type { Customer, PurchaseOrder } from "../types";

// What the person entering an order needs beside the form (G-11): the
// customer's terms and flags, their routing guide, their latest notes, and
// a warning when the P.O. number was already entered.
interface Props {
  customer?: Customer;
  duplicates: PurchaseOrder[];
  poNumber: string;
}

export default function OrderEntrySidePanel({ customer, duplicates, poNumber }: Props) {
  const guide = customer?.routingGuide;
  const hasGuide = Boolean(guide && (guide.preferredCarrier || guide.routingAccountNumber || guide.appointmentRequired || guide.labelingRequirements || guide.notes));
  const notes = (customer?.notes ?? []).slice(-3).reverse();
  return (
    <aside className="order-side-panel">
      {duplicates.length > 0 && (
        <div className="side-card side-card-warning" role="status">
          <div className="side-card-title">P.O. {poNumber} already entered</div>
          <ul>
            {duplicates.map((o) => (
              <li key={o.soNumber}>
                <Link to={`/storage/${o.soNumber}`} target="_blank">
                  S.O. #{o.soNumber}
                </Link>{" "}
                · {o.status} · {o.orderDate}
              </li>
            ))}
          </ul>
          <p className="muted">Check it is not the same order before saving.</p>
        </div>
      )}
      {!customer ? (
        <div className="side-card">
          <div className="side-card-title">Customer</div>
          <p className="muted">Pick a customer to see their terms, routing guide and notes here.</p>
        </div>
      ) : (
        <>
          <div className="side-card">
            <div className="side-card-title">{customer.name}</div>
            <dl className="side-facts">
              <dt>Account</dt>
              <dd>{customer.accountNumber || "—"}</dd>
              <dt>Terms</dt>
              <dd>{customer.terms || "—"}</dd>
              <dt>Ship via</dt>
              <dd>{customer.shipVia || "—"}</dd>
              {customer.shipCompleteOnly && (
                <>
                  <dt>Shipping</dt>
                  <dd>Ship complete only</dd>
                </>
              )}
              {customer.taxExempt && (
                <>
                  <dt>Tax</dt>
                  <dd>Exempt</dd>
                </>
              )}
            </dl>
            <Link to={`/customers/all/${customer.id}`} target="_blank" className="link-btn">
              Customer record
            </Link>
          </div>
          <div className="side-card">
            <div className="side-card-title">Routing guide</div>
            {!hasGuide ? (
              <p className="muted">No routing guide on file.</p>
            ) : (
              <dl className="side-facts">
                {guide?.preferredCarrier && (
                  <>
                    <dt>Carrier</dt>
                    <dd>{guide.preferredCarrier}</dd>
                  </>
                )}
                {guide?.routingAccountNumber && (
                  <>
                    <dt>Routing acct</dt>
                    <dd>{guide.routingAccountNumber}</dd>
                  </>
                )}
                {guide?.appointmentRequired && (
                  <>
                    <dt>Delivery</dt>
                    <dd>Appointment required</dd>
                  </>
                )}
                {guide?.labelingRequirements && (
                  <>
                    <dt>Labels</dt>
                    <dd>{guide.labelingRequirements}</dd>
                  </>
                )}
                {guide?.notes && (
                  <>
                    <dt>Notes</dt>
                    <dd>{guide.notes}</dd>
                  </>
                )}
              </dl>
            )}
          </div>
          {notes.length > 0 && (
            <div className="side-card">
              <div className="side-card-title">Latest notes</div>
              <ul className="side-notes">
                {notes.map((n) => (
                  <li key={n.id}>
                    <span className="muted">{new Date(n.createdAt).toLocaleDateString()}</span> {n.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
