import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CustomerEditor from "../components/CustomerEditor";
import { useCanEdit } from "../lib/authContext";
import { deleteCustomer, listCustomers, updateCustomer } from "../lib/customerStore";
import type { Customer, CustomerNote } from "../types";

export default function Customers() {
  const { id } = useParams<{ id: string }>();
  // Keyed so switching between customers in the list remounts fresh instead
  // of reusing the previous customer's draft edit state.
  return <CustomersInner key={id ?? "none"} />;
}

function CustomersInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>(() => listCustomers());
  const [draft, setDraft] = useState<Customer | undefined>(() => customers.find((c) => c.id === id));
  const [noteText, setNoteText] = useState("");
  const [saved, setSaved] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.accountNumber.toLowerCase().includes(q)
    );
  }, [customers, query]);

  function refresh() {
    setCustomers(listCustomers());
  }

  function handleSave() {
    if (!draft) return;
    updateCustomer(draft);
    refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleDelete() {
    if (!draft) return;
    if (!confirm(`Delete customer "${draft.name}"?`)) return;
    deleteCustomer(draft.id);
    navigate("/customers");
  }

  function addNote() {
    if (!draft || !noteText.trim()) return;
    const note: CustomerNote = {
      id: crypto.randomUUID(),
      text: noteText.trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = { ...draft, notes: [note, ...draft.notes] };
    updateCustomer(updated);
    setDraft(updated);
    refresh();
    setNoteText("");
  }

  function deleteNote(noteId: string) {
    if (!draft) return;
    const updated = { ...draft, notes: draft.notes.filter((n) => n.id !== noteId) };
    updateCustomer(updated);
    setDraft(updated);
    refresh();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Customers</h1>
        <p className="muted">Select a customer to view and edit their details.</p>
      </div>

      <div className="customers-layout">
        <div className="customers-list-pane">
          <input
            className="search-input"
            placeholder="Search by name or account #..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {canEdit && (
            <Link to="/customers/new" className="primary-btn customers-new-btn">
              + New Customer
            </Link>
          )}
          {filtered.length === 0 ? (
            <p className="muted">No customers found.</p>
          ) : (
            <ul className="customers-name-list">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`customers-name-item ${c.id === id ? "active" : ""}`}
                    onClick={() => navigate(`/customers/${c.id}`)}
                  >
                    {c.name || "Unnamed Customer"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="customers-detail-pane">
          {!draft ? (
            <p className="muted">Select a customer from the list to view details.</p>
          ) : (
            <>
              <div className="customers-detail-header">
                <h2>{draft.name || "Unnamed Customer"}</h2>
                {canEdit && (
                  <button type="button" className="link-btn danger-link" onClick={handleDelete}>
                    Delete Customer
                  </button>
                )}
              </div>

              <CustomerEditor customer={draft} onChange={setDraft} readOnly={!canEdit} />

              {canEdit && (
                <div className="button-row">
                  <button type="button" className="primary-btn" onClick={handleSave}>
                    Save Changes
                  </button>
                  {saved && <span className="muted">Saved.</span>}
                </div>
              )}

              <div className="customer-notes">
                <h3>Notes</h3>
                <div className="note-bubbles">
                  {draft.notes.length === 0 ? (
                    <p className="muted">No notes yet.</p>
                  ) : (
                    draft.notes.map((n) => (
                      <div key={n.id} className="note-bubble">
                        <div className="note-bubble-date">{new Date(n.createdAt).toLocaleString()}</div>
                        <div className="note-bubble-text">{n.text}</div>
                        {canEdit && (
                          <button
                            type="button"
                            className="note-bubble-delete"
                            onClick={() => deleteNote(n.id)}
                            aria-label="Delete note"
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {canEdit && (
                  <div className="note-add-row">
                    <textarea
                      placeholder="Add a note..."
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      rows={2}
                    />
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={addNote}
                      disabled={!noteText.trim()}
                    >
                      Add Note
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
