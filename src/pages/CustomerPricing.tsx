import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SearchSelect from "../components/SearchSelect";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { getCustomer, listCustomers, updateCustomer } from "../lib/customerStore";
import { listItems } from "../lib/itemStore";
import type { Customer, CustomerPriceOverride, Item } from "../types";

const ITEM_DATALIST_ID = "customer-pricing-item-options";

// A blank table always ready with a few lines to type into, QuickBooks-
// style - no "add row" step, and the grid grows on its own as the last
// blank line gets filled in.
const MIN_BLANK_ROWS = 5;

function emptyOverride(): CustomerPriceOverride {
  return { id: crypto.randomUUID(), itemNumber: "", customerPartNumber: "", description: "", price: 0 };
}

function withTrailingBlank(overrides: CustomerPriceOverride[], minTotal = 0): CustomerPriceOverride[] {
  const next = [...overrides];
  while (next.length < minTotal) next.push(emptyOverride());
  const last = next[next.length - 1];
  if (!last || last.itemNumber.trim()) next.push(emptyOverride());
  return next;
}

export default function CustomerPricing() {
  const canEdit = useCanEdit();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    listCustomers().then(setCustomers);
    listItems().then(setCatalog);
  }, []);
  const [draft, setDraft] = useState<Customer | undefined>();
  const [saved, setSaved] = useState(false);

  function handleSelect(id: string) {
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    setQuery(c.name);
    setDraft({ ...c, priceOverrides: withTrailingBlank(c.priceOverrides ?? [], MIN_BLANK_ROWS) });
    setSaved(false);
  }

  function updateOverride(id: string, patch: Partial<CustomerPriceOverride>) {
    if (!draft) return;
    const next = (draft.priceOverrides ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o));
    setDraft({ ...draft, priceOverrides: withTrailingBlank(next) });
  }

  function removeOverride(id: string) {
    if (!draft) return;
    const next = (draft.priceOverrides ?? []).filter((o) => o.id !== id);
    setDraft({ ...draft, priceOverrides: withTrailingBlank(next) });
  }

  function applyItemLookup(id: string, itemNumber: string) {
    if (!draft) return;
    const q = itemNumber.trim().toLowerCase();
    const item = catalog.find((c) => c.itemNumber.trim().toLowerCase() === q);
    if (!item) return;
    const mapping = (draft.partNumberMap ?? []).find((m) => m.itemNumber.trim().toLowerCase() === q);
    const current = (draft.priceOverrides ?? []).find((o) => o.id === id);
    updateOverride(id, {
      itemNumber: item.itemNumber,
      description: current?.description?.trim() ? current.description : item.description,
      customerPartNumber: current?.customerPartNumber?.trim()
        ? current.customerPartNumber
        : mapping?.customerPartNumber,
      weight: current?.weight ?? item.weight,
    });
  }

  async function handleSave() {
    if (!draft) return;
    const payload = {
      ...draft,
      priceOverrides: (draft.priceOverrides ?? []).filter((o) => o.itemNumber.trim()),
    };
    try {
      const result = await updateCustomer(payload);
      // Refresh the picker's copy too - re-selecting this customer later
      // otherwise starts from the pre-save version and 409s on the next save.
      setCustomers((cs) => cs.map((c) => (c.id === result.id ? result : c)));
      setDraft({ ...result, priceOverrides: withTrailingBlank(result.priceOverrides ?? [], MIN_BLANK_ROWS) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      if (isConflictError(err)) {
        alert(err.message);
        const fresh = await getCustomer(draft.id);
        if (fresh) setDraft({ ...fresh, priceOverrides: withTrailingBlank(fresh.priceOverrides ?? [], MIN_BLANK_ROWS) });
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
          </div>
          <p className="muted">
            Type a part # to auto-fill its description, customer part #, and weight - price, price per ft,
            and length are yours to set. A blank row is added automatically as you fill the last one.
          </p>
          <datalist id={ITEM_DATALIST_ID}>
            {catalog.map((c) => (
              <option key={c.id} value={c.itemNumber}>
                {c.description}
              </option>
            ))}
          </datalist>
          <div className="table-scroll">
            <table className="data-table pricing-grid">
              <thead>
                <tr>
                  <th>Part #</th>
                  <th>Customer Part #</th>
                  <th>Description</th>
                  <th>Price</th>
                  <th>Price/Ft</th>
                  <th>Length</th>
                  <th>Weight</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {(draft.priceOverrides ?? []).map((o) => (
                  <tr key={o.id}>
                    <td>
                      <input
                        className="bol-input"
                        value={o.itemNumber}
                        disabled={!canEdit}
                        list={canEdit ? ITEM_DATALIST_ID : undefined}
                        onChange={(e) => updateOverride(o.id, { itemNumber: e.target.value })}
                        onBlur={(e) => applyItemLookup(o.id, e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="bol-input"
                        value={o.customerPartNumber ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => updateOverride(o.id, { customerPartNumber: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="bol-input"
                        value={o.description ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => updateOverride(o.id, { description: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="bol-input bol-input-narrow"
                        type="number"
                        step="0.01"
                        value={o.price}
                        disabled={!canEdit}
                        onChange={(e) => updateOverride(o.id, { price: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        className="bol-input bol-input-narrow"
                        type="number"
                        step="0.01"
                        value={o.pricePerFt ?? ""}
                        disabled={!canEdit}
                        onChange={(e) =>
                          updateOverride(o.id, {
                            pricePerFt: e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="bol-input bol-input-narrow"
                        type="number"
                        step="0.01"
                        value={o.length ?? ""}
                        disabled={!canEdit}
                        onChange={(e) =>
                          updateOverride(o.id, { length: e.target.value === "" ? undefined : Number(e.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="bol-input bol-input-narrow"
                        type="number"
                        step="0.01"
                        value={o.weight ?? ""}
                        disabled={!canEdit}
                        onChange={(e) =>
                          updateOverride(o.id, { weight: e.target.value === "" ? undefined : Number(e.target.value) })
                        }
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
          </div>

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
