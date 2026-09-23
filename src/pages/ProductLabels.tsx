import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import SearchSelect from "../components/SearchSelect";
import { getCompanyInfo } from "../lib/companyStore";
import { listCustomers } from "../lib/customerStore";
import { itemsIndex, listItems } from "../lib/itemStore";
import { listOrders } from "../lib/orderStore";
import type { Customer, Item, PurchaseOrder } from "../types";

type Mode = "customer" | "all";

interface LabelItem {
  itemNumber: string;
  description: string;
  um: string;
}

function purchasedItemsFor(
  customerId: string,
  itemsByNumber: Map<string, Item>,
  allOrders: PurchaseOrder[]
): LabelItem[] {
  const orders = allOrders.filter((o) => o.customerId === customerId);
  const byNumber = new Map<string, LabelItem>();
  for (const o of orders) {
    for (const li of o.lineItems) {
      const key = li.item.trim().toLowerCase();
      if (!key || byNumber.has(key)) continue;
      const catalogItem = itemsByNumber.get(key);
      byNumber.set(key, {
        itemNumber: li.item,
        description: catalogItem?.description || li.description,
        um: catalogItem?.um || li.um,
      });
    }
  }
  return [...byNumber.values()].sort((a, b) => a.itemNumber.localeCompare(b.itemNumber));
}

export default function ProductLabels() {
  const [mode, setMode] = useState<Mode>("customer");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);

  useEffect(() => {
    listCustomers().then(setCustomers);
    listItems().then(setItems);
    listOrders().then(setAllOrders);
  }, []);
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const itemsByNumber = useMemo(() => itemsIndex(items), [items]);

  const candidates: LabelItem[] = useMemo(() => {
    if (mode === "customer") {
      return customerId ? purchasedItemsFor(customerId, itemsByNumber, allOrders) : [];
    }
    return items.map((i) => ({ itemNumber: i.itemNumber, description: i.description, um: i.um }));
  }, [mode, customerId, items, itemsByNumber, allOrders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (i) => i.itemNumber.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
    );
  }, [candidates, query]);

  const selectedItems = filtered.filter((i) => selected[i.itemNumber]);
  const brandName =
    mode === "customer" && selectedCustomer?.privateLabelName
      ? selectedCustomer.privateLabelName
      : getCompanyInfo().name;

  function switchMode(next: Mode) {
    setMode(next);
    setSelected({});
    setQuery("");
  }

  function handleSelectCustomer(id: string) {
    const customer = customers.find((c) => c.id === id);
    if (!customer) return;
    setCustomerId(id);
    setCustomerQuery(customer.name);
    setSelected({});
  }

  function toggle(itemNumber: string) {
    setSelected((s) => ({ ...s, [itemNumber]: !s[itemNumber] }));
  }

  function selectAll() {
    const s: Record<string, boolean> = {};
    for (const i of filtered) s[i.itemNumber] = true;
    setSelected(s);
  }

  function selectNone() {
    setSelected({});
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <Link to="/labels" className="link-btn">
          &larr; Back to Create Labels
        </Link>
        <h1>Product Labels</h1>
        <button
          type="button"
          className="secondary-btn print-btn"
          onClick={() => window.print()}
          disabled={selectedItems.length === 0}
        >
          Print {selectedItems.length || ""} Label{selectedItems.length === 1 ? "" : "s"}
        </button>
      </div>

      <div className="no-print">
        <div className="import-type-tabs">
          <button
            type="button"
            className={`decision-btn ${mode === "customer" ? "selected" : ""}`}
            onClick={() => switchMode("customer")}
          >
            By Customer
          </button>
          <button
            type="button"
            className={`decision-btn ${mode === "all" ? "selected" : ""}`}
            onClick={() => switchMode("all")}
          >
            All Items
          </button>
        </div>

        {mode === "customer" && (
          <div className="customer-picker">
            <label htmlFor="product-label-customer-search">Customer</label>
            <SearchSelect
              id="product-label-customer-search"
              options={customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.accountNumber }))}
              value={customerQuery}
              onQueryChange={setCustomerQuery}
              onSelect={handleSelectCustomer}
              placeholder="Search customers by name or account #..."
            />
            {selectedCustomer?.privateLabelName && (
              <p className="muted">
                Private label brand: <strong>{selectedCustomer.privateLabelName}</strong>
              </p>
            )}
          </div>
        )}

        {mode === "customer" && !customerId ? (
          <p className="muted">Search for a customer above to see the products they've purchased.</p>
        ) : filtered.length === 0 ? (
          <p className="muted">
            {mode === "customer" ? "This customer hasn't ordered any items yet." : "No items found."}
          </p>
        ) : (
          <>
            <div className="toolbar">
              <input
                className="search-input"
                placeholder="Search by item # or description..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="inline-actions">
                <button type="button" className="secondary-btn" onClick={selectAll}>
                  Select All
                </button>
                <button type="button" className="secondary-btn" onClick={selectNone}>
                  Select None
                </button>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Item #</th>
                  <th>Description</th>
                  <th>U/M</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.itemNumber} className="clickable-row" onClick={() => toggle(i.itemNumber)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[i.itemNumber])}
                        onChange={() => toggle(i.itemNumber)}
                        aria-label={`Select ${i.itemNumber}`}
                      />
                    </td>
                    <td>{i.itemNumber}</td>
                    <td>{i.description}</td>
                    <td>{i.um}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {selectedItems.map((i, idx) => (
        <div
          key={i.itemNumber}
          className={`product-label print-only ${idx === selectedItems.length - 1 ? "" : "batch-page-break"}`}
        >
          <div className="product-label-brand">{brandName}</div>
          <div className="product-label-desc">{i.description}</div>
          <div className="product-label-meta">
            <span>Item # {i.itemNumber}</span>
            <span>{i.um}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
