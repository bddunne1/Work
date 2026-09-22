import { useState } from "react";
import { useNavigate } from "react-router-dom";
import CustomerEditor from "../components/CustomerEditor";
import { saveCustomer } from "../lib/customerStore";
import type { Customer } from "../types";
import { emptyCustomer } from "../types";

export default function CustomerForm() {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer>(() => emptyCustomer());

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    saveCustomer(customer);
    navigate(`/customers/all/${customer.id}`);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>New Customer</h1>
        <p className="muted">
          Saved preferences auto-fill billing, terms, and ship via on new orders. Add multiple shipping
          locations if this customer receives at more than one address.
        </p>
      </div>

      <form className="sales-order" onSubmit={handleSubmit}>
        <CustomerEditor customer={customer} onChange={setCustomer} />

        <div className="button-row">
          <button type="submit" className="primary-btn">
            Save Customer
          </button>
          <button type="button" className="secondary-btn" onClick={() => navigate("/customers/all")}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
