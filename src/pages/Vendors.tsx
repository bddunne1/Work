import { showToast } from "../lib/toast";
import { useEffect, useRef, useState } from "react";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { deleteVendor, listVendors, saveVendor, updateVendor } from "../lib/vendorStore";
import type { Vendor } from "../types";
import { emptyVendor } from "../types";

export default function Vendors() {
  const canEdit = useCanEdit();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    listVendors().then(setVendors);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const vendor: Vendor = { ...emptyVendor(), name: name.trim(), contactName, phone, email };
    await saveVendor(vendor);
    refresh();
    setName("");
    setContactName("");
    setPhone("");
    setEmail("");
  }

  // Typing edits the row on screen; leaving the field saves it once. Saving
  // on every keystroke raced the server's version check and lost characters
  // (M-10).
  const dirty = useRef(new Set<string>());
  function editField(v: Vendor, patch: Partial<Vendor>) {
    dirty.current.add(v.id);
    setVendors((vs) => vs.map((x) => (x.id === v.id ? { ...x, ...patch } : x)));
  }

  async function commitVendor(id: string) {
    if (!dirty.current.has(id)) return;
    dirty.current.delete(id);
    const updated = vendors.find((x) => x.id === id);
    if (!updated) return;
    try {
      const saved = await updateVendor(updated);
      setVendors((vs) => vs.map((x) => (x.id === id ? saved : x)));
    } catch (err) {
      if (isConflictError(err)) {
        showToast(err.message);
        refresh();
        return;
      }
      throw err;
    }
  }

  async function handleDelete(v: Vendor) {
    if (!confirm(`Delete vendor "${v.name}"?`)) return;
    await deleteVendor(v.id);
    refresh();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Vendors</h1>
        <p className="muted">
          Suppliers you buy from - used on item profiles as a preferred vendor, and on outbound purchase
          orders.
        </p>
      </div>

      {canEdit && (
        <div className="import-panel">
          <h3>Add Vendor</h3>
          <form className="form-row" onSubmit={handleAdd}>
            <label className="form-field">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="form-field">
              Contact Name
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </label>
            <label className="form-field">
              Phone
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label className="form-field">
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <div className="form-field form-field-btn">
              <button type="submit" className="primary-btn">
                Add Vendor
              </button>
            </div>
          </form>
        </div>
      )}

      {vendors.length === 0 ? (
        <p className="muted">No vendors yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Phone</th>
              <th>Email</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id}>
                <td>
                  <input
                    value={v.name}
                    disabled={!canEdit}
                    onBlur={() => commitVendor(v.id)}
                    onChange={(e) => editField(v, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={v.contactName ?? ""}
                    disabled={!canEdit}
                    onBlur={() => commitVendor(v.id)}
                    onChange={(e) => editField(v, { contactName: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={v.phone ?? ""}
                    disabled={!canEdit}
                    onBlur={() => commitVendor(v.id)}
                    onChange={(e) => editField(v, { phone: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={v.email ?? ""}
                    disabled={!canEdit}
                    onBlur={() => commitVendor(v.id)}
                    onChange={(e) => editField(v, { email: e.target.value })}
                  />
                </td>
                {canEdit && (
                  <td>
                    <button
                      type="button"
                      className="row-action-outline danger-link"
                      onClick={() => handleDelete(v)}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
