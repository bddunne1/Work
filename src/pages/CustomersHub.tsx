import { Link } from "react-router-dom";
import { CustomerListIcon, PricingIcon, RoutingIcon } from "../components/SidebarIcons";
import { useAuth } from "../lib/authContext";
import { getAccessLevel } from "../lib/permissions";

const CARDS = [
  {
    name: "Customer List",
    description: "Billing, shipping, terms, notes, and the part-number catalog for each customer",
    to: "/customers/all",
    icon: CustomerListIcon,
  },
  {
    name: "Customer Pricing",
    description: "Set customer-specific price overrides that auto-fill on Order Entry",
    to: "/customers/pricing",
    icon: PricingIcon,
  },
  {
    name: "Routing Guide",
    description: "Carrier routing and shipping compliance requirements per customer",
    to: "/customers/routing-guide",
    icon: RoutingIcon,
  },
];

export default function CustomersHub() {
  const { account } = useAuth();
  const visible = CARDS.filter((c) => getAccessLevel(c.to, account!) !== "none");

  return (
    <div className="page">
      <div className="page-header">
        <h1>Customers</h1>
        <p className="muted">Choose what you need: the customer list, pricing, or routing guide.</p>
      </div>
      <div className="hub-card-grid">
        {visible.map((c) => (
          <Link key={c.name} to={c.to} className="hub-card">
            <div className="hub-card-body">
              <div className="hub-card-name">{c.name}</div>
              <div className="hub-card-desc">{c.description}</div>
            </div>
            <div className="hub-card-icon">
              <c.icon />
            </div>
          </Link>
        ))}
      </div>
      {visible.length === 0 && (
        <p className="muted">Your account doesn't have access to any customer pages.</p>
      )}
    </div>
  );
}
