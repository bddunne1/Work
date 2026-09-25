import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import BatchPrintDocs from "../components/BatchPrintDocs";
import WarehouseCapacityBanner from "../components/WarehouseCapacityBanner";
import { isConflictError } from "../lib/apiClient";
import { useAuth, useCanEdit } from "../lib/authContext";
import { listItems } from "../lib/itemStore";
import { canEdit as canEditPath } from "../lib/permissions";
import { listOpenOrders, releaseOrders, updateOrder } from "../lib/orderStore";
import type { PurchaseOrder } from "../types";
import { allocatedQtyFor, canUnallocate, pendingShipmentWeight, remainingToShip, unallocateOrder, weightIndex } from "../types";

// Release Orders: allocated orders become pick lists and packing slips for
// the warehouse. One tab per step, each owned by one role:
//   ready  - analysts pick which allocated orders go (and how much), in bulk
//   print  - order entry prints pick lists / packing slips for released orders
//   floor  - read-only: printed and on the warehouse floor, waiting to ship
type Tab = "ready" | "print" | "floor";
type ShipFilter = "all" | "due" | "tomorrow" | "later";

function isFullyPrinted(o: PurchaseOrder): boolean {
  return Boolean(o.pickListPrintedAt && o.packingSlipPrintedAt);
}

function readyToRelease(orders: PurchaseOrder[]): PurchaseOrder[] {
  // An order allocated at zero units (see AllocationDecision's zero-qty
  // guard) has nothing to pick and would stall here forever - exclude it
  // as a safety net even if it somehow reached this status another way.
  return orders.filter(
    (o) => o.status === "Allocated" && o.lineItems.some((li) => allocatedQtyFor(o, li.id) > 0)
  );
}

