import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCanEdit } from "../lib/authContext";
import { listVendorPos } from "../lib/vendorPoStore";
import type { VendorPurchaseOrder } from "../types";
import { matchesVendorPoQuery, vendorPoCostTotal, vendorPoOutstandingTotal } from "../types";

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<VendorPurchaseOrder[]>([]);

  useEffect(() => {
    listVendorPos().then(setPos);
  }, []);

  const filtered = useMemo(() => pos.filter((p) => matchesVendorPoQuery(p, query)), [pos, query]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Purchase Orders</h1>
        <p className="muted">Outbound orders to vendors for replenishing stock.</p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by PO # or vendor..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {canEdit && (
          <div className="inline-actions">
            <Link to="/purchase-orders/new" className="primary-btn">
              + New Purchase Order
            </Link>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="muted">No purchase orders yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>PO #</th>
              <th>Vendor</th>
              <th>Order Date</th>
              <th>Status</th>
              <th>Outstanding Qty</th>
              <th>Total Cost</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.poNumber}
                className="clickable-row"
                onClick={() => navigate(`/purchase-orders/${p.poNumber}`)}
              >
                <td>{p.poNumber}</td>
                <td>{p.vendorName}</td>
                <td>{p.orderDate}</td>
                <td>{p.status}</td>
                <td>{vendorPoOutstandingTotal(p)}</td>
                <td>${vendorPoCostTotal(p).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
