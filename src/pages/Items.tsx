import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCanEdit } from "../lib/authContext";
import { listItems } from "../lib/itemStore";
import type { Item } from "../types";

export default function Items() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    listItems().then(setItems);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.itemNumber.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
    );
  }, [items, query]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Item Catalog</h1>
        <p className="muted">Item catalog used to auto-fill description and U/M on order entry.</p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by item # or description..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {canEdit && (
          <div className="inline-actions">
            <Link to="/inventory" className="secondary-btn">
              Manage Inventory
            </Link>
            <Link to="/items/new" className="primary-btn">
              + New Item
            </Link>
          </div>
        )}
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
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => (
              <tr key={i.id} className="clickable-row" onClick={() => navigate(`/items/${i.id}`)}>
                <td>{i.itemNumber}</td>
                <td>{i.description}</td>
                <td>{i.um}</td>
                <td>${i.rate.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
