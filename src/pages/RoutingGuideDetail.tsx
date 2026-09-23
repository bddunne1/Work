import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCanEdit } from "../lib/authContext";
import { getCustomer, updateCustomer } from "../lib/customerStore";
import type { Customer, RoutingGuide as RoutingGuideData } from "../types";

function emptyRoutingGuide(): RoutingGuideData {
  return {
    preferredCarrier: "",
    routingAccountNumber: "",
    appointmentRequired: false,
    labelingRequirements: "",
    notes: "",
  };
}

export default function RoutingGuideDetail() {
  const { id } = useParams<{ id: string }>();
  // Keyed so navigating directly between two customers on this same route
  // remounts fresh instead of reusing local edit state from a previous one.
  return <RoutingGuideDetailInner key={id} />;
}

function RoutingGuideDetailInner() {
  const { id } = useParams<{ id: string }>();
  const canEdit = useCanEdit();
  const [customer, setCustomer] = useState<Customer | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Customer | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getCustomer(id).then((c) => {
      if (cancelled) return;
      setCustomer(c);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="page">
        <p>Customer not found.</p>
        <Link to="/customers/routing-guide">&larr; Back to Routing Guide</Link>
      </div>
    );
  }

  const view = editing && draft ? draft : customer;
  const guide = view.routingGuide ?? emptyRoutingGuide();

  function startEdit() {
    setDraft(customer);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(undefined);
    setEditing(false);
  }

  function setGuide<K extends keyof RoutingGuideData>(key: K, value: RoutingGuideData[K]) {
    setDraft((d) => (d ? { ...d, routingGuide: { ...(d.routingGuide ?? emptyRoutingGuide()), [key]: value } } : d));
  }

  async function saveEdit() {
    if (!draft) return;
    const saved = await updateCustomer(draft);
    setCustomer(saved);
    setDraft(undefined);
    setEditing(false);
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <Link to="/customers/routing-guide" className="link-btn">
          &larr; Back to Routing Guide
        </Link>
        <div className="inline-actions">
          {canEdit && !editing && (
            <button type="button" className="secondary-btn" onClick={startEdit}>
              Edit Routing Guide
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
        </div>
      </div>

      <div className="page-header">
        <h1>{view.name}</h1>
        <p className="muted">Account # {view.accountNumber || "—"}</p>
      </div>

      <section className="lane-section">
        <div className="form-row">
          <label className="form-field">
            Preferred Carrier
            {editing ? (
              <input
                value={guide.preferredCarrier ?? ""}
                onChange={(e) => setGuide("preferredCarrier", e.target.value)}
              />
            ) : (
              <p>{guide.preferredCarrier || "—"}</p>
            )}
          </label>
          <label className="form-field">
            Routing Account #
            {editing ? (
              <input
                value={guide.routingAccountNumber ?? ""}
                onChange={(e) => setGuide("routingAccountNumber", e.target.value)}
              />
            ) : (
              <p>{guide.routingAccountNumber || "—"}</p>
            )}
          </label>
        </div>

        {editing ? (
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={Boolean(guide.appointmentRequired)}
              onChange={(e) => setGuide("appointmentRequired", e.target.checked)}
            />
            Delivery appointment required
          </label>
        ) : (
          <p>
            <strong>Delivery appointment required:</strong>{" "}
            {guide.appointmentRequired ? (
              <span className="status-pill status-pill-backordered">Required</span>
            ) : (
              "No"
            )}
          </p>
        )}

        <label className="form-field">
          Labeling Requirements
          {editing ? (
            <textarea
              rows={2}
              value={guide.labelingRequirements ?? ""}
              onChange={(e) => setGuide("labelingRequirements", e.target.value)}
            />
          ) : (
            <p className="muted">{guide.labelingRequirements || "None specified."}</p>
          )}
        </label>

        <label className="form-field">
          Notes
          {editing ? (
            <textarea rows={3} value={guide.notes ?? ""} onChange={(e) => setGuide("notes", e.target.value)} />
          ) : (
            <p className="muted">{guide.notes || "No notes."}</p>
          )}
        </label>
      </section>
    </div>
  );
}
