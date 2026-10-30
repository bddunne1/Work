import { showToast } from "../lib/toast";
import AddressFields from "../components/AddressFields";
import BackLink from "../components/BackLink";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { addVendorNote, deleteVendorNote, getVendorProfile, updateVendor } from "../lib/vendorStore";
import type { Vendor, VendorProfile as Profile } from "../types";
import { emptyAddress } from "../types";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// One vendor (sprint 5), laid out like the customer page: the details with
// an Edit action, then cards for open POs, the items that prefer this
// vendor, and dated notes. New PO for this vendor opens the PO form with
// the vendor picked.
export default function VendorProfile() {
  const { id } = useParams<{ id: string }>();
  return <VendorProfileInner key={id} />;
}

function VendorProfileInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [profile, setProfile] = useState<Profile | undefined>();
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Vendor | undefined>();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!id) return;
    const p = await getVendorProfile(id);
    setProfile(p);
    setLoading(false);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div className="page" />;
  if (!profile) {
    return (
      <div className="page">
        <p>Vendor not found.</p>
        <BackLink fallback="/vendors" label="Vendors" />
      </div>
    );
  }
  const vendor = profile.vendor;
  const editing = Boolean(draft);
  const view = draft ?? vendor;

  function setField<K extends keyof Vendor>(key: K, value: Vendor[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function save() {
    if (!draft || busy) return;
    if (!draft.name.trim()) {
      setSaveError("The vendor needs a name.");
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      const saved = await updateVendor({ ...draft, name: draft.name.trim(), leadTimeDays: draft.leadTimeDays === undefined || draft.leadTimeDays === null || Number.isNaN(draft.leadTimeDays) ? null : draft.leadTimeDays });
      setProfile((p) => (p ? { ...p, vendor: saved } : p));
      setDraft(undefined);
      showToast(`${saved.name} saved.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
      if (isConflictError(err)) showToast(message);
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!id || !noteText.trim() || busy) return;
    setBusy(true);
    try {
      const note = await addVendorNote(id, noteText.trim());
      setProfile((p) => (p ? { ...p, notes: [note, ...p.notes] } : p));
      setNoteText("");
    } finally {
      setBusy(false);
    }
  }

  async function removeNote(noteId: string) {
    if (!id || !confirm("Delete this note?")) return;
    await deleteVendorNote(id, noteId);
    setProfile((p) => (p ? { ...p, notes: p.notes.filter((n) => n.id !== noteId) } : p));
  }

  const address = view.address ?? emptyAddress();

  return (
    <div className="page vendor-profile">
      <div className="page-header no-print">
        <BackLink fallback="/vendors" label="Vendors" />
        <h1>
          {vendor.name}
          {vendor.active === false && <span className="status-pill po-pill-closed vendor-inactive-pill">Inactive</span>}
        </h1>
        <div className="inline-actions">
          {canEdit && !editing && (
            <>
              <button type="button" className="secondary-btn" onClick={() => setDraft({ ...vendor, address: vendor.address ?? emptyAddress() })}>
                Edit
              </button>
              <button type="button" className="primary-btn" onClick={() => navigate(`/purchase-orders/new?vendorId=${encodeURIComponent(vendor.id)}`)}>
                + New PO for this vendor
              </button>
            </>
          )}
          {editing && (
            <>
              <button type="button" className="primary-btn" disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className="secondary-btn" disabled={busy} onClick={() => setDraft(undefined)}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      <section className="dash-today vendor-stats" aria-label="Vendor summary">
        <div className="dash-today-card">
          <span className="dash-today-label">Open balance</span>
          <span className="dash-today-value">{profile.openBalance === null ? "—" : money(profile.openBalance)}</span>
          <span className="dash-today-sub">outstanding on open POs, at line cost</span>
        </div>
        <div className="dash-today-card">
          <span className="dash-today-label">Open POs</span>
          <span className="dash-today-value">{profile.openPos.length}</span>
          <span className="dash-today-sub">{profile.openPos.reduce((s, p) => s + p.outstandingQty, 0).toLocaleString()} units outstanding</span>
        </div>
        <div className="dash-today-card">
          <span className="dash-today-label">Closed POs</span>
          <span className="dash-today-value">{profile.closedPoCount}</span>
          <span className="dash-today-sub">received or closed</span>
        </div>
        <div className="dash-today-card">
          <span className="dash-today-label">Last PO</span>
          <span className="dash-today-value">{profile.lastPoDate ?? "—"}</span>
          <span className="dash-today-sub">{profile.lastPoNumber ? <Link to={`/purchase-orders/${profile.lastPoNumber}`}>{profile.lastPoNumber}</Link> : "no purchase orders yet"}</span>
        </div>
      </section>

      <div className="vendor-layout">
        <div className="import-panel vendor-details">
          <h3>Details</h3>
          {saveError && (
            <div className="form-error" role="alert">
              {saveError}
            </div>
          )}
          {editing ? (
            <>
              <div className="form-row">
                <label className="form-field">
                  Name
                  <input value={view.name} onChange={(e) => setField("name", e.target.value)} required />
                </label>
                <label className="form-field">
                  Account #
                  <input value={view.accountNumber ?? ""} onChange={(e) => setField("accountNumber", e.target.value)} />
                </label>
                <label className="form-field">
                  Contact
                  <input value={view.contactName ?? ""} onChange={(e) => setField("contactName", e.target.value)} />
                </label>
                <label className="form-field">
                  Phone
                  <input value={view.phone ?? ""} onChange={(e) => setField("phone", e.target.value)} />
                </label>
                <label className="form-field">
                  Email
                  <input value={view.email ?? ""} onChange={(e) => setField("email", e.target.value)} />
                </label>
                <label className="form-field">
                  Website
                  <input value={view.website ?? ""} onChange={(e) => setField("website", e.target.value)} placeholder="https://" />
                </label>
                <label className="form-field">
                  Terms
                  <input value={view.terms ?? ""} onChange={(e) => setField("terms", e.target.value)} placeholder="e.g. Net 30" />
                </label>
                <label className="form-field">
                  Lead time (days)
                  <input type="number" min={0} value={view.leadTimeDays ?? ""} onChange={(e) => setField("leadTimeDays", e.target.value === "" ? null : Number(e.target.value))} />
                </label>
              </div>
              <AddressFields label="Address" value={address} onChange={(a) => setField("address", a)} />
              <label className="form-field">
                Notes (free text)
                <textarea rows={3} value={view.notes ?? ""} onChange={(e) => setField("notes", e.target.value)} />
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={view.active !== false} onChange={(e) => setField("active", e.target.checked)} />
                Active (inactive vendors leave the PO form's vendor picker)
              </label>
            </>
          ) : (
            <dl className="vendor-dl">
              <dt>Account #</dt>
              <dd>{vendor.accountNumber || "—"}</dd>
              <dt>Contact</dt>
              <dd>{vendor.contactName || "—"}</dd>
              <dt>Phone</dt>
              <dd>{vendor.phone || "—"}</dd>
              <dt>Email</dt>
              <dd>{vendor.email ? <a href={`mailto:${vendor.email}`}>{vendor.email}</a> : "—"}</dd>
              <dt>Website</dt>
              <dd>
                {vendor.website ? (
                  <a href={/^https?:\/\//i.test(vendor.website) ? vendor.website : `https://${vendor.website}`} target="_blank" rel="noreferrer">
                    {vendor.website}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
              <dt>Terms</dt>
              <dd>{vendor.terms || "—"}</dd>
              <dt>Lead time</dt>
              <dd>{vendor.leadTimeDays === null || vendor.leadTimeDays === undefined ? "—" : `${vendor.leadTimeDays} days`}</dd>
              <dt>Address</dt>
              <dd>{[address.addressLine1, address.addressLine2, [address.city, address.state].filter(Boolean).join(", "), address.zip].filter(Boolean).join(" · ") || "—"}</dd>
              <dt>Notes</dt>
              <dd className="vendor-notes-text">{vendor.notes || "—"}</dd>
            </dl>
          )}
        </div>

        <div className="vendor-cards">
          <div className="import-panel">
            <h3>Open purchase orders</h3>
            {profile.openPos.length === 0 ? (
              <p className="muted">Nothing on order from this vendor.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>PO #</th>
                    <th>Ordered</th>
                    <th>Expected</th>
                    <th>Status</th>
                    <th className="col-qty">Outstanding</th>
                    {profile.openBalance !== null && <th className="col-amount">Value</th>}
                  </tr>
                </thead>
                <tbody>
                  {profile.openPos.map((p) => (
                    <tr key={p.poNumber} className="clickable-row" onClick={() => navigate(`/purchase-orders/${p.poNumber}`)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Link to={`/purchase-orders/${p.poNumber}`} className="row-action-outline">
                          {p.poNumber}
                        </Link>
                      </td>
                      <td>{p.orderDate ?? "—"}</td>
                      <td>{p.expectedDate ?? "—"}</td>
                      <td>{p.status}</td>
                      <td className="amount-cell">{p.outstandingQty.toLocaleString()}</td>
                      {profile.openBalance !== null && <td className="amount-cell">{p.outstandingValue === null ? "—" : money(p.outstandingValue)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="import-panel">
            <h3>Items from this vendor</h3>
            {profile.items.length === 0 ? (
              <p className="muted">No item names this vendor as preferred.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item #</th>
                    <th>Description</th>
                    <th className="col-qty">On hand</th>
                    <th className="col-qty">On PO</th>
                    {profile.openBalance !== null && <th className="col-amount">Last cost</th>}
                  </tr>
                </thead>
                <tbody>
                  {profile.items.map((i) => (
                    <tr key={i.id} className="clickable-row" onClick={() => navigate(`/items/${i.id}`)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Link to={`/items/${i.id}`} className="row-action-outline">
                          {i.itemNumber}
                        </Link>
                      </td>
                      <td>{i.description}</td>
                      <td className="amount-cell">{i.qtyOnHand.toLocaleString()}</td>
                      <td className="amount-cell">{i.qtyOnPurchaseOrder.toLocaleString()}</td>
                      {profile.openBalance !== null && <td className="amount-cell">{i.cost === null || i.cost === undefined ? "—" : money(i.cost)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="import-panel customer-notes">
            <h3>Notes</h3>
            <div className="note-bubbles">
              {profile.notes.length === 0 ? (
                <p className="muted">No notes yet.</p>
              ) : (
                profile.notes.map((n) => (
                  <div key={n.id} className="note-bubble">
                    <div className="note-bubble-date">
                      {new Date(n.createdAt).toLocaleString()}
                      {n.author ? ` · ${n.author}` : ""}
                    </div>
                    <div className="note-bubble-text">{n.text}</div>
                    {canEdit && (
                      <button type="button" className="note-bubble-delete" onClick={() => removeNote(n.id)} aria-label="Delete note">
                        &times;
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            {canEdit && (
              <div className="note-add-row">
                <textarea placeholder="Add a note..." value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} />
                <button type="button" className="secondary-btn" onClick={addNote} disabled={!noteText.trim() || busy}>
                  Add Note
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
