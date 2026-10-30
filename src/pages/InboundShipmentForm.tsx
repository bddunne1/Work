import { useEffect, useMemo, useRef, useState } from "react";
import BackLink from "../components/BackLink";
import { Link, useNavigate, useParams } from "react-router-dom";
import SearchSelect from "../components/SearchSelect";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { moveOnEnter } from "../lib/formKeys";
import {
  createInboundShipment,
  deleteInboundShipment,
  getInboundShipment,
  setInboundStatus,
  updateInboundShipment,
  type InboundShipmentInput,
} from "../lib/inboundShipmentStore";
import { showToast } from "../lib/toast";
import { listOpenVendorPos } from "../lib/vendorPoStore";
import { listVendors } from "../lib/vendorStore";
import type { InboundShipment, InboundStatus, Vendor, VendorPurchaseOrder } from "../types";
import { INBOUND_STATUSES, inboundStatusSlug, vendorPoLineOutstanding } from "../types";

// Create or edit one inbound shipment: pick the vendor, then the open PO
// lines (with their outstanding quantity) it carries, and how many of each
// are on board. Status moves from the buttons on an existing shipment.
export default function InboundShipmentForm() {
  const { id } = useParams<{ id: string }>();
  return <InboundShipmentFormInner key={id ?? "new"} />;
}

function InboundShipmentFormInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const isNew = !id;
  const [shipment, setShipment] = useState<InboundShipment | undefined>(undefined);
  const [loading, setLoading] = useState(!isNew);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [openPos, setOpenPos] = useState<VendorPurchaseOrder[] | null>(null);

  const [vendorQuery, setVendorQuery] = useState("");
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [carrier, setCarrier] = useState("");
  const [etd, setEtd] = useState("");
  const [eta, setEta] = useState("");
  const [notes, setNotes] = useState("");
  // PO line id -> quantity on this shipment.
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const submitKey = useRef(crypto.randomUUID());

  useEffect(() => {
    listVendors().then(setVendors);
    listOpenVendorPos().then(setOpenPos);
  }, []);

  useEffect(() => {
    if (!id) return;
    getInboundShipment(id).then((s) => {
      setShipment(s);
      setLoading(false);
      if (!s) return;
      setVendorId(s.vendorId);
      setVendorQuery(s.vendorName ?? "");
      setReference(s.reference);
      setCarrier(s.carrier);
      setEtd(s.etd ?? "");
      setEta(s.eta ?? "");
      setNotes(s.notes);
      setQtys(Object.fromEntries(s.lines.map((l) => [l.vendorPoLineId, l.qty])));
    });
  }, [id]);

  // The vendor's open POs, each line with what is still outstanding. Lines
  // already on this shipment stay listed even if their PO has since closed.
  const candidatePos = useMemo(() => {
    if (!openPos) return [];
    return openPos.filter((p) => !vendorId || p.vendorId === vendorId);
  }, [openPos, vendorId]);
  const knownLineIds = new Set(candidatePos.flatMap((p) => p.lines.map((l) => l.id)));
  const orphanLines = (shipment?.lines ?? []).filter((l) => !knownLineIds.has(l.vendorPoLineId));

  function selectVendor(nextId: string) {
    const v = vendors.find((x) => x.id === nextId);
    if (!v) return;
    setVendorId(v.id);
    setVendorQuery(v.name);
    // Lines from another vendor's POs can't ride this shipment.
    setQtys((q) => Object.fromEntries(Object.entries(q).filter(([lineId]) => candidatePosFor(v.id).some((p) => p.lines.some((l) => l.id === lineId)))));
  }
  function candidatePosFor(vid: string) {
    return (openPos ?? []).filter((p) => p.vendorId === vid);
  }

  function setQty(lineId: string, value: number) {
    setQtys((q) => {
      const next = { ...q };
      if (value > 0) next[lineId] = Math.floor(value);
      else delete next[lineId];
      return next;
    });
  }

  const lines = Object.entries(qtys)
    .filter(([, qty]) => qty > 0)
    .map(([vendorPoLineId, qty]) => ({ vendorPoLineId, qty }));
  const canSave = canEdit && reference.trim().length > 0 && lines.length > 0 && !submitting;

  function input(): InboundShipmentInput {
    return { reference: reference.trim(), carrier: carrier.trim(), vendorId, etd: etd || null, eta: eta || null, notes, lines };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSubmitting(true);
    try {
      if (isNew) {
        const saved = await createInboundShipment(input(), submitKey.current);
        navigate(`/inbound-shipments/${saved.id}`, { replace: true });
      } else if (shipment) {
        setShipment(await updateInboundShipment(shipment.id, shipment.version, input()));
        showToast(`Inbound shipment ${reference.trim()} saved.`);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
      if (isConflictError(err) && shipment) setShipment(await getInboundShipment(shipment.id));
    } finally {
      setSubmitting(false);
    }
  }

  async function moveTo(status: InboundStatus) {
    if (!shipment) return;
    if (status === "Cancelled" && !confirm(`Cancel inbound shipment ${shipment.reference}? Its lines stay on their purchase orders.`)) return;
    try {
      setShipment(await setInboundStatus(shipment, status));
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
      if (isConflictError(err)) setShipment(await getInboundShipment(shipment.id));
    }
  }

  async function handleDelete() {
    if (!shipment) return;
    if (!confirm(`Delete inbound shipment ${shipment.reference}? This removes the record; nothing changes on the purchase orders.`)) return;
    await deleteInboundShipment(shipment.id);
    navigate("/inbound-shipments");
  }

  if (loading) return <div className="page" />;
  if (!isNew && !shipment) {
    return (
      <div className="page">
        <p>Inbound shipment not found.</p>
        <BackLink fallback="/inbound-shipments" label="Inbound Shipments" />
      </div>
    );
  }

  const nextStatuses: InboundStatus[] = shipment
    ? INBOUND_STATUSES.filter((s) => s !== shipment.status && (shipment.status !== "Received" || s === "Arrived"))
    : [];

  return (
    <div className="page">
      <div className="page-header">
        <BackLink fallback="/inbound-shipments" label="Inbound Shipments" />
        <h1>{isNew ? "New Inbound Shipment" : `Inbound ${shipment!.reference}`}</h1>
        {shipment ? (
          <div className="review-meta">
            <span className={`status-pill inbound-pill inbound-pill-${inboundStatusSlug(shipment.status)}`}>{shipment.status}</span>
            {shipment.arrivedAt && <span className="muted">arrived {new Date(shipment.arrivedAt).toLocaleDateString()}</span>}
            <span className="muted">{shipment.units.toLocaleString()} units</span>
          </div>
        ) : (
          <p className="muted">A container, truckload or parcel on its way. Pick the vendor, then the PO lines it carries and how many of each are on board.</p>
        )}
      </div>

      {shipment && canEdit && (
        <div className="button-row inbound-status-row">
          <span className="muted">Move to:</span>
          {nextStatuses.map((s) => (
            <button key={s} type="button" className={`secondary-btn${s === "Cancelled" ? " danger-btn" : ""}`} onClick={() => moveTo(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form className="sales-order" onSubmit={handleSubmit} onKeyDown={moveOnEnter}>
        <div className="customer-picker">
          <label htmlFor="inbound-vendor-search">Vendor</label>
          <SearchSelect
            id="inbound-vendor-search"
            options={vendors.map((v) => ({ id: v.id, label: v.name, sublabel: v.contactName }))}
            value={vendorQuery}
            onQueryChange={setVendorQuery}
            onSelect={selectVendor}
            placeholder="Search vendors..."
          />
        </div>

        <table className="meta-table order-details-table">
          <thead>
            <tr>
              <th>Reference (container # / tracking / BOL)</th>
              <th>Carrier</th>
              <th>ETD</th>
              <th>ETA</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input value={reference} onChange={(e) => setReference(e.target.value)} required maxLength={100} readOnly={!canEdit} />
              </td>
              <td>
                <input value={carrier} onChange={(e) => setCarrier(e.target.value)} maxLength={100} readOnly={!canEdit} />
              </td>
              <td>
                <input type="date" value={etd} onChange={(e) => setEtd(e.target.value)} readOnly={!canEdit} />
              </td>
              <td>
                <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} readOnly={!canEdit} />
              </td>
            </tr>
          </tbody>
        </table>

        <div className="ship-locations-header">
          <h3>Purchase order lines on board</h3>
          <span className="muted">
            {openPos === null ? "Loading open purchase orders…" : vendorId ? `${candidatePos.length} open PO${candidatePos.length === 1 ? "" : "s"} for this vendor` : "Pick a vendor to see its open purchase orders"}
          </span>
        </div>
        {vendorId && openPos !== null && candidatePos.length === 0 && orphanLines.length === 0 && <p className="muted">This vendor has no open purchase orders.</p>}
        {(candidatePos.length > 0 || orphanLines.length > 0) && (
          <div className="scroll-window">
            <table className="data-table line-item-table">
              <thead>
                <tr>
                  <th>PO #</th>
                  <th className="col-item">Item #</th>
                  <th className="col-desc">Description</th>
                  <th className="col-qty">Ordered</th>
                  <th className="col-qty">Received</th>
                  <th className="col-qty">Outstanding</th>
                  <th className="col-qty">On this shipment</th>
                </tr>
              </thead>
              <tbody>
                {candidatePos.flatMap((p) =>
                  p.lines.map((l) => {
                    const outstanding = vendorPoLineOutstanding(l);
                    const qty = qtys[l.id] ?? 0;
                    if (outstanding === 0 && qty === 0) return null;
                    return (
                      <tr key={l.id} className={qty > 0 ? "inbound-line-on" : undefined}>
                        <td>
                          <Link to={`/purchase-orders/${p.poNumber}`}>{p.poNumber}</Link>
                          {p.expectedDate && <span className="muted"> · exp. {p.expectedDate}</span>}
                        </td>
                        <td>{l.itemNumber}</td>
                        <td>{l.description}</td>
                        <td className="amount-cell">{l.orderedQty}</td>
                        <td className="amount-cell">{l.receivedQty}</td>
                        <td className="amount-cell">{outstanding}</td>
                        <td>
                          <input
                            type="number"
                            className={`num-input${qty > outstanding ? " over-available" : ""}`}
                            min={0}
                            step={1}
                            value={qty}
                            readOnly={!canEdit}
                            onChange={(e) => setQty(l.id, Number(e.target.value) || 0)}
                            aria-label={`${l.itemNumber} on ${p.poNumber}: quantity on this shipment`}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
                {orphanLines.map((l) => (
                  <tr key={l.vendorPoLineId} className="inbound-line-on">
                    <td>
                      {l.poNumber ? <Link to={`/purchase-orders/${l.poNumber}`}>{l.poNumber}</Link> : "—"}
                      <span className="muted"> · closed</span>
                    </td>
                    <td>{l.itemNumber}</td>
                    <td>{l.description}</td>
                    <td className="amount-cell">{l.orderedQty}</td>
                    <td className="amount-cell">{l.receivedQty}</td>
                    <td className="amount-cell">{Math.max(0, (l.orderedQty ?? 0) - (l.receivedQty ?? 0))}</td>
                    <td>
                      <input type="number" className="num-input" min={0} step={1} value={qtys[l.vendorPoLineId] ?? 0} readOnly={!canEdit} onChange={(e) => setQty(l.vendorPoLineId, Number(e.target.value) || 0)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <label className="form-field">
          Notes
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} readOnly={!canEdit} />
        </label>

        {canEdit && (
          <div className="button-row">
            <button type="submit" className="primary-btn" disabled={!canSave}>
              {isNew ? "Save Inbound Shipment" : "Save Changes"}
            </button>
            {shipment && (
              <button type="button" className="secondary-btn danger-btn" onClick={handleDelete}>
                Delete
              </button>
            )}
            <span className="muted">
              {lines.length} line{lines.length === 1 ? "" : "s"} · {lines.reduce((sum, l) => sum + l.qty, 0).toLocaleString()} units
            </span>
          </div>
        )}
      </form>
    </div>
  );
}
