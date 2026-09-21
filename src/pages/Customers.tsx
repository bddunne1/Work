import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { deleteCustomer, listCustomers } from "../lib/customerStore";
import type { Customer } from "../types";

export default function Customers() {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>(() => listCustomers());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.accountNumber.toLowerCase().includes(q)
    );
  }, [customers, query]);

  function handleDelete(id: string) {
    if (!confirm("Delete this customer?")) return;
    deleteCustomer(id);
    setCustomers(listCustomers());
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Customers</h1>
        <p className="muted">Manage customer records used to auto-fill order entry.</p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by name or account #..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Link to="/customers/new" className="primary-btn">
          + New Customer
        </Link>
      </div>

      {filtered.length === 0 ? (
        <p className="muted">No customers found.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Account #</th>
              <th>Terms</th>
              <th>Ship Via</th>
              <th>City / State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.accountNumber}</td>
                <td>{c.terms}</td>
                <td>{c.shipVia}</td>
                <td>
                  {c.billTo.city}
                  {c.billTo.city && c.billTo.state ? ", " : ""}
                  {c.billTo.state}
                </td>
                <td className="row-actions">
                  <Link to={`/customers/${c.id}/edit`}>Edit</Link>
                  <button type="button" className="link-btn danger-link" onClick={() => handleDelete(c.id)}>
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
