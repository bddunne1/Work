import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { companyAddressLine, getCompanyInfo } from "../lib/companyStore";
import { listOrders, updateOrder } from "../lib/orderStore";
import type { Address, BolDetails, PurchaseOrder } from "../types";
import { matchesOrderQuery, orderTotal } from "../types";

interface BolInput {
  weight: string;
  packageCount: string;
  palletSlip: "Y" | "N";
  handlingUnitQty: string;
  handlingUnitType: string;
  packageQty: string;
  packageType: string;
  hazmat: boolean;
  commodityDescription: string;
  nmfcNumber: string;
  freightClass: string;
  additionalInfo: string;
}

function emptyBolInput(order: PurchaseOrder): BolInput {
  return {
    weight: "",
    packageCount: "",
    palletSlip: "Y",
    handlingUnitQty: "",
    handlingUnitType: "Pallet",
    packageQty: "",
    packageType: "Cartons",
    hazmat: false,
    commodityDescription: order.lineItems.map((li) => li.description).filter(Boolean).join("; "),
    nmfcNumber: "",
    freightClass: "",
    additionalInfo: "",
  };
}

type FreightChargeTerm = "Prepaid" | "Collect" | "3rdParty";
type CodFeeTerm = "Collect" | "Prepaid" | "";
type TrailerLoadedBy = "Shipper" | "Driver" | "";
type FreightCountedBy = "Shipper" | "DriverPallets" | "DriverPieces" | "";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addressesMatch(a: Address, b: Address): boolean {
  return (
    a.name === b.name &&
    a.addressLine1 === b.addressLine1 &&
    (a.addressLine2 ?? "") === (b.addressLine2 ?? "") &&
    a.city === b.city &&
    a.state === b.state &&
    a.zip === b.zip
  );
}

