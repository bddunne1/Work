import type { Address } from "../types";

interface Props {
  label: string;
  value: Address;
  onChange: (value: Address) => void;
  showNotes?: boolean;
  readOnly?: boolean;
}

export default function AddressFields({ label, value, onChange, showNotes, readOnly }: Props) {
  function set<K extends keyof Address>(key: K, v: Address[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <fieldset className="address-box">
      <legend>{label}</legend>
      <input
        placeholder="Company / Contact Name"
        value={value.name}
        disabled={readOnly}
        onChange={(e) => set("name", e.target.value)}
      />
      <input
        placeholder="Address Line 1"
        value={value.addressLine1}
        disabled={readOnly}
        onChange={(e) => set("addressLine1", e.target.value)}
      />
      <input
        placeholder="Address Line 2 (optional)"
        value={value.addressLine2 ?? ""}
        disabled={readOnly}
        onChange={(e) => set("addressLine2", e.target.value)}
      />
      <div className="address-row">
        <input
          placeholder="City"
          value={value.city}
          disabled={readOnly}
          onChange={(e) => set("city", e.target.value)}
        />
        <input
          placeholder="State"
          value={value.state}
          disabled={readOnly}
          onChange={(e) => set("state", e.target.value)}
        />
        <input
          placeholder="ZIP"
          value={value.zip}
          disabled={readOnly}
          onChange={(e) => set("zip", e.target.value)}
        />
      </div>
      {showNotes && (
        <textarea
          className="address-notes"
          placeholder="Shipping notes (e.g. dock hours, gate code, special handling)"
          value={value.notes ?? ""}
          disabled={readOnly}
          onChange={(e) => set("notes", e.target.value)}
          rows={2}
        />
      )}
    </fieldset>
  );
}
