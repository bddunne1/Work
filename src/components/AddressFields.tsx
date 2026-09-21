import type { Address } from "../types";

interface Props {
  label: string;
  value: Address;
  onChange: (value: Address) => void;
}

export default function AddressFields({ label, value, onChange }: Props) {
  function set<K extends keyof Address>(key: K, v: Address[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <fieldset className="address-box">
      <legend>{label}</legend>
      <input
        placeholder="Company / Contact Name"
        value={value.name}
        onChange={(e) => set("name", e.target.value)}
      />
      <input
        placeholder="Address Line 1"
        value={value.addressLine1}
        onChange={(e) => set("addressLine1", e.target.value)}
      />
      <input
        placeholder="Address Line 2 (optional)"
        value={value.addressLine2 ?? ""}
        onChange={(e) => set("addressLine2", e.target.value)}
      />
      <div className="address-row">
        <input
          placeholder="City"
          value={value.city}
          onChange={(e) => set("city", e.target.value)}
        />
        <input
          placeholder="State"
          value={value.state}
          onChange={(e) => set("state", e.target.value)}
        />
        <input
          placeholder="ZIP"
          value={value.zip}
          onChange={(e) => set("zip", e.target.value)}
        />
      </div>
    </fieldset>
  );
}