export default function GenerateBOL() {
  const canEdit = useCanEdit();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    listOrders().then(setOrders);
  }, []);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, BolInput>>({});
  const [generated, setGenerated] = useState(false);

  // Shipment-level fields - filled fresh for each BOL the way a paper form
  // is, rather than persisted per order (a BOL can span several orders with
  // no single "owner" for this data).
  const [bolNumber, setBolNumber] = useState("");
  const [sidNumber, setSidNumber] = useState("");
  const [cidNumber, setCidNumber] = useState("");
  const [locationNumber, setLocationNumber] = useState("");
  const [shipFromFob, setShipFromFob] = useState(false);
  const [shipToFob, setShipToFob] = useState(false);
  const [carrierName, setCarrierName] = useState("");
  const [trailerNumber, setTrailerNumber] = useState("");
  const [sealNumber, setSealNumber] = useState("");
  const [scac, setScac] = useState("");
  const [proNumber, setProNumber] = useState("");
  const [freightChargeTerm, setFreightChargeTerm] = useState<FreightChargeTerm>("Prepaid");
  const [masterBol, setMasterBol] = useState(false);
  const [thirdPartyName, setThirdPartyName] = useState("");
  const [thirdPartyAddress, setThirdPartyAddress] = useState("");
  const [thirdPartyCityStateZip, setThirdPartyCityStateZip] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [codAmount, setCodAmount] = useState("");
  const [codFeeTerm, setCodFeeTerm] = useState<CodFeeTerm>("");
  const [codCustomerCheckOk, setCodCustomerCheckOk] = useState(false);
  const [trailerLoadedBy, setTrailerLoadedBy] = useState<TrailerLoadedBy>("");
  const [freightCountedBy, setFreightCountedBy] = useState<FreightCountedBy>("");

  const filtered = useMemo(
    () => orders.filter((o) => o.status !== "Shipped" && matchesOrderQuery(o, query)),
    [orders, query]
  );

  const selectedOrders = orders.filter((o) => selected.has(o.soNumber));
  const company = getCompanyInfo();

  // If every selected order ships to the same address, show it once in the
  // Ship To header the way a real BOL expects a single destination.
  const commonShipTo =
    selectedOrders.length > 0 &&
    selectedOrders.every((o) => addressesMatch(o.shipTo, selectedOrders[0].shipTo))
      ? selectedOrders[0].shipTo
      : undefined;

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
    setDetails((d) => {
      if (d[soNumber]) return d;
      const order = orders.find((o) => o.soNumber === soNumber);
      return order ? { ...d, [soNumber]: emptyBolInput(order) } : d;
    });
    setGenerated(false);
  }

  function updateDetail(soNumber: string, patch: Partial<BolInput>) {
    setDetails((d) => {
      const order = orders.find((o) => o.soNumber === soNumber);
      const base = d[soNumber] ?? (order ? emptyBolInput(order) : undefined);
      if (!base) return d;
      return { ...d, [soNumber]: { ...base, ...patch } };
    });
    setGenerated(false);
  }

  const canGenerate =
    selectedOrders.length > 0 &&
    selectedOrders.every((o) => {
      const d = details[o.soNumber];
      return d && d.weight.trim() && d.handlingUnitQty.trim();
    });

  async function handleGenerate() {
    if (!canGenerate) return;
    const generatedAt = new Date().toISOString();
    try {
      for (const o of selectedOrders) {
        const d = details[o.soNumber];
        const bol: BolDetails = { ...d, generatedAt };
        await updateOrder({ ...o, bol });
      }
    } catch (err) {
      if (isConflictError(err)) {
        alert(`${err.message} No BOL was generated for the remaining selected orders - review and try again.`);
        setOrders(await listOrders());
        return;
      }
      throw err;
    }
    setOrders(await listOrders());
    setGenerated(true);
    setTimeout(() => window.print(), 50);
  }

  const totalWeight = selectedOrders.reduce(
    (sum, o) => sum + (Number(details[o.soNumber]?.weight) || 0),
    0
  );
  const totalPackages = selectedOrders.reduce(
    (sum, o) => sum + (Number(details[o.soNumber]?.packageCount) || 0),
    0
  );

  return (
    <div className="page">
      <div className="no-print">
        <div className="page-header">
          <h1>Generate BOL</h1>
          <p className="muted">
            Select one or more orders, fill in the shipment and carrier details, then generate a standard
            Bill of Lading for the carrier.
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
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>S.O. #</th>
                    <th># PKGS</th>
                    <th>Weight (lbs)</th>
                    <th>Pallet/Slip</th>
                    <th>H.U. Qty</th>
                    <th>H.U. Type</th>
                    <th>Pkg Qty</th>
                    <th>Pkg Type</th>
                    <th>H.M.</th>
                    <th>Commodity Description</th>
                    <th>NMFC #</th>
                    <th>Class</th>
                    <th>Additional Shipper Info</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrders.map((o) => {
                    const d = details[o.soNumber] ?? emptyBolInput(o);
                    return (
                      <tr key={o.soNumber}>
                        <td>
                          <Link to={`/storage/${o.soNumber}`} target="_blank" className="row-action-outline">
                            {o.soNumber}
                          </Link>
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            className="bol-input bol-input-narrow"
                            value={d.packageCount}
                            onChange={(e) => updateDetail(o.soNumber, { packageCount: e.target.value })}
                            disabled={!canEdit}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            className="bol-input bol-input-narrow"
                            value={d.weight}
                            onChange={(e) => updateDetail(o.soNumber, { weight: e.target.value })}
                            disabled={!canEdit}
                          />
                        </td>
                        <td>
                          <select
                            className="bol-input bol-input-narrow"
                            value={d.palletSlip}
                            onChange={(e) => updateDetail(o.soNumber, { palletSlip: e.target.value as "Y" | "N" })}
                            disabled={!canEdit}
                          >
                            <option value="Y">Y</option>
                            <option value="N">N</option>
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            className="bol-input bol-input-narrow"
                            value={d.handlingUnitQty}
                            onChange={(e) => updateDetail(o.soNumber, { handlingUnitQty: e.target.value })}
                            disabled={!canEdit}
                          />
                        </td>
                        <td>
                          <input
                            className="bol-input bol-input-medium"
                            value={d.handlingUnitType}
                            onChange={(e) => updateDetail(o.soNumber, { handlingUnitType: e.target.value })}
                            disabled={!canEdit}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            className="bol-input bol-input-narrow"
                            value={d.packageQty}
                            onChange={(e) => updateDetail(o.soNumber, { packageQty: e.target.value })}
                            disabled={!canEdit}
                          />
                        </td>
                        <td>
                          <input
                            className="bol-input bol-input-medium"
                            value={d.packageType}
                            onChange={(e) => updateDetail(o.soNumber, { packageType: e.target.value })}
                            disabled={!canEdit}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={d.hazmat}
                            onChange={(e) => updateDetail(o.soNumber, { hazmat: e.target.checked })}
                            disabled={!canEdit}
                          />
                        </td>
                        <td>
                          <input
                            className="bol-input"
                            value={d.commodityDescription}
                            onChange={(e) => updateDetail(o.soNumber, { commodityDescription: e.target.value })}
                            disabled={!canEdit}
                          />
                        </td>
                        <td>
                          <input
                            className="bol-input bol-input-medium"
                            value={d.nmfcNumber}
                            onChange={(e) => updateDetail(o.soNumber, { nmfcNumber: e.target.value })}
                            disabled={!canEdit}
                          />
                        </td>
                        <td>
                          <input
                            className="bol-input bol-input-narrow"
                            value={d.freightClass}
                            onChange={(e) => updateDetail(o.soNumber, { freightClass: e.target.value })}
                            disabled={!canEdit}
                          />
                        </td>
                        <td>
                          <input
                            className="bol-input"
                            value={d.additionalInfo}
                            onChange={(e) => updateDetail(o.soNumber, { additionalInfo: e.target.value })}
                            disabled={!canEdit}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!commonShipTo && (
              <p className="muted bol-hint">
                Selected orders ship to different addresses - the printed BOL will note "multiple
                destinations" in Ship To. Consider a separate BOL per destination.
              </p>
            )}

            <h2 className="lane-title" style={{ borderColor: "#f06595" }}>
              Carrier &amp; Freight Details
            </h2>

            <div className="bol-subhead">Document Info</div>
            <div className="bol-meta-inputs">
              <label>
                Bill of Lading Number
                <input value={bolNumber} onChange={(e) => setBolNumber(e.target.value)} disabled={!canEdit} />
              </label>
              <label>
                SID# (Shipper ID)
                <input value={sidNumber} onChange={(e) => setSidNumber(e.target.value)} disabled={!canEdit} />
              </label>
              <label>
                CID# (Consignee ID)
                <input value={cidNumber} onChange={(e) => setCidNumber(e.target.value)} disabled={!canEdit} />
              </label>
              <label>
                Location #
                <input
                  value={locationNumber}
                  onChange={(e) => setLocationNumber(e.target.value)}
                  disabled={!canEdit}
                />
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={shipFromFob}
                  onChange={(e) => setShipFromFob(e.target.checked)}
                  disabled={!canEdit}
                />
                FOB Ship From
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={shipToFob}
                  onChange={(e) => setShipToFob(e.target.checked)}
                  disabled={!canEdit}
                />
                FOB Ship To
              </label>
            </div>

            <div className="bol-subhead">Carrier</div>
            <div className="bol-meta-inputs">
              <label>
                Carrier Name
                <input
                  value={carrierName}
                  onChange={(e) => setCarrierName(e.target.value)}
                  placeholder="e.g. Common Carrier"
                  disabled={!canEdit}
                />
              </label>
              <label>
                Trailer Number
                <input value={trailerNumber} onChange={(e) => setTrailerNumber(e.target.value)} disabled={!canEdit} />
              </label>
              <label>
                Seal Number(s)
                <input value={sealNumber} onChange={(e) => setSealNumber(e.target.value)} disabled={!canEdit} />
              </label>
              <label>
                SCAC
                <input value={scac} onChange={(e) => setScac(e.target.value)} disabled={!canEdit} />
              </label>
              <label>
                Pro Number
                <input value={proNumber} onChange={(e) => setProNumber(e.target.value)} disabled={!canEdit} />
              </label>
            </div>

            <div className="bol-subhead">Freight Charge Terms</div>
            <div className="decision-buttons">
              {(["Prepaid", "Collect", "3rdParty"] as FreightChargeTerm[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`decision-btn ${freightChargeTerm === t ? "selected" : ""}`}
                  onClick={() => canEdit && setFreightChargeTerm(t)}
                  disabled={!canEdit}
                >
                  {t === "3rdParty" ? "3rd Party" : t}
                </button>
              ))}
            </div>
            <label className="checkbox-line" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={masterBol} onChange={(e) => setMasterBol(e.target.checked)} disabled={!canEdit} />
              Master Bill of Lading - with attached underlying Bills of Lading
            </label>

            <div className="bol-subhead">Third Party Freight Charges Bill To</div>
            <div className="bol-meta-inputs bol-meta-wide">
              <label>
                Name
                <input value={thirdPartyName} onChange={(e) => setThirdPartyName(e.target.value)} disabled={!canEdit} />
              </label>
              <label>
                Address
                <input value={thirdPartyAddress} onChange={(e) => setThirdPartyAddress(e.target.value)} disabled={!canEdit} />
              </label>
              <label>
                City/State/Zip
                <input
                  value={thirdPartyCityStateZip}
                  onChange={(e) => setThirdPartyCityStateZip(e.target.value)}
                  disabled={!canEdit}
                />
              </label>
            </div>

            <div className="bol-subhead">Special Instructions</div>
            <div className="bol-meta-inputs bol-meta-wide">
              <label style={{ gridColumn: "1 / -1" }}>
                <textarea
                  rows={2}
                  value={specialInstructions}
                  onChange={(e) => setSpecialInstructions(e.target.value)}
                  disabled={!canEdit}
                />
              </label>
            </div>

            <div className="bol-subhead">COD</div>
            <div className="bol-meta-inputs">
              <label>
                COD Amount
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={codAmount}
                  onChange={(e) => setCodAmount(e.target.value)}
                  disabled={!canEdit}
                />
              </label>
              <div>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-h)", marginBottom: 4 }}>
                  Fee Terms
                </span>
                <div className="decision-buttons">
                  {(["Collect", "Prepaid"] as CodFeeTerm[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`decision-btn ${codFeeTerm === t ? "selected" : ""}`}
                      onClick={() => canEdit && setCodFeeTerm(codFeeTerm === t ? "" : t)}
                      disabled={!canEdit}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={codCustomerCheckOk}
                  onChange={(e) => setCodCustomerCheckOk(e.target.checked)}
                  disabled={!canEdit}
                />
                Customer check acceptable
              </label>
            </div>

            <div className="bol-subhead">At Pickup</div>
            <div className="bol-meta-inputs">
              <div>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-h)", marginBottom: 4 }}>
                  Trailer Loaded
                </span>
                <div className="decision-buttons">
                  {(["Shipper", "Driver"] as TrailerLoadedBy[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`decision-btn ${trailerLoadedBy === t ? "selected" : ""}`}
                      onClick={() => canEdit && setTrailerLoadedBy(trailerLoadedBy === t ? "" : t)}
                      disabled={!canEdit}
                    >
                      By {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-h)", marginBottom: 4 }}>
                  Freight Counted
                </span>
                <div className="decision-buttons">
                  <button
                    type="button"
                    className={`decision-btn ${freightCountedBy === "Shipper" ? "selected" : ""}`}
                    onClick={() => canEdit && setFreightCountedBy(freightCountedBy === "Shipper" ? "" : "Shipper")}
                    disabled={!canEdit}
                  >
                    By Shipper
                  </button>
                  <button
                    type="button"
                    className={`decision-btn ${freightCountedBy === "DriverPallets" ? "selected" : ""}`}
                    onClick={() =>
                      canEdit && setFreightCountedBy(freightCountedBy === "DriverPallets" ? "" : "DriverPallets")
                    }
                    disabled={!canEdit}
                  >
                    By Driver/Pallets
                  </button>
                  <button
                    type="button"
                    className={`decision-btn ${freightCountedBy === "DriverPieces" ? "selected" : ""}`}
                    onClick={() =>
                      canEdit && setFreightCountedBy(freightCountedBy === "DriverPieces" ? "" : "DriverPieces")
                    }
                    disabled={!canEdit}
                  >
                    By Driver/Pieces
                  </button>
                </div>
              </div>
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
                Enter weight and handling unit qty for every selected order to generate the BOL.
              </p>
            )}
          </section>
        )}
      </div>

      {generated && (
        <div className="bol-doc print-only">
          <div className="bol-page-head">
            <div>
              <strong>Date:</strong> {today()}
            </div>
            <div className="bol-page-title">BILL OF LADING</div>
            <div>
              <strong>Page 1 of</strong> 1
            </div>
          </div>

          <div className="bol-grid-2col">
            <div>
              <div className="bol-box">
                <div className="bol-box-bar">Ship From</div>
                <div className="bol-field-row">
                  <span className="bol-field-label">Name:</span>
                  <span className="bol-field-value">{company.name}</span>
                </div>
                <div className="bol-field-row">
                  <span className="bol-field-label">Address:</span>
                  <span className="bol-field-value">{companyAddressLine(company)}</span>
                </div>
                <div className="bol-field-row">
                  <span className="bol-field-label">SID#:</span>
                  <span className="bol-field-value">{sidNumber || "—"}</span>
                </div>
                <div className="bol-checkbox-row">
                  <span className="bol-checkbox-box">{shipFromFob ? "X" : ""}</span>
                  <span>FOB</span>
                </div>
              </div>

              <div className="bol-box">
                <div className="bol-box-bar">Ship To</div>
                {commonShipTo ? (
                  <>
                    <div className="bol-field-row">
                      <span className="bol-field-label">Name:</span>
                      <span className="bol-field-value">{commonShipTo.name || "—"}</span>
                      <span className="bol-field-label">Location #:</span>
                      <span className="bol-field-value">{locationNumber || "—"}</span>
                    </div>
                    <div className="bol-field-row">
                      <span className="bol-field-label">Address:</span>
                      <span className="bol-field-value">
                        {commonShipTo.addressLine1
                          ? `${commonShipTo.addressLine1}${commonShipTo.addressLine2 ? `, ${commonShipTo.addressLine2}` : ""}`
                          : "—"}
                      </span>
                    </div>
                    <div className="bol-field-row">
                      <span className="bol-field-label">City/State/Zip:</span>
                      <span className="bol-field-value">
                        {commonShipTo.city || commonShipTo.state || commonShipTo.zip
                          ? `${commonShipTo.city}, ${commonShipTo.state} ${commonShipTo.zip}`
                          : "—"}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="muted">Multiple destinations - see Customer Order Information below.</p>
                )}
                <div className="bol-field-row">
                  <span className="bol-field-label">CID#:</span>
                  <span className="bol-field-value">{cidNumber || "—"}</span>
                </div>
                <div className="bol-checkbox-row">
                  <span className="bol-checkbox-box">{shipToFob ? "X" : ""}</span>
                  <span>FOB</span>
                </div>
              </div>

              <div className="bol-box">
                <div className="bol-box-bar">Third Party Freight Charges Bill To</div>
                <div className="bol-field-row">
                  <span className="bol-field-label">Name:</span>
                  <span className="bol-field-value">{thirdPartyName || "—"}</span>
                </div>
                <div className="bol-field-row">
                  <span className="bol-field-label">Address:</span>
                  <span className="bol-field-value">{thirdPartyAddress || "—"}</span>
                </div>
                <div className="bol-field-row">
                  <span className="bol-field-label">City/State/Zip:</span>
                  <span className="bol-field-value">{thirdPartyCityStateZip || "—"}</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  <span className="bol-field-label">Special Instructions:</span>
                  <div className="bol-field-value" style={{ minHeight: 28 }}>
                    {specialInstructions || "—"}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="bol-box">
                <div className="bol-field-row">
                  <span className="bol-field-label">Bill of Lading Number:</span>
                  <span className="bol-field-value">{bolNumber || "—"}</span>
                </div>
                <div className="bol-barcode-space">BAR CODE SPACE</div>
              </div>

              <div className="bol-box">
                <div className="bol-field-row">
                  <span className="bol-field-label">Carrier Name:</span>
                  <span className="bol-field-value">{carrierName || "—"}</span>
                </div>
                <div className="bol-field-row">
                  <span className="bol-field-label">Trailer number:</span>
                  <span className="bol-field-value">{trailerNumber || "—"}</span>
                </div>
                <div className="bol-field-row">
                  <span className="bol-field-label">Seal number(s):</span>
                  <span className="bol-field-value">{sealNumber || "—"}</span>
                </div>
                <div className="bol-field-row">
                  <span className="bol-field-label">SCAC:</span>
                  <span className="bol-field-value">{scac || "—"}</span>
                </div>
                <div className="bol-field-row">
                  <span className="bol-field-label">Pro number:</span>
                  <span className="bol-field-value">{proNumber || "—"}</span>
                </div>
                <div className="bol-barcode-space">BAR CODE SPACE</div>
              </div>

              <div className="bol-box">
                <div>
                  <strong>Freight Charge Terms</strong>{" "}
                  <span className="muted">(freight charges are prepaid unless marked otherwise)</span>
                </div>
                <div className="bol-freight-terms-row">
                  <span>
                    <span className="bol-checkbox-box">{freightChargeTerm === "Prepaid" ? "X" : ""}</span> Prepaid
                  </span>
                  <span>
                    <span className="bol-checkbox-box">{freightChargeTerm === "Collect" ? "X" : ""}</span> Collect
                  </span>
                  <span>
                    <span className="bol-checkbox-box">{freightChargeTerm === "3rdParty" ? "X" : ""}</span> 3rd Party
                  </span>
                </div>
                <div className="bol-checkbox-row" style={{ marginTop: 8 }}>
                  <span className="bol-checkbox-box">{masterBol ? "X" : ""}</span>
                  <span>Master Bill of Lading: with attached underlying Bills of Lading</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bol-section-title">Customer Order Information</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer Order Number</th>
                <th># PKGS</th>
                <th>Weight</th>
                <th>Pallet/Slip</th>
                <th>Additional Shipper Info</th>
              </tr>
            </thead>
            <tbody>
              {selectedOrders.map((o) => {
                const d = details[o.soNumber] ?? emptyBolInput(o);
                return (
                  <tr key={o.soNumber}>
                    <td>{o.poNumber || o.soNumber}</td>
                    <td>{d.packageCount || "—"}</td>
                    <td className="amount-cell">{d.weight ? `${d.weight} lbs` : "—"}</td>
                    <td>{d.palletSlip}</td>
                    <td>
                      S.O. #{o.soNumber} &middot; {o.billTo.name}
                      {d.additionalInfo ? ` · ${d.additionalInfo}` : ""}
                    </td>
                  </tr>
                );
              })}
              <tr className="bol-grand-total-row">
                <td>Grand Total</td>
                <td>{totalPackages || "—"}</td>
                <td className="amount-cell">{totalWeight} lbs</td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>

          <div className="bol-section-title">Carrier Information</div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th colSpan={2}>Handling Unit</th>
                  <th colSpan={2}>Package</th>
                  <th>Weight</th>
                  <th>H.M. (X)</th>
                  <th>Commodity Description</th>
                  <th>NMFC #</th>
                  <th>Class</th>
                </tr>
                <tr>
                  <th>Qty</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>Type</th>
                  <th></th>
                  <th></th>
                  <th></th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {selectedOrders.map((o) => {
                  const d = details[o.soNumber] ?? emptyBolInput(o);
                  return (
                    <tr key={o.soNumber}>
                      <td>{d.handlingUnitQty || "—"}</td>
                      <td>{d.handlingUnitType || "—"}</td>
                      <td>{d.packageQty || "—"}</td>
                      <td>{d.packageType || "—"}</td>
                      <td className="amount-cell">{d.weight ? `${d.weight} lbs` : "—"}</td>
                      <td>{d.hazmat ? "X" : ""}</td>
                      <td>{d.commodityDescription || "—"}</td>
                      <td>{d.nmfcNumber || "—"}</td>
                      <td>{d.freightClass || "—"}</td>
                    </tr>
                  );
                })}
                <tr className="bol-grand-total-row">
                  <td colSpan={4}>Grand Total</td>
                  <td className="amount-cell">{totalWeight} lbs</td>
                  <td colSpan={4}></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="bol-footer-grid">
            <div>
              Where the rate is dependent on value, shippers are required to state specifically in writing
              the agreed or declared value of the property as follows: "The agreed or declared value of the
              property is specifically stated by the shipper to be not exceeding _______ per _______."
            </div>
            <div>
              <div className="bol-field-row">
                <span className="bol-field-label">COD Amount:</span>
                <span className="bol-field-value">{codAmount ? `$${codAmount}` : "—"}</span>
              </div>
              <div className="bol-freight-terms-row">
                <span>Fee Terms:</span>
                <span>
                  <span className="bol-checkbox-box">{codFeeTerm === "Collect" ? "X" : ""}</span> Collect
                </span>
                <span>
                  <span className="bol-checkbox-box">{codFeeTerm === "Prepaid" ? "X" : ""}</span> Prepaid
                </span>
              </div>
              <div className="bol-checkbox-row">
                <span className="bol-checkbox-box">{codCustomerCheckOk ? "X" : ""}</span>
                <span>Customer check acceptable</span>
              </div>
            </div>
          </div>

          <div className="bol-liability-note">
            <strong>NOTE</strong> Liability Limitation for loss or damage in this shipment may be applicable.
            See 49 U.S.C. &sect; 14706(c)(1)(A) and (B). RECEIVED, subject to individually determined rates or
            contracts that have been agreed upon in writing between the carrier and shipper, if applicable,
            otherwise to the rates, classifications and rules that have been established by the carrier and
            are available to the shipper, on request, and to all applicable state and federal regulations. The
            carrier shall not make delivery of this shipment without payment of freight and all other lawful
            charges.
          </div>

          <div className="bol-signature-grid">
            <div>
              <strong>Shipper Signature / Date</strong>
              <p className="bol-signature-caption">
                This is to certify that the above named materials are properly classified, packaged, marked
                and labeled, and are in proper condition for transportation according to the applicable
                regulations of the DOT.
              </p>
              <div className="bol-signature-blank"></div>
            </div>
            <div>
              <strong>Trailer Loaded:</strong>
              <div className="bol-checkbox-row">
                <span className="bol-checkbox-box">{trailerLoadedBy === "Shipper" ? "X" : ""}</span>
                <span>By Shipper</span>
              </div>
              <div className="bol-checkbox-row">
                <span className="bol-checkbox-box">{trailerLoadedBy === "Driver" ? "X" : ""}</span>
                <span>By Driver</span>
              </div>
            </div>
            <div>
              <strong>Freight Counted:</strong>
              <div className="bol-checkbox-row">
                <span className="bol-checkbox-box">{freightCountedBy === "Shipper" ? "X" : ""}</span>
                <span>By Shipper</span>
              </div>
              <div className="bol-checkbox-row">
                <span className="bol-checkbox-box">{freightCountedBy === "DriverPallets" ? "X" : ""}</span>
                <span>By Driver/pallets said to contain</span>
              </div>
              <div className="bol-checkbox-row">
                <span className="bol-checkbox-box">{freightCountedBy === "DriverPieces" ? "X" : ""}</span>
                <span>By Driver/Pieces</span>
              </div>
            </div>
            <div>
              <strong>Carrier Signature / Pickup Date</strong>
              <p className="bol-signature-caption">
                Carrier acknowledges receipt of packages and required placards. Carrier certifies emergency
                response information was made available and/or carrier has the DOT emergency response
                guidebook or equivalent documentation in the vehicle. Property described above is received
                in good order, except as noted.
              </p>
              <div className="bol-signature-blank"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