function releasedToPrint(orders: PurchaseOrder[]): PurchaseOrder[] {
  return orders.filter(
    (o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0 && !isFullyPrinted(o)
  );
}

function onTheFloor(orders: PurchaseOrder[]): PurchaseOrder[] {
  return orders.filter(
    (o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0 && isFullyPrinted(o)
  );
}

function isoDay(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

function shipBy(o: PurchaseOrder): string {
  return o.estimatedShipDate ?? o.dueDate;
}

function ShipByChip({ date, today, tomorrow }: { date: string; today: string; tomorrow: string }) {
  if (date < today) return <span className="release-chip release-chip-late">Late · {date.slice(5)}</span>;
  if (date === today) return <span className="release-chip release-chip-today">Today</span>;
  if (date === tomorrow) return <span className="release-chip release-chip-tomorrow">Tomorrow</span>;
  return (
    <span className="release-chip">
      {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
    </span>
  );
}

function shipTo(o: PurchaseOrder): string {
  return [o.shipTo.city, o.shipTo.state].filter(Boolean).join(", ");
}

function sinceLabel(iso: string | undefined, now: number): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ${mins % 60} min`;
  return `${Math.floor(mins / (24 * 60))} d`;
}

const nf = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function PickPack() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const { account } = useAuth();
  // Releasing is its own permission - order entry prints released orders
  // here but can't release or unallocate them.
  const canRelease = Boolean(account && canEditPath("/pick-pack/review", account));
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: Tab =
    tabParam === "ready" || tabParam === "print" || tabParam === "floor"
      ? tabParam
      : canRelease || !canEdit
        ? "ready"
        : "print";

  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [weights, setWeights] = useState<Map<string, number>>(new Map());
  const [shipFilter, setShipFilter] = useState<ShipFilter>("all");
  const [carrier, setCarrier] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; details?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  // Ready tab
  const [releaseSel, setReleaseSel] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  // Per-order, per-line release quantities the analyst changed from the
  // allocated amount. Anything not here releases what's allocated.
  const [qtyEdits, setQtyEdits] = useState<Record<string, Record<string, number>>>({});

  // Print tab
  const [printSel, setPrintSel] = useState<Record<string, boolean>>({});
  const [includePick, setIncludePick] = useState(true);
  const [includeSlip, setIncludeSlip] = useState(true);
  const [printing, setPrinting] = useState(false);

  // When the lists were last loaded - drives "today", "tomorrow" and time on
  // the floor, so they stay consistent with the data on screen.
  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  function reload() {
    return listOpenOrders().then((os) => {
      setOrders(os);
      setLoadedAt(Date.now());
    });
  }

  useEffect(() => {
    reload();
    listItems().then((items) => setWeights(weightIndex(items)));
  }, []);

  const today = isoDay(new Date(loadedAt));
  const tomorrow = isoDay(new Date(loadedAt + 86_400_000));

  const all = useMemo(() => orders ?? [], [orders]);
  const lists = useMemo(
    () => ({ ready: readyToRelease(all), print: releasedToPrint(all), floor: onTheFloor(all) }),
    [all]
  );
  const carriers = useMemo(
    () =>
      [...new Set([...lists.ready, ...lists.print, ...lists.floor].map((o) => o.shipVia).filter(Boolean))].sort(),
    [lists]
  );

  const q = search.trim().toLowerCase();
  function matches(o: PurchaseOrder): boolean {
    const d = shipBy(o);
    if (shipFilter === "due" && d > today) return false;
    if (shipFilter === "tomorrow" && d !== tomorrow) return false;
    if (shipFilter === "later" && d <= tomorrow) return false;
    if (carrier && o.shipVia !== carrier) return false;
    if (q && ![o.soNumber, o.poNumber, o.billTo.name].some((v) => (v ?? "").toLowerCase().includes(q))) return false;
    return true;
  }
  const bySoonest = (a: PurchaseOrder, b: PurchaseOrder) =>
    shipBy(a).localeCompare(shipBy(b)) || Number(a.soNumber) - Number(b.soNumber);
  const visible = lists[tab].filter(matches).sort(bySoonest);
  const dueCount = lists[tab].filter((o) => shipBy(o) <= today).length;

  function setTab(next: Tab) {
    setParams((p) => {
      p.set("tab", next);
      return p;
    }, { replace: true });
    setExpanded(null);
  }

  // ---- Ready to release ------------------------------------------------------

  function releaseQty(o: PurchaseOrder, lineId: string): number {
    return qtyEdits[o.soNumber]?.[lineId] ?? allocatedQtyFor(o, lineId);
  }

  function releaseTotals(o: PurchaseOrder) {
    let lines = 0;
    let units = 0;
    let weight = 0;
    for (const li of o.lineItems) {
      const qty = releaseQty(o, li.id);
      if (qty <= 0) continue;
      lines += 1;
      units += qty;
      weight += qty * (weights.get(li.item.trim().toLowerCase()) ?? 0);
    }
    return { lines, units, weight };
  }

  function setLineQty(o: PurchaseOrder, lineId: string, value: number) {
    const max = allocatedQtyFor(o, lineId);
    const qty = Math.max(0, Math.min(Number.isFinite(value) ? Math.floor(value) : 0, max));
    setQtyEdits((e) => ({ ...e, [o.soNumber]: { ...e[o.soNumber], [lineId]: qty } }));
    // Adjusting an order's lines means you're about to release it.
    setReleaseSel((s) => ({ ...s, [o.soNumber]: true }));
  }

  function resetLines(o: PurchaseOrder) {
    setQtyEdits((e) => {
      const next = { ...e };
      delete next[o.soNumber];
      return next;
    });
  }

  const selectedReady = lists.ready.filter((o) => releaseSel[o.soNumber]);
  const readyTotals = selectedReady.reduce(
    (t, o) => {
      const r = releaseTotals(o);
      return { lines: t.lines + r.lines, units: t.units + r.units, weight: t.weight + r.weight };
    },
    { lines: 0, units: 0, weight: 0 }
  );
  const nothingToRelease = selectedReady.filter((o) => releaseTotals(o).units === 0);

  async function handleRelease() {
    if (!canRelease || selectedReady.length === 0 || busy) return;
    if (nothingToRelease.length > 0) {
      setMessage({
        kind: "error",
        text: `S.O. ${nothingToRelease.map((o) => o.soNumber).join(", ")} ${nothingToRelease.length === 1 ? "has" : "have"} every line set to 0. Set a quantity, or untick ${nothingToRelease.length === 1 ? "it" : "them"}.`,
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await releaseOrders(
        selectedReady.map((o) => ({
          order: o,
          lines: qtyEdits[o.soNumber]
            ? o.lineItems.map((li) => ({ lineItemId: li.id, qty: releaseQty(o, li.id) }))
            : undefined,
        }))
      );
      const released = res.results.filter((r) => r.ok).map((r) => r.soNumber);
      const failed = res.results.filter((r) => !r.ok);
      setReleaseSel((s) => {
        const next = { ...s };
        for (const so of released) delete next[so];
        return next;
      });
      setQtyEdits((e) => {
        const next = { ...e };
        for (const so of released) delete next[so];
        return next;
      });
      setExpanded(null);
      if (failed.length === 0) {
        setMessage({
          kind: "ok",
          text: `Released ${released.length} order${released.length === 1 ? "" : "s"}. They're on the Released tab, waiting for their pick lists and packing slips.`,
        });
      } else {
        setMessage({
          kind: "error",
          text: `Released ${released.length} of ${res.results.length}. ${failed.length === 1 ? "This one" : "These"} didn't go:`,
          details: failed.map((f) => f.error ?? `S.O. ${f.soNumber}`),
        });
      }
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Release failed." });
    } finally {
      await reload();
      setBusy(false);
    }
  }

  async function unallocateMany(targets: PurchaseOrder[]) {
    const eligible = targets.filter(canUnallocate);
    if (!canRelease || eligible.length === 0 || busy) return;
    const label = eligible.length === 1 ? `S.O. #${eligible[0].soNumber}` : `${eligible.length} orders`;
    if (
      !confirm(
        `Unallocate ${label}? This frees the reserved stock and sends ${eligible.length === 1 ? "it" : "them"} back to Checked for a fresh allocation decision.`
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const errors: string[] = [];
    for (const o of eligible) {
      try {
        await updateOrder(unallocateOrder(o), o.status);
      } catch (err) {
        errors.push(`S.O. ${o.soNumber}: ${err instanceof Error ? err.message : "couldn't unallocate"}`);
      }
    }
    const done = new Set(eligible.map((o) => o.soNumber));
    setReleaseSel((s) => Object.fromEntries(Object.entries(s).filter(([so]) => !done.has(so))));
    setPrintSel((s) => Object.fromEntries(Object.entries(s).filter(([so]) => !done.has(so))));
    setMessage(
      errors.length
        ? { kind: "error", text: `Unallocated ${eligible.length - errors.length} of ${eligible.length}.`, details: errors }
        : { kind: "ok", text: `Unallocated ${label}. ${eligible.length === 1 ? "It's" : "They're"} back in Allocation as Checked.` }
    );
    await reload();
    setBusy(false);
  }

  function startReviewQueue() {
    const reviewQueue = visible.map((o) => o.soNumber);
    if (reviewQueue.length === 0) return;
    navigate(`/pick-pack/${reviewQueue[0]}`, { state: { queue: reviewQueue, pos: 0 } });
  }

  // ---- Released: print documents --------------------------------------------

  const selectedPrint = lists.print.filter((o) => printSel[o.soNumber]);
  // Printing marks orders printed (a save), so it needs edit on this page.
  const canPrint = canEdit && selectedPrint.length > 0 && (includePick || includeSlip);

  function printBatch() {
    if (!canPrint) return;
    const batch = selectedPrint;
    setPrinting(true);
    setTimeout(async () => {
      window.print();
      setPrinting(false);
      // window.print() gives no way to tell whether the user actually
      // printed or hit Cancel, so ask directly rather than assuming success
      // - otherwise a canceled print still knocked the order out of the
      // queue and onto the floor with nothing actually printed.
      const confirmed = confirm(
        "Did the pick list / packing slip print successfully? Choose OK to mark these orders printed, or Cancel to keep them here and try again."
      );
      if (!confirmed) return;
      const now = new Date().toISOString();
      setBusy(true);
      const errors: string[] = [];
      for (const o of batch) {
        try {
          await updateOrder({
            ...o,
            pickListPrintedAt: includePick ? now : o.pickListPrintedAt,
            packingSlipPrintedAt: includeSlip ? now : o.packingSlipPrintedAt,
          });
        } catch (err) {
          errors.push(
            `S.O. ${o.soNumber}: ${isConflictError(err) ? "changed by someone else - check it and print again" : err instanceof Error ? err.message : "not saved"}`
          );
        }
      }
      setPrintSel({});
      setMessage(
        errors.length
          ? { kind: "error", text: "Some orders weren't marked printed:", details: errors }
          : {
              kind: "ok",
              text: `Marked ${batch.length} order${batch.length === 1 ? "" : "s"} printed. Orders with both documents printed are now on the floor (Open Picks).`,
            }
      );
      await reload();
      setBusy(false);
    }, 50);
  }

  // ---- Shared ---------------------------------------------------------------

  const sel = tab === "ready" ? releaseSel : printSel;
  const setSel = tab === "ready" ? setReleaseSel : setPrintSel;
  const allVisibleSelected = visible.length > 0 && visible.every((o) => sel[o.soNumber]);
  function toggleAllVisible() {
    setSel((s) => {
      const next = { ...s };
      for (const o of visible) next[o.soNumber] = !allVisibleSelected;
      return next;
    });
  }
  const selectable = (tab === "ready" && canRelease) || (tab === "print" && canEdit);

  const TABS: { key: Tab; label: string }[] = [
    { key: "ready", label: "Ready to release" },
    { key: "print", label: "Released · print documents" },
    { key: "floor", label: "On the floor" },
  ];

  const SHIP_FILTERS: { key: ShipFilter; label: string }[] = [
    { key: "all", label: "All dates" },
    { key: "due", label: `Late & today${dueCount ? ` (${dueCount})` : ""}` },
    { key: "tomorrow", label: "Tomorrow" },
    { key: "later", label: "Later" },
  ];

  return (
    <div className="page">
      <div className="page-header no-print">
        <h1>Release Orders</h1>
        <p className="muted">
          Turn allocated orders into physical pick lists and packing slips for the warehouse. Release orders
          from the first tab, print their documents from the second, and follow them on the floor in the third.
        </p>
      </div>

      <div className="no-print">
        <WarehouseCapacityBanner />

        <div className="release-tabs" role="tablist" aria-label="Release stage">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`release-tab${tab === t.key ? " is-active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              <span className="release-tab-count">{orders ? lists[t.key].length : "…"}</span>
            </button>
          ))}
        </div>

        <div className="release-filters">
          {SHIP_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`release-filter${shipFilter === f.key ? " is-on" : ""}`}
              aria-pressed={shipFilter === f.key}
              onClick={() => setShipFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <select
            id="release-carrier"
            className="release-select"
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            aria-label="Carrier"
          >
            <option value="">All carriers</option>
            {carriers.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            id="release-search"
            className="release-search"
            type="search"
            placeholder="Search S.O., P.O. or customer"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {tab === "ready" && canRelease && visible.length > 0 && (
            <button type="button" className="secondary-btn release-review-btn" onClick={startReviewQueue}>
              Review one by one
            </button>
          )}
        </div>

        {message && (
          <div className={`release-message release-message-${message.kind}`} role="status">
            <span>{message.text}</span>
            {message.details && (
              <ul>
                {message.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
            <button type="button" className="link-btn" onClick={() => setMessage(null)}>
              Dismiss
            </button>
          </div>
        )}

        {orders === null ? (
          <p className="muted">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="muted release-empty">
            {lists[tab].length === 0
              ? tab === "ready"
                ? "Nothing allocated and waiting to release."
                : tab === "print"
                  ? "Nothing released and waiting on printing."
                  : "Nothing printed and waiting on the floor."
              : "No orders match these filters."}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="data-table release-table">
              <thead>
                <tr>
                  {selectable && (
                    <th className="release-col-check">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        aria-label="Select all shown"
                      />
                    </th>
                  )}
                  <th>S.O. #</th>
                  <th>Customer</th>
                  <th>Ship to</th>
                  <th>Carrier</th>
                  <th>Ship by</th>
                  <th className="release-num">Lines</th>
                  <th className="release-num">Units</th>
                  <th className="release-num">Weight</th>
                  {tab === "ready" && <th>Allocation</th>}
                  {tab === "print" && <th>Pick list</th>}
                  {tab === "print" && <th>Packing slip</th>}
                  {tab === "floor" && <th>Release</th>}
                  {tab === "floor" && <th className="release-num">On floor</th>}
                  <th aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => {
                  const isOpen = tab === "ready" && expanded === o.soNumber;
                  const totals =
                    tab === "ready"
                      ? releaseTotals(o)
                      : {
                          lines: (o.pendingShipment ?? []).filter((l) => l.qty > 0).length,
                          units: (o.pendingShipment ?? []).reduce((s, l) => s + l.qty, 0),
                          weight: pendingShipmentWeight(o, weights),
                        };
                  const edited = Boolean(qtyEdits[o.soNumber]);
                  const colCount = (selectable ? 1 : 0) + 8 + (tab === "ready" ? 1 : 2) + 1;
                  return (
                    <Fragment key={o.soNumber}>
                      <tr className={sel[o.soNumber] ? "release-row is-selected" : "release-row"}>
                        {selectable && (
                          <td className="release-col-check">
                            <input
                              type="checkbox"
                              checked={Boolean(sel[o.soNumber])}
                              onChange={() => setSel((s) => ({ ...s, [o.soNumber]: !s[o.soNumber] }))}
                              aria-label={`Select S.O. ${o.soNumber}`}
                            />
                          </td>
                        )}
                        <td>
                          <Link to={`/storage/${o.soNumber}`} className="row-action-outline">
                            {o.soNumber}
                          </Link>
                        </td>
                        <td>
                          {o.billTo.name}
                          {o.poNumber && <div className="release-sub">P.O. {o.poNumber}</div>}
                        </td>
                        <td>{shipTo(o) || "—"}</td>
                        <td>{o.shipVia || "—"}</td>
                        <td>
                          <ShipByChip date={shipBy(o)} today={today} tomorrow={tomorrow} />
                        </td>
                        <td className="release-num">{totals.lines}</td>
                        <td className="release-num">{nf(totals.units)}</td>
                        <td className="release-num">{totals.weight > 0 ? `${nf(totals.weight)} lb` : "—"}</td>
                        {tab === "ready" && (
                          <td>
                            {o.allocation?.fullyAllocated ? (
                              <span className="release-chip release-chip-full">Full</span>
                            ) : (
                              <span className="release-chip release-chip-partial">Partial</span>
                            )}
                            {edited && <span className="release-chip release-chip-edited">Qty changed</span>}
                          </td>
                        )}
                        {tab === "print" && (
                          <td>{o.pickListPrintedAt ? <span className="status-pill">Printed</span> : <span className="muted">Not printed</span>}</td>
                        )}
                        {tab === "print" && (
                          <td>{o.packingSlipPrintedAt ? <span className="status-pill">Printed</span> : <span className="muted">Not printed</span>}</td>
                        )}
                        {tab === "floor" && <td>{o.pickPackStatus ?? "—"}</td>}
                        {tab === "floor" && (
                          <td className="release-num">
                            {sinceLabel(
                              [o.pickListPrintedAt, o.packingSlipPrintedAt].filter(Boolean).sort().pop(),
                              loadedAt
                            )}
                          </td>
                        )}
                        <td className="release-actions">
                          {tab === "ready" && (
                            <button
                              type="button"
                              className="row-action-outline"
                              aria-expanded={isOpen}
                              onClick={() => setExpanded(isOpen ? null : o.soNumber)}
                            >
                              {isOpen ? "Hide lines" : "Lines"}
                            </button>
                          )}
                          {tab === "print" && canRelease && canUnallocate(o) && (
                            <button
                              type="button"
                              className="row-action-outline danger-link"
                              onClick={() => unallocateMany([o])}
                            >
                              Unallocate
                            </button>
                          )}
                          {tab === "floor" && (
                            <Link to="/open-picks" className="row-action-outline">
                              Open Picks
                            </Link>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="release-expand">
                          <td colSpan={colCount}>
                            <div className="release-lines">
                              <table className="release-lines-table">
                                <thead>
                                  <tr>
                                    <th>Item</th>
                                    <th>Description</th>
                                    <th className="release-num">Ordered</th>
                                    <th className="release-num">Remaining</th>
                                    <th className="release-num">Allocated</th>
                                    <th className="release-num">Release qty</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {o.lineItems.map((li) => {
                                    const allocated = allocatedQtyFor(o, li.id);
                                    return (
                                      <tr key={li.id} className={allocated === 0 ? "is-unallocated" : undefined}>
                                        <td>{li.item}</td>
                                        <td>{li.description}</td>
                                        <td className="release-num">{li.ordered}</td>
                                        <td className="release-num">{remainingToShip(o, li)}</td>
                                        <td className="release-num">{allocated}</td>
                                        <td className="release-num">
                                          {allocated > 0 ? (
                                            <input
                                              id={`release-qty-${o.soNumber}-${li.id}`}
                                              type="number"
                                              className="num-input release-qty"
                                              min={0}
                                              max={allocated}
                                              value={releaseQty(o, li.id)}
                                              disabled={!canRelease}
                                              aria-label={`Release quantity for ${li.item}`}
                                              onChange={(e) => setLineQty(o, li.id, Number(e.target.value))}
                                            />
                                          ) : (
                                            <span className="muted">not allocated</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <div className="release-lines-foot">
                              <span className="muted">
                                Lower a quantity to release part of a line. To send more than is allocated, open the
                                full review and revise the allocation.
                              </span>
                              <span className="inline-actions">
                                {edited && (
                                  <button type="button" className="link-btn" onClick={() => resetLines(o)}>
                                    Reset to allocated
                                  </button>
                                )}
                                {canRelease && (
                                  <Link to={`/pick-pack/${o.soNumber}`} className="link-btn">
                                    Open full review &rarr;
                                  </Link>
                                )}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === "ready" && canRelease && selectedReady.length > 0 && (
          <div className="release-bar">
            <span className="release-bar-sum">
              <b>{selectedReady.length}</b> selected · <b>{nf(readyTotals.lines)}</b> lines ·{" "}
              <b>{nf(readyTotals.units)}</b> units{readyTotals.weight > 0 && (
                <>
                  {" "}· <b>{nf(readyTotals.weight)}</b> lb
                </>
              )}
            </span>
            <span className="release-bar-actions">
              <button type="button" className="secondary-btn" disabled={busy} onClick={() => setReleaseSel({})}>
                Clear
              </button>
              <button type="button" className="secondary-btn" disabled={busy} onClick={() => unallocateMany(selectedReady)}>
                Unallocate
              </button>
              <button type="button" className="primary-btn" disabled={busy} onClick={handleRelease}>
                {busy ? "Releasing…" : `Release ${selectedReady.length} order${selectedReady.length === 1 ? "" : "s"}`}
              </button>
            </span>
          </div>
        )}

        {tab === "print" && canEdit && lists.print.length > 0 && (
          <div className="release-bar">
            <span className="release-bar-sum">
              <b>{selectedPrint.length}</b> of {lists.print.length} selected
            </span>
            <span className="release-bar-actions">
              <label className="checkbox-line">
                <input type="checkbox" checked={includePick} onChange={(e) => setIncludePick(e.target.checked)} />
                Pick list
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={includeSlip} onChange={(e) => setIncludeSlip(e.target.checked)} />
                Packing slip
              </label>
              <button type="button" className="primary-btn" disabled={!canPrint || busy} onClick={printBatch}>
                Print {selectedPrint.length || ""}
              </button>
            </span>
          </div>
        )}
      </div>

      {printing && <BatchPrintDocs orders={selectedPrint} includePick={includePick} includeSlip={includeSlip} />}
    </div>
  );
}
