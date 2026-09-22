import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { deleteItem, listItems } from "../lib/itemStore";
import type { Item } from "../types";

export default function Items() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>(() => listItems());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.itemNumber.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
    );
  }, [items, query]);

  function handleDelete(id: string) {
    if (!confirm("Delete this item?")) return;
    deleteItem(id);
    setItems(listItems());
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Items</h1>
        <p className="muted">Item catalog used to auto-fill description and U/M on order entry.</p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by item # or description..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="inline-actions">
          <Link to="/inventory" className="secondary-btn">
            Manage Inventory
          </Link>
          <Link to="/items/new" className="primary-btn">
            + New Item
          </Link>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="muted">No items found.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Item #</th>
              <th>Description</th>
              <th>U/M</th>
              <th>Rate</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => (
              <tr key={i.id}>
                <td>{i.itemNumber}</td>
                <td>{i.description}</td>
                <td>{i.um}</td>
                <td>${i.rate.toFixed(2)}</td>
                <td className="row-actions">
                  <Link to={`/items/${i.id}/edit`}>Edit</Link>
                  <button type="button" className="link-btn danger-link" onClick={() => handleDelete(i.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
