import { useState } from "react";
import { Link } from "react-router-dom";
import SearchSelect from "../components/SearchSelect";
import { useCanEdit } from "../lib/authContext";
import { listCustomers, updateCustomer } from "../lib/customerStore";
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

export default function RoutingGuide() {
  const canEdit = useCanEdit();
  const [customers] = useState<Customer[]>(() => listCustomers());
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Customer | undefined>();
  const [saved, setSaved] = useState(false);

  function handleSelect(id: string) {
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    setQuery(c.name);
    setDraft(c);
    setSaved(false);
  }

  function setGuide<K extends keyof RoutingGuideData>(key: K, value: RoutingGuideData[K]) {
    if (!draft) return;
    setDraft({ ...draft, routingGuide: { ...(draft.routingGuide ?? emptyRoutingGuide()), [key]: value } });
  }

  function handleSave() {
    if (!draft) return;
    updateCustomer(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const guide = draft?.routingGuide ?? emptyRoutingGuide();

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/customers" className="link-btn">
          &larr; Customers
        </Link>
        <h1>Routing Guide</h1>
        <p className="muted">
          Carrier routing and shipping compliance requirements for a customer - reference material for
          logistics, kept separate from day-to-day order fields.
        </p>
      </div>

      <div className="customer-picker">
        <label htmlFor="routing-customer-search">Customer</label>
        <SearchSelect
          id="routing-customer-search"
          options={customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.accountNumber }))}
          value={query}
          onQueryChange={setQuery}
          onSelect={handleSelect}
          placeholder="Search customers by name or account #..."
        />
      </div>

      {!draft ? (
        <p className="muted">Select a customer to view or edit their routing guide.</p>
      ) : (
        <section className="lane-section">
          <h3>Routing Guide for {draft.name}</h3>

          <div className="form-row">
            <label className="form-field">
              Preferred Carrier
              <input
                value={guide.preferredCarrier ?? ""}
                disabled={!canEdit}
                onChange={(e) => setGuide("preferredCarrier", e.target.value)}
              />
            </label>
            <label className="form-field">
              Routing Account #
              <input
                value={guide.routingAccountNumber ?? ""}
                disabled={!canEdit}
                onChange={(e) => setGuide("routingAccountNumber", e.target.value)}
              />
            </label>
          </div>

          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={Boolean(guide.appointmentRequired)}
              disabled={!canEdit}
              onChange={(e) => setGuide("appointmentRequired", e.target.checked)}
            />
            Delivery appointment required
          </label>

          <label className="form-field">
            Labeling Requirements
            <textarea
              rows={2}
              value={guide.labelingRequirements ?? ""}
              disabled={!canEdit}
              onChange={(e) => setGuide("labelingRequirements", e.target.value)}
            />
          </label>

          <label className="form-field">
            Notes
            <textarea
              rows={3}
              value={guide.notes ?? ""}
              disabled={!canEdit}
              onChange={(e) => setGuide("notes", e.target.value)}
            />
          </label>

          {canEdit && (
            <div className="button-row">
              <button type="button" className="primary-btn" onClick={handleSave}>
                Save Changes
              </button>
              {saved && <span className="muted">Saved.</span>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
