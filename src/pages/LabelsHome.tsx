import { Link } from "react-router-dom";

export default function LabelsHome() {
  return (
    <div className="page">
      <div className="page-header">
        <h1>Create Labels</h1>
        <p className="muted">Choose which kind of label to print.</p>
      </div>

      <div className="module-grid">
        <Link to="/labels/shipping" className="module-card active label-choice-card">
          <div className="module-name">Shipping Labels</div>
          <div className="module-desc">
            Pick a customer and shipping location to auto-fill a label, or enter the address manually.
          </div>
        </Link>
        <Link to="/labels/product" className="module-card active label-choice-card">
          <div className="module-name">Product Labels</div>
          <div className="module-desc">
            Look up a customer to find labels for the products they buy, or browse the full item catalog
            to print our own standard product labels.
          </div>
        </Link>
      </div>
    </div>
  );
}
