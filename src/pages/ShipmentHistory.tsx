import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Pager from "../components/Pager";
import { isConflictError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { toCsvTable } from "../lib/csv";
import { getOrder, undoShipment } from "../lib/orderStore";
import { listShipments, type ShipmentRow, type ShipmentTotals } from "../lib/shipmentStore";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { usePageForFilters } from "../lib/usePagedOrders";

const today = () => new Date().toISOString().slice(0, 10);

// One row per shipment, newest first, filtered by ship date (today by
// default) - the end-of-day shipped report Logistics used to assemble by
// hand, with partial shipments included (R4-20). Undo is offered on an
// order's most recent shipment only.
export default function ShipmentHistory() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const filterKey = `${from}|${to}|${debouncedQuery}|${pageSize}`;
  const [page, setPage] = usePageForFilters(filterKey);

  const requestKey = `${filterKey}|${page}`;
  const [result, setResult] = useState<{ key: string; rows: ShipmentRow[]; total: number; totals: ShipmentTotals; error?: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listShipments({ from, to, q: debouncedQuery, page, pageSize })
      .then((r) => !cancelled && setResult({ key: requestKey, ...r }))
      .catch(() => !cancelled && setResult({ key: requestKey, rows: [], total: 0, totals: { shipments: 0, units: 0, amount: "0.00", complete: true }, error: "Couldn't load shipments." }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, reloadTick]);

  const current = result?.key === requestKey ? result : null;
  const loading = current === null;
  const rows = current?.rows ?? [];
  const totals = current?.totals;

  const pageUnits = rows.reduce((sum, r) => sum + r.units, 0);

  function setRange(days: number) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
  }

  async function handleUndo(row: ShipmentRow) {
    const summary = row.lines.map((l) => `${l.item} × ${l.qty}`).join(", ");
    if (
      !confirm(
        `Undo this shipment on S.O. #${row.soNumber}? This restores the shipped quantities (${summary}) to on-hand inventory, voids its invoice and moves the order back to Open Picks.`
      )
    ) {
      return;
    }
    try {
      const order = await getOrder(String(row.soNumber));
      if (!order) throw new Error("Order not found");
      await undoShipment(order);
    } catch (err) {
      if (isConflictError(err)) {
        alert(err.message);
        setReloadTick((t) => t + 1);
        return;
      }
      throw err;
    }
    setReloadTick((t) => t + 1);
  }

  function exportCsv() {
    const headers = ["Shipped", "S.O. #", "P.O. #", "Customer", "Ship To", "Lines", "Units", "Invoice", "Invoice Total"];
    const body = rows.map((r) => [
      new Date(r.shippedAt).toLocaleString(),
      String(r.soNumber),
      r.poNumber,
      r.customer,
      `${r.shipTo.city}, ${r.shipTo.state}`,
      r.lines.map((l) => `${l.item} x ${l.qty}`).join("; "),
      String(r.units),
      r.invoiceNumber ?? (r.invoiceId ? "Draft" : ""),
      r.invoiceTotal ?? "",
    ]);
    const blob = new Blob(["﻿" + toCsvTable(headers, body)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shipments-${from}${to !== from ? `-to-${to}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Shipment History</h1>
        <p className="muted">Every shipment, including partial ones, newest first. Today by default.</p>
      </div>

      <div className="toolbar" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
        <label className="form-field" style={{ margin: 0 }}>
          From
          <input id="shipments-from" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="form-field" style={{ margin: 0 }}>
          To
          <input id="shipments-to" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <div className="inline-actions">
          <button type="button" className="secondary-btn" onClick={() => setRange(0)}>
            Today
          </button>
          <button type="button" className="secondary-btn" onClick={() => setRange(7)}>
            7 days
          </button>
          <button type="button" className="secondary-btn" onClick={() => setRange(30)}>
            30 days
          </button>
        </div>
        <input
          id="shipments-search"
          className="search-input"
          placeholder="Search by S.O. #, P.O. #, or customer..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="secondary-btn" onClick={exportCsv} disabled={rows.length === 0}>
          Export CSV
        </button>
      </div>

      {totals && (
        <p className="muted">
          <b>{totals.shipments.toLocaleString()}</b> shipment{totals.shipments === 1 ? "" : "s"} · <b>{totals.units.toLocaleString()}</b> units ·{" "}
          <b>${Number(totals.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> invoiced
          {!totals.complete && " (totals cover the most recent 5,000 shipments in this range)"}
        </p>
      )}

      {current?.error ? (
        <p className="login-error">{current.error}</p>
      ) : rows.length === 0 ? (
        <p className="muted">{loading ? "Loading..." : debouncedQuery ? "No shipments match your search." : "Nothing shipped in this range."}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Shipped</th>
              <th>S.O. #</th>
              <th>P.O. #</th>
              <th>Customer</th>
              <th>Ship To</th>
              <th>Lines</th>
              <th className="amount-cell">Units</th>
              <th>Invoice</th>
              <th className="amount-cell">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable-row" onClick={() => navigate(`/storage/${r.soNumber}`)}>
                <td>{new Date(r.shippedAt).toLocaleString()}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <Link to={`/storage/${r.soNumber}`} className="row-action-outline">
                    {r.soNumber}
                  </Link>
                  {r.orderStatus !== "SHIPPED" && <span className="muted"> partial</span>}
                </td>
                <td>{r.poNumber}</td>
                <td>{r.customer}</td>
                <td>
                  {r.shipTo.city}, {r.shipTo.state}
                </td>
                <td>{r.lines.map((l) => `${l.item} × ${l.qty}`).join(", ")}</td>
                <td className="amount-cell">{r.units.toLocaleString()}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {r.invoiceId ? (
                    <Link to={`/invoices/${encodeURIComponent(r.invoiceNumber ?? r.invoiceId)}`} className={r.invoiceStatus === "VOID" ? "muted" : undefined}>
                      {r.invoiceNumber ?? "Draft"}
                      {r.invoiceStatus === "VOID" ? " (void)" : ""}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="amount-cell">{r.invoiceTotal && r.invoiceStatus !== "VOID" ? `$${Number(r.invoiceTotal).toFixed(2)}` : "—"}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {canEdit && r.isLatest && (
                    <button type="button" className="row-action-outline danger-link" onClick={() => handleUndo(r)}>
                      Undo
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className="muted">
                This page: {rows.length} shipment{rows.length === 1 ? "" : "s"}
              </td>
              <td className="amount-cell">{pageUnits.toLocaleString()}</td>
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      )}

      <Pager page={page} pageSize={pageSize} total={current?.total ?? 0} loading={loading} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}
