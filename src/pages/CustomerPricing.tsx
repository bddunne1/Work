import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SearchSelect from "../components/SearchSelect";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { getCustomer, listCustomers, updateCustomer } from "../lib/customerStore";
import type { Customer, CustomerPriceOverride } from "../types";

export default function CustomerPricing() {
  const canEdit = useCanEdit();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    listCustomers().then(setCustomers);
  }, []);
  const [draft, setDraft] = useState<Customer | undefined>();
  const [saved, setSaved] = useState(false);

  function handleSelect(id: string) {
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    setQuery(c.name);
    setDraft(c);
    setSaved(false);
  }

  function addOverride() {
    if (!draft) return;
    const override: CustomerPriceOverride = { id: crypto.randomUUID(), itemNumber: "", price: 0 };
    setDraft({ ...draft, priceOverrides: [...(draft.priceOverrides ?? []), override] });
  }

  function updateOverride(id: string, patch: Partial<CustomerPriceOverride>) {
    if (!draft) return;
    setDraft({
      ...draft,
      priceOverrides: (draft.priceOverrides ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)),
    });
  }

  function removeOverride(id: string) {
    if (!draft) return;
    setDraft({ ...draft, priceOverrides: (draft.priceOverrides ?? []).filter((o) => o.id !== id) });
  }

  async function handleSave() {
    if (!draft) return;
    try {
      setDraft(await updateCustomer(draft));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      if (isConflictError(err)) {
        alert(err.message);
        setDraft(await getCustomer(draft.id));
        return;
      }
      throw err;
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/customers" className="link-btn">
          &larr; Customers
        </Link>
        <h1>Customer Pricing</h1>
        <p className="muted">
          Set item price overrides for a customer - they auto-fill on Order Entry instead of the catalog
          rate.
        </p>
      </div>

      <div className="customer-picker">
        <label htmlFor="pricing-customer-search">Customer</label>
        <SearchSelect
          id="pricing-customer-search"
          options={customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.accountNumber }))}
          value={query}
          onQueryChange={setQuery}
          onSelect={handleSelect}
          placeholder="Search customers by name or account #..."
        />
      </div>

      {!draft ? (
        <p className="muted">Select a customer to manage their pricing.</p>
      ) : (
        <section className="lane-section">
          <div className="ship-locations-header">
            <h3>Price Overrides for {draft.name}</h3>
            {canEdit && (
              <button type="button" className="secondary-btn" onClick={addOverride}>
                + Add Override
              </button>
            )}
          </div>
          {(draft.priceOverrides ?? []).length === 0 ? (
            <p className="muted">No price overrides yet - this customer pays catalog rate on everything.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item #</th>
                  <th>Price</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {(draft.priceOverrides ?? []).map((o) => (
                  <tr key={o.id}>
                    <td>
                      <input
                        value={o.itemNumber}
                        disabled={!canEdit}
                        onChange={(e) => updateOverride(o.id, { itemNumber: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={o.price}
                        disabled={!canEdit}
                        onChange={(e) => updateOverride(o.id, { price: Number(e.target.value) })}
                      />
                    </td>
                    {canEdit && (
                      <td>
                        <button
                          type="button"
                          className="row-action-outline danger-link"
                          onClick={() => removeOverride(o.id)}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

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
