import { CUSTOMER_PAYS_FLAGS, type ReturnAuthorization } from "../types";

type Flags = Pick<ReturnAuthorization, "customerPaysReturnFreight" | "customerPaysRestockingFee" | "customerPaysOriginalFreight">;

// The three customer-pays decisions on a return: Yes/No toggles while
// editing, a read-only line otherwise (the return print view and the
// credit memo). Billing context only - nothing here changes stock or the
// credit memo's math; Accounting adds a deduction line by hand.
export default function CustomerPaysFlags({ value, onChange, compact }: { value: Flags; onChange?: (next: Flags) => void; compact?: boolean }) {
  if (!onChange) {
    return (
      <div className={`customer-pays${compact ? " is-compact" : ""}`}>
        {CUSTOMER_PAYS_FLAGS.map((f) => (
          <span key={f.key} className={`customer-pays-flag${value[f.key] ? " is-yes" : ""}`}>
            {f.label.replace("Customer pays ", "")}: <strong>{value[f.key] ? "Yes" : "No"}</strong>
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="customer-pays customer-pays-edit">
      {CUSTOMER_PAYS_FLAGS.map((f) => (
        <div key={f.key} className="customer-pays-row">
          <span>{f.label}?</span>
          <div className="decision-buttons" role="group" aria-label={f.label}>
            <button type="button" className={`decision-btn ${value[f.key] ? "selected" : ""}`} aria-pressed={value[f.key]} onClick={() => onChange({ ...value, [f.key]: true })}>
              Yes
            </button>
            <button type="button" className={`decision-btn ${!value[f.key] ? "selected" : ""}`} aria-pressed={!value[f.key]} onClick={() => onChange({ ...value, [f.key]: false })}>
              No
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
