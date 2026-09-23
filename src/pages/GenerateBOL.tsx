import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCanEdit } from "../lib/authContext";
import { listOrders, updateOrder } from "../lib/orderStore";
import { matchesOrderQuery, orderTotal } from "../types";

interface BolInput {
  weight: string;
  dimensions: string;
  skidCount: string;
}

function emptyBolInput(): BolInput {
  return { weight: "", dimensions: "", skidCount: "" };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function GenerateBOL() {
  const canEdit = useCanEdit();
  const [orders, setOrders] = useState(() => listOrders());
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, BolInput>>({});
  const [carrier, setCarrier] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [generated, setGenerated] = useState(false);

  const filtered = useMemo(
    () => orders.filter((o) => o.status !== "Shipped" && matchesOrderQuery(o, query)),
    [orders, query]
  );

  const selectedOrders = orders.filter((o) => selected.has(o.soNumber));

  function toggleSelect(soNumber: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(soNumber)) {
        next.delete(soNumber);
      } else {
        next.add(soNumber);
      }
      return next;
    });
    setDetails((d) => (d[soNumber] ? d : { ...d, [soNumber]: emptyBolInput() }));
    setGenerated(false);
  }

  function updateDetail(soNumber: string, field: keyof BolInput, value: string) {
    setDetails((d) => ({ ...d, [soNumber]: { ...(d[soNumber] ?? emptyBolInput()), [field]: value } }));
    setGenerated(false);
  }

  const canGenerate =
    selectedOrders.length > 0 &&
    selectedOrders.every((o) => {
      const d = details[o.soNumber];
      return d && d.weight.trim() && d.skidCount.trim();
    });

  function handleGenerate() {
    if (!canGenerate) return;
    const generatedAt = new Date().toISOString();
    for (const o of selectedOrders) {
      updateOrder({ ...o, bol: { ...details[o.soNumber], generatedAt } });
    }
    setOrders(listOrders());
    setGenerated(true);
    setTimeout(() => window.print(), 50);
  }

  const totalWeight = selectedOrders.reduce(
    (sum, o) => sum + (Number(details[o.soNumber]?.weight) || 0),
    0
  );
  const totalSkids = selectedOrders.reduce(
    (sum, o) => sum + (Number(details[o.soNumber]?.skidCount) || 0),
    0
  );

  return (
    <div className="page">
      <div className="no-print">
        <div className="page-header">
          <h1>Generate BOL</h1>
          <p className="muted">
            Select one or more orders, enter weight, dimensions, and skid counts, then generate a Bill of
            Lading for the carrier.
          </p>
        </div>

        <div className="toolbar">
          <input
            className="search-input"
            placeholder="Search by S.O. #, P.O. #, or customer..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {filtered.length === 0 ? (
          <p className="muted">No open orders found.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>S.O. #</th>
                <th>P.O. #</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr
                  key={o.soNumber}
                  className="clickable-row"
                  onClick={() => canEdit && toggleSelect(o.soNumber)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(o.soNumber)}
                      onChange={() => toggleSelect(o.soNumber)}
                      disabled={!canEdit}
                    />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to={`/storage/${o.soNumber}`} target="_blank" className="row-action-outline">
                      {o.soNumber}
                    </Link>
                  </td>
                  <td>{o.poNumber}</td>
                  <td>{o.billTo.name}</td>
                  <td>{o.status}</td>
                  <td>${orderTotal(o).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {selectedOrders.length > 0 && (
          <section className="lane-section bol-details-section">
            <h2 className="lane-title" style={{ borderColor: "#f06595" }}>
              Shipment Details
            </h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th>S.O. #</th>
                  <th>Weight (lbs)</th>
                  <th>Dimensions (L x W x H)</th>
                  <th>Skid Count</th>
                </tr>
              </thead>
              <tbody>
                {selectedOrders.map((o) => {
                  const d = details[o.soNumber] ?? emptyBolInput();
                  return (
                    <tr key={o.soNumber}>
                      <td>{o.soNumber}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          className="bol-input bol-input-narrow"
                          value={d.weight}
                          onChange={(e) => updateDetail(o.soNumber, "weight", e.target.value)}
                          disabled={!canEdit}
                        />
                      </td>
                      <td>
                        <input
                          className="bol-input"
                          value={d.dimensions}
                          placeholder='e.g. 48" x 40" x 36"'
                          onChange={(e) => updateDetail(o.soNumber, "dimensions", e.target.value)}
                          disabled={!canEdit}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          className="bol-input bol-input-narrow"
                          value={d.skidCount}
                          onChange={(e) => updateDetail(o.soNumber, "skidCount", e.target.value)}
                          disabled={!canEdit}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="bol-meta-inputs">
              <label>
                Carrier / Ship Via
                <input
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder="e.g. Common Carrier"
                  disabled={!canEdit}
                />
              </label>
              <label>
                Special Instructions
                <textarea
                  rows={2}
                  value={specialInstructions}
                  onChange={(e) => setSpecialInstructions(e.target.value)}
                  disabled={!canEdit}
                />
              </label>
            </div>

            {canEdit && (
              <div className="button-row">
                <button type="button" className="primary-btn" onClick={handleGenerate} disabled={!canGenerate}>
                  Generate BOL
                </button>
              </div>
            )}
            {!canGenerate && selectedOrders.length > 0 && (
              <p className="muted bol-hint">
                Enter weight and skid count for every selected order to generate the BOL.
              </p>
            )}
          </section>
        )}
      </div>

      {generated && (
        <div className="sales-order print-only bol-doc">
          <div className="so-header">
            <div className="so-company">
              <div className="so-company-name">Bill of Lading</div>
              <div className="muted">Aamstrand Ropes &amp; Twines · 711 N Grove St, Manteno, IL 60950</div>
              <div className="muted">800-338-0557</div>
            </div>
            <div className="so-meta">
              <table className="meta-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Carrier</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{today()}</td>
                    <td>{carrier || "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {selectedOrders.map((o) => {
            const d = details[o.soNumber] ?? emptyBolInput();
            return (
              <div key={o.soNumber} className="bol-order-block">
                <table className="data-table line-item-table">
                  <thead>
                    <tr>
                      <th>S.O. #</th>
                      <th>P.O. #</th>
                      <th>Ship To</th>
                      <th>Weight</th>
                      <th>Dimensions</th>
                      <th>Skids</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{o.soNumber}</td>
                      <td>{o.poNumber || "—"}</td>
                      <td>
                        {o.shipTo.name}, {o.shipTo.addressLine1}, {o.shipTo.city}, {o.shipTo.state}{" "}
                        {o.shipTo.zip}
                      </td>
                      <td>{d.weight} lbs</td>
                      <td>{d.dimensions || "—"}</td>
                      <td>{d.skidCount}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}

          <table className="totals-table bol-totals">
            <tbody>
              <tr>
                <td>Total Weight</td>
                <td>{totalWeight} lbs</td>
              </tr>
              <tr>
                <td>Total Skids</td>
                <td>{totalSkids}</td>
              </tr>
            </tbody>
          </table>

          {specialInstructions && (
            <div className="label-notes">
              <span className="muted">Special Instructions</span> {specialInstructions}
            </div>
          )}

          <div className="bol-signatures">
            <div className="bol-signature-line">
              <span className="muted">Shipper Signature</span>
              <div className="bol-signature-blank"></div>
            </div>
            <div className="bol-signature-line">
              <span className="muted">Carrier Signature</span>
              <div className="bol-signature-blank"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
