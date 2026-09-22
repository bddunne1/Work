import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listVendorPos } from "../lib/vendorPoStore";
import { matchesVendorPoQuery, vendorPoOutstandingTotal } from "../types";

export default function Receiving() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const openPos = listVendorPos().filter((p) => p.status === "Open" || p.status === "Partially Received");
  const filtered = useMemo(() => openPos.filter((p) => matchesVendorPoQuery(p, query)), [openPos, query]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Receiving</h1>
        <p className="muted">Purchase orders waiting on stock - open one to receive against it.</p>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by PO # or vendor..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="muted">Nothing waiting to be received right now.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>PO #</th>
              <th>Vendor</th>
              <th>Order Date</th>
              <th>Expected</th>
              <th>Status</th>
              <th>Outstanding Qty</th>
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
                <td>{p.expectedDate || "—"}</td>
                <td>{p.status}</td>
                <td>{vendorPoOutstandingTotal(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
