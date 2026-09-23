import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Customer } from "../types";
import { listCustomers } from "../lib/customerStore";

export default function RoutingGuide() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    listCustomers().then(setCustomers);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.accountNumber.toLowerCase().includes(q) ||
        (c.routingGuide?.preferredCarrier ?? "").toLowerCase().includes(q) ||
        (c.routingGuide?.routingAccountNumber ?? "").toLowerCase().includes(q)
    );
  }, [customers, query]);

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/customers" className="link-btn">
          &larr; Customers
        </Link>
        <h1>Routing Guide</h1>
        <p className="muted">
          Every customer's preferred carrier and routing account #, at a glance. Click a customer for
          their full routing instructions.
        </p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by customer, account #, or carrier..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="muted">No customers found.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Account #</th>
              <th>Preferred Carrier</th>
              <th>Routing Account #</th>
              <th>Appointment Required</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={c.id}
                className="clickable-row"
                onClick={() => navigate(`/customers/routing-guide/${c.id}`)}
              >
                <td>{c.name}</td>
                <td>{c.accountNumber || "—"}</td>
                <td>{c.routingGuide?.preferredCarrier || "—"}</td>
                <td>{c.routingGuide?.routingAccountNumber || "—"}</td>
                <td>
                  {c.routingGuide?.appointmentRequired ? (
                    <span className="status-pill status-pill-backordered">Required</span>
                  ) : (
                    <span className="muted">No</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
