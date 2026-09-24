// One compressed business day for 15 concurrent staff, driven through the
// real HTTP API with the same request sequences (and the same client-side
// read-modify-write logic) the React pages use. Every simulated person:
//   - loads the pages they'd actually open (each page's own list fetches),
//   - spends human "think/work" time proportional to the task size,
//   - reacts to errors the way the UI lets them: a 409 shows "changed by
//     someone else", so they reload and redo the action once; a 403/500
//     means they give up on that task and move on.
// At the end an admin-side audit compares the database against an
// independent ledger to find lost/duplicated inventory movements,
// over-allocation and stuck orders.
//
//   SIM_SCENARIO=presets   accounts exactly as the app's presets define them
//   SIM_SCENARIO=workaround warehouse/receiving/validation also granted the
//                          extra server-side permissions they need today
//   SIM_MINUTES=12         real minutes the 8-hour day is compressed into
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  ApiError, get, post, put, patch, makeRng, metrics, event, sleep, today,
  mapOrder, mapItem, mapPo, mapCustomer, remainingToShip, allocatedQtyFor, qtyAllocatedOnOrders,
  confirmShipment, receiveVendorPo, percentile,
} from "./lib.mjs";
import { PERMS } from "./presets.mjs";

const SCENARIO = process.env.SIM_SCENARIO ?? "presets";
// "baseline" mirrors the original frontend's request flows; "fixed" mirrors
// the patched frontend (atomic ship/receive endpoints, open-order lists,
// expectedStatus guards, stale-status pages that refuse to act).
const CLIENT = process.env.SIM_CLIENT ?? "baseline";
const FIXED = CLIENT === "fixed";
const REAL_MINUTES = Number(process.env.SIM_MINUTES ?? 12);
const DAY_MS = REAL_MINUTES * 60_000;
const SIM_MIN = DAY_MS / 480; // real ms per simulated business minute
const ORDERS_TODAY = Number(process.env.SIM_ORDERS ?? 150);
const BACKLOG = Number(process.env.SIM_BACKLOG ?? 60);
const rng = makeRng(Number(process.env.SIM_SEED ?? 7));
const seed = JSON.parse(readFileSync(new URL("./seed-state.json", import.meta.url), "utf8"));
const OUT = process.env.SIM_OUT ?? new URL(`./results-${SCENARIO}-${process.env.SIM_CLIENT ?? "baseline"}.json`, import.meta.url).pathname;

const endAt = () => metrics.startedAt + DAY_MS;
const dayOver = () => Date.now() >= endAt();
// Human time: `mins` simulated minutes, +/-30% jitter.
const work = (mins) => sleep(Math.max(5, mins * SIM_MIN * (0.7 + rng.next() * 0.6)));

// Independent ledger of every inventory movement the app *confirmed* (2xx),
// so the end-of-day audit can tell "the DB is wrong" from "nobody shipped".
const ledger = { qtyPatches: new Map(), shipAttempts: 0, doubleShipRetries: 0, receiveRetries: 0 };
function recordPatch(itemNumber, delta) {
  ledger.qtyPatches.set(itemNumber, (ledger.qtyPatches.get(itemNumber) ?? 0) + delta);
}

// ---------------------------------------------------------------- helpers --
async function login(user) {
  const res = await post(null, "/api/auth/login", { username: user.username, password: user.password });
  user.token = res.token;
  user.account = res.account;
  await get(user, "/api/auth/me");
  await get(user, "/api/settings");
}

// What the Dashboard fetches on mount (Dashboard.tsx:217-219).
async function openDashboard(user) {
  if (FIXED) {
    await Promise.allSettled([get(user, "/api/customers?summary=1"), get(user, "/api/items"), get(user, "/api/sales-orders?open=1"), get(user, "/api/sales-orders?limit=5")]);
    return;
  }
  await Promise.allSettled([get(user, "/api/customers"), get(user, "/api/items"), get(user, "/api/sales-orders")]);
}

// Workflow pages: the fixed client only fetches not-yet-shipped orders.
const listOrders = async (u) => (await get(u, FIXED ? "/api/sales-orders?open=1" : "/api/sales-orders")).map(mapOrder);
const getOrder = async (u, so) => mapOrder(await get(u, `/api/sales-orders/${so}`));
const listItems = async (u) => (await get(u, "/api/items")).map(mapItem);
const updateOrder = (u, o, expectedStatus) => put(u, `/api/sales-orders/${o.soNumber}`, FIXED ? { ...o, expectedStatus } : o);

// orderStore.shipOrder: decrement stock per line, THEN save the order.
async function shipOrder(u, order, lines) {
  if (FIXED) {
    const res = mapOrder(await post(u, `/api/sales-orders/${order.soNumber}/ship`, { version: order.version, lines: lines.filter((l) => l.qty > 0) }));
    for (const l of lines) {
      const li = order.lineItems.find((x) => x.id === l.lineItemId);
      if (li && l.qty > 0) recordPatch(li.item, -l.qty);
    }
    return res;
  }
  const updated = confirmShipment(order, lines);
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const li = order.lineItems.find((x) => x.id === l.lineItemId);
    if (!li) continue;
    await patch(u, `/api/items/by-number/${encodeURIComponent(li.item)}/qty`, { qtyOnHandDelta: -l.qty });
    recordPatch(li.item, -l.qty);
  }
  await updateOrder(u, updated);
  return updated;
}

// vendorPoStore.recomputeQtyOnPurchaseOrder, run per affected item in parallel.
async function recomputeQtyOnPo(u, itemNumber) {
  const items = await listItems(u); // getItemByNumber fetches the whole catalog
  const item = items.find((i) => i.itemNumber.toLowerCase() === itemNumber.toLowerCase());
  if (!item) return;
  const pos = (await get(u, "/api/vendor-purchase-orders")).map(mapPo);
  const outstanding = pos.filter((p) => p.status !== "Closed").reduce((s, p) => s + p.lines.filter((l) => l.itemNumber.toLowerCase() === itemNumber.toLowerCase()).reduce((a, l) => a + Math.max(0, l.orderedQty - l.receivedQty), 0), 0);
  if (item.qtyOnPurchaseOrder !== outstanding) await patch(u, `/api/items/by-number/${encodeURIComponent(itemNumber)}/qty`, { qtyOnPurchaseOrder: outstanding });
}

// vendorPoStore.receivePo: bump stock per line, then save PO, then recompute.
async function receivePo(u, po, lines) {
  if (FIXED) {
    const res = await post(u, `/api/vendor-purchase-orders/${po.poNumber}/receive`, { version: po.version, lines: lines.filter((l) => l.qty > 0) });
    for (const l of lines) {
      const line = po.lines.find((x) => x.id === l.lineId);
      if (line && l.qty > 0) recordPatch(line.itemNumber, l.qty);
    }
    return res;
  }
  const updated = receiveVendorPo(po, lines);
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const line = po.lines.find((x) => x.id === l.lineId);
    if (!line) continue;
    await patch(u, `/api/items/by-number/${encodeURIComponent(line.itemNumber)}/qty`, { qtyOnHandDelta: l.qty });
    recordPatch(line.itemNumber, l.qty);
  }
  await put(u, `/api/vendor-purchase-orders/${po.poNumber}`, updated);
  await Promise.all([...new Set(po.lines.map((l) => l.itemNumber))].map((n) => recomputeQtyOnPo(u, n)));
  return updated;
}

// Picks one of the first few entries of a work list, like a person scanning
// the top of a shared queue - which is exactly how collisions happen.
const pickFromTop = (list, n = 3) => (list.length ? list[Math.floor(rng.next() * Math.min(n, list.length))] : undefined);

// Runs one user action; classifies failures the way a person experiences them.
async function attempt(user, label, fn, { retryOn409 = true } = {}) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && retryOn409) {
      event(user, "conflict-409", { action: label, message: err.message });
      await work(0.5); // reads the alert, reloads
      try {
        return await fn(true);
      } catch (err2) {
        event(user, "gave-up", { action: label, status: err2.status ?? 0, message: err2.message });
        return undefined;
      }
    }
    event(user, err instanceof ApiError && err.status === 403 ? "blocked-403" : err instanceof ApiError && err.status === 409 ? "conflict-409" : "error", { action: label, status: err.status ?? 0, message: err.message });
    return undefined;
  }
}

// -------------------------------------------------------- order generation --
const TOP = seed.customers.filter((c) => c.top);
const REST = seed.customers.filter((c) => !c.top);
const itemPool = seed.items;
const popCdf = (() => {
  let acc = 0;
  return itemPool.map((i) => (acc += i.share));
})();
function pickItem() {
  const r = rng.next() * popCdf[popCdf.length - 1];
  return itemPool[popCdf.findIndex((c) => c >= r)];
}
function orderShape() {
  const r = rng.next();
  if (r < 0.1) return { kind: "large", lines: rng.int(20, 40), qty: () => rng.int(100, 900) };
  if (r < 0.5) return { kind: "medium", lines: rng.int(8, 14), qty: () => rng.int(10, 150) };
  if (rng.chance(0.35)) return { kind: "tiny", lines: rng.int(1, 2), qty: () => rng.int(3, 4) };
  return { kind: "small", lines: rng.int(3, 7), qty: () => rng.int(5, 60) };
}
let customerCache = null;
async function buildOrder(user, customers) {
  const meta = rng.chance(0.8) ? rng.pick(TOP) : rng.pick(REST);
  const c = customers.find((x) => x.id === meta.id);
  const shape = orderShape();
  const chosen = new Map();
  while (chosen.size < shape.lines) {
    const it = pickItem();
    if (!chosen.has(it.itemNumber)) chosen.set(it.itemNumber, it);
  }
  const overrides = new Map((c.priceOverrides ?? []).map((p) => [p.itemNumber, p]));
  const loc = rng.pick(c.shipToLocations);
  return {
    shape,
    body: {
      poNumber: `CPO-${rng.int(100000, 999999)}`,
      orderDate: today(),
      dueDate: new Date(Date.now() + rng.int(2, 14) * 86400000).toISOString().slice(0, 10),
      customerId: c.id,
      shipToLocationId: loc?.id ?? null,
      billTo: c.billTo,
      shipTo: loc?.address ?? c.billTo,
      fob: c.fob, shipVia: c.shipVia, terms: c.terms, rep: c.rep,
      taxRate: 0, notes: "",
      lineItems: [...chosen.values()].map((it) => ({
        id: randomUUID(), item: it.itemNumber, description: "", um: "EA", ordered: shape.qty(),
        rate: overrides.get(it.itemNumber)?.price ?? it.rate,
        customerPartNumber: overrides.get(it.itemNumber)?.customerPartNumber,
      })),
      writtenBy: user.account?.initials, writtenById: user.account?.id, writtenByColor: user.account?.color,
      status: "Entered",
    },
  };
}

// ------------------------------------------------------------------ roles --
let ordersRemaining = ORDERS_TODAY;

async function orderEntry(user) {
  while (!dayOver() && ordersRemaining > 0) {
    ordersRemaining--;
    // OrderEntry.tsx:53 + LineItemsTable.tsx:35
    const [customers] = await Promise.all([
      get(user, "/api/customers").then((cs) => cs.map(mapCustomer)).catch(() => customerCache),
      get(user, "/api/items").catch(() => null),
      get(user, "/api/counters/salesOrder").catch(() => null),
    ]);
    if (!customers) { await work(5); continue; }
    customerCache = customers;
    const { shape, body } = await buildOrder(user, customers);
    await work(2 + body.lineItems.length * 0.6); // keying the PO in
    const saved = await attempt(user, "enter-order", () => post(user, "/api/sales-orders", body), { retryOn409: false });
    if (saved) event(user, "order-entered", { so: saved.soNumber, kind: shape.kind, lines: body.lineItems.length, units: body.lineItems.reduce((s, l) => s + l.ordered, 0) });
    await get(user, "/api/customers").catch(() => {}); // OrderEntry.tsx:120
    if (rng.chance(0.15)) await openDashboard(user);
    // Customer service also maintains customer records between calls.
    if (user.preset === "customer-service" && rng.chance(0.25)) {
      await attempt(user, "edit-customer-note", async () => {
        const c = mapCustomer(await get(user, `/api/customers/${rng.pick(TOP).id}`));
        await work(2);
        c.notes = [{ id: randomUUID(), text: `Call log ${new Date().toISOString()}`, createdAt: new Date().toISOString() }, ...c.notes];
        await put(user, `/api/customers/${c.id}`, c);
      });
    }
    await work(3);
  }
}

async function validator(user) {
  while (!dayOver()) {
    // Validation queue
    const orders = await attempt(user, "open-validation", () => listOrders(user), { retryOn409: false });
    const entered = (orders ?? []).filter((o) => o.status === "Entered").sort((a, b) => Number(a.soNumber) - Number(b.soNumber));
    const target = pickFromTop(entered);
    if (target) {
      await attempt(user, "validate", async (retry) => {
        const [o] = await Promise.all([getOrder(user, target.soNumber), listItems(user)]);
        // The page shows no warning when the order already moved on; on the
        // reload-after-409 path the person re-clicks half the time.
        if (o.status !== "Entered" && (FIXED || !retry || rng.chance(0.5))) return;
        await work(1 + o.lineItems.length * 0.15);
        await updateOrder(user, { ...o, status: "Checked", checkedAt: new Date().toISOString(), checkedBy: user.account.initials, checkedByColor: user.account.color }, "Entered");
        event(user, "order-checked", { so: o.soNumber });
      });
    }
    // Allocation queue (Checked), then back-order queue (Backordered)
    const orders2 = await attempt(user, "open-allocation", () => listOrders(user), { retryOn409: false });
    const checked = (orders2 ?? []).filter((o) => o.status === "Checked").sort((a, b) => Number(a.soNumber) - Number(b.soNumber));
    let allocTarget = pickFromTop(checked);
    if (!allocTarget && rng.chance(0.15)) {
      // Back Order Queue page also loads vendor POs for ETAs (BackOrderQueue.tsx:25)
      await attempt(user, "open-backorder-queue", () => get(user, "/api/vendor-purchase-orders"), { retryOn409: false });
      allocTarget = pickFromTop((orders2 ?? []).filter((o) => o.status === "Backordered"), 5);
    }
    if (allocTarget) await allocate(user, allocTarget.soNumber);
    if (!target && !allocTarget) await work(4);
    else await work(0.5);
  }
}

// AllocationDecision.tsx: page loads items + all orders + the order, the
// person sets each line to what the "Available" column says, then saves.
async function allocate(user, soNumber) {
  await attempt(user, "allocate", async (retry) => {
    const [items, all, o] = await Promise.all([listItems(user), listOrders(user), getOrder(user, soNumber)]);
    if (!["Checked", "Backordered"].includes(o.status) && (FIXED || !retry || rng.chance(0.5))) return;
    if (!["Checked", "Backordered"].includes(o.status)) event(user, "status-regression", { so: o.soNumber, from: o.status, action: "allocate" });
    const cust = o.customerId ? mapCustomer(await get(user, `/api/customers/${o.customerId}`)) : null;
    const byNum = new Map(items.map((i) => [i.itemNumber.toLowerCase(), i]));
    await work(1 + o.lineItems.length * 0.25);
    const qtys = {};
    for (const li of o.lineItems) {
      const it = byNum.get(li.item.toLowerCase());
      const available = it ? it.qtyOnHand - qtyAllocatedOnOrders(li.item, all.filter((x) => x.soNumber !== o.soNumber)) : 0;
      qtys[li.id] = Math.max(0, Math.min(remainingToShip(o, li), available));
    }
    const fully = o.lineItems.every((li) => qtys[li.id] >= remainingToShip(o, li));
    const shipCompleteOnly = cust?.shipCompleteOnly ?? false;
    const total = Object.values(qtys).reduce((a, b) => a + b, 0);
    const hold = (!fully && shipCompleteOnly) || total === 0;
    const status = hold ? "Backordered" : "Allocated";
    await updateOrder(user, {
      ...o, status,
      allocation: { lines: o.lineItems.map((li) => ({ lineItemId: li.id, allocatedQty: hold ? 0 : qtys[li.id] })), fullyAllocated: fully, shipCompleteOnly: fully ? undefined : shipCompleteOnly, decidedAt: new Date().toISOString() },
    }, o.status);
    event(user, "order-allocated", { so: o.soNumber, status, fully });
  });
}

async function warehouse(user) {
  while (!dayOver()) {
    // Pick & Pack page (+ WarehouseCapacityBanner's items+orders fetch)
    const [orders] = await Promise.all([
      attempt(user, "open-pick-pack", () => listOrders(user), { retryOn409: false }),
      attempt(user, "capacity-banner", () => Promise.all([listItems(user), listOrders(user)]), { retryOn409: false }),
    ]);
    const ready = (orders ?? []).filter((o) => o.status === "Allocated" && o.lineItems.some((li) => allocatedQtyFor(o, li.id) > 0)).sort((a, b) => Number(a.soNumber) - Number(b.soNumber));
    const target = pickFromTop(ready);
    let did = false;
    if (target) {
      did = true;
      await attempt(user, "pick-pack", async (retry) => {
        const [, , o] = await Promise.all([listItems(user), listOrders(user), getOrder(user, target.soNumber)]);
        if (o.status !== "Allocated" && (FIXED || !retry || rng.chance(0.5))) return;
        if (o.status !== "Allocated") event(user, "status-regression", { so: o.soNumber, from: o.status, action: "pick-pack" });
        const units = o.lineItems.reduce((s, li) => s + allocatedQtyFor(o, li.id), 0);
        await work(2 + o.lineItems.length * 0.4 + Math.min(20, units / 400));
        const qtys = Object.fromEntries(o.lineItems.map((li) => [li.id, allocatedQtyFor(o, li.id)]));
        const pendingShipment = o.lineItems.filter((li) => qtys[li.id] > 0).map((li) => ({ lineItemId: li.id, qty: qtys[li.id] }));
        const pickPackStatus = o.lineItems.every((li) => remainingToShip(o, li) - qtys[li.id] <= 0) ? "Complete" : "Partial";
        await updateOrder(user, {
          ...o, status: "Pick & Packed", pickPackStatus, pickedAt: new Date().toISOString(), pendingShipment,
          pickListPrintedAt: undefined, packingSlipPrintedAt: undefined,
          allocation: o.allocation ? { ...o.allocation, lines: o.lineItems.map((li) => ({ lineItemId: li.id, allocatedQty: qtys[li.id] > 0 ? 0 : allocatedQtyFor(o, li.id) })) } : o.allocation,
        }, "Allocated");
        event(user, "order-packed", { so: o.soNumber, units });
      });
    }
    // Batch-print released picks (PickPack.tsx printBatch): one PUT per order
    // using the list loaded when the page opened.
    if (rng.chance(0.5)) {
      const list = await attempt(user, "open-pick-pack", () => listOrders(user), { retryOn409: false });
      const released = (list ?? []).filter((o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0 && !(o.pickListPrintedAt && o.packingSlipPrintedAt));
      if (released.length) {
        did = true;
        await work(1.5); // printer
        const now = new Date().toISOString();
        await attempt(user, "batch-print", async (retry) => {
          const src = retry ? (await listOrders(user)).filter((o) => released.some((r) => r.soNumber === o.soNumber)) : released;
          for (const o of src) await updateOrder(user, { ...o, pickListPrintedAt: now, packingSlipPrintedAt: now });
          event(user, "batch-printed", { count: src.length });
        });
      }
    }
    // Open Picks: confirm what actually shipped. Half the time from the list
    // (bulk confirm with the list's snapshot), half from the detail page.
    if (rng.chance(0.6)) {
      const [, list] = await Promise.all([
        attempt(user, "open-picks-items", () => listItems(user), { retryOn409: false }),
        attempt(user, "open-picks", () => listOrders(user), { retryOn409: false }),
      ]);
      const staged = (list ?? []).filter((o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0 && o.pickListPrintedAt && o.packingSlipPrintedAt).sort((a, b) => Number(a.soNumber) - Number(b.soNumber));
      if (staged.length) {
        did = true;
        if (rng.chance(0.5)) {
          const selected = staged.slice(0, rng.int(1, Math.min(4, staged.length)));
          await work(1 + selected.length);
          // OpenPicks.confirmSelected: on a 409 it alerts and stops; the
          // person then reloads and confirms whatever is still listed.
          await attempt(user, "ship-bulk", async (retry) => {
            const src = retry ? (await listOrders(user)).filter((o) => selected.some((s) => s.soNumber === o.soNumber) && o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0) : selected;
            if (retry) ledger.doubleShipRetries++;
            for (const o of src) {
              ledger.shipAttempts++;
              await shipOrder(user, o, o.pendingShipment ?? []);
              event(user, "order-shipped", { so: o.soNumber, via: "bulk" });
            }
          });
        } else {
          const t = pickFromTop(staged);
          await attempt(user, "ship-detail", async (retry) => {
            const o = await getOrder(user, t.soNumber);
            if (o.status !== "Pick & Packed" || !(o.pendingShipment?.length)) return;
            if (retry) ledger.doubleShipRetries++;
            await work(1 + o.pendingShipment.length * 0.2);
            // ~5% of lines come back short on the physical pick
            const lines = o.pendingShipment.map((l) => ({ lineItemId: l.lineItemId, qty: rng.chance(0.05) ? Math.floor(l.qty * 0.9) : l.qty }));
            ledger.shipAttempts++;
            await shipOrder(user, o, lines);
            event(user, "order-shipped", { so: o.soNumber, via: "detail" });
          });
        }
      }
    }
    // BOL for big orders (GenerateBOL.tsx)
    if (rng.chance(0.15)) {
      const list = await attempt(user, "open-bol", () => listOrders(user), { retryOn409: false });
      const big = (list ?? []).filter((o) => o.status === "Pick & Packed" && o.lineItems.length >= 20 && !o.bol);
      const o = pickFromTop(big);
      if (o) {
        await work(3);
        await attempt(user, "generate-bol", async (retry) => {
          const cur = retry ? await getOrder(user, o.soNumber) : o;
          await updateOrder(user, { ...cur, bol: { weight: "1200", packageCount: "3", palletSlip: "Y", handlingUnitQty: "3", handlingUnitType: "PLT", packageQty: "40", packageType: "CTN", hazmat: false, commodityDescription: "Hardware", nmfcNumber: "", freightClass: "70", additionalInfo: "", generatedAt: new Date().toISOString() } });
          event(user, "bol-generated", { so: cur.soNumber });
        });
      }
    }
    await work(did ? 0.5 : 4);
  }
}

async function receiver(user) {
  while (!dayOver()) {
    const pos = await attempt(user, "open-receiving", async () => (await get(user, "/api/vendor-purchase-orders")).map(mapPo), { retryOn409: false });
    const due = (pos ?? []).filter((p) => (p.status === "Open" || p.status === "Partially Received") && p.expectedDate && p.expectedDate <= today());
    const target = pickFromTop(due, 4);
    if (target) {
      await work(10 + target.lines.length * 1.5); // unloading + counting
      await attempt(user, "receive-po", async (retry) => {
        const po = mapPo(await get(user, `/api/vendor-purchase-orders/${target.poNumber}`));
        if (retry) ledger.receiveRetries++;
        const lines = po.lines.map((l) => ({ lineId: l.id, qty: rng.chance(0.85) ? Math.max(0, l.orderedQty - l.receivedQty) : Math.floor((l.orderedQty - l.receivedQty) * 0.5) }));
        await receivePo(user, po, lines);
        event(user, "po-received", { po: po.poNumber, units: lines.reduce((s, l) => s + l.qty, 0) });
      });
    } else {
      await work(20);
    }
  }
}

async function buyer(user) {
  while (!dayOver()) {
    const [items, orders, pos] = await Promise.all([
      attempt(user, "inventory", () => listItems(user), { retryOn409: false }),
      attempt(user, "inventory-orders", () => listOrders(user), { retryOn409: false }),
      attempt(user, "po-list", () => get(user, "/api/vendor-purchase-orders"), { retryOn409: false }),
    ]);
    if (items && orders && pos) {
      await work(15);
      const short = items.filter((i) => i.reorderPoint != null && i.qtyOnHand + i.qtyOnPurchaseOrder - qtyAllocatedOnOrders(i.itemNumber, orders) < i.reorderPoint).slice(0, rng.int(5, 15));
      if (short.length) {
        const v = rng.pick(seed.vendors);
        const expected = new Date(Date.now() - (rng.chance(0.3) ? 0 : -5 * 86400000)).toISOString().slice(0, 10);
        await attempt(user, "create-vendor-po", async () => {
          const po = mapPo(await post(user, "/api/vendor-purchase-orders", { vendorId: v.id, vendorName: v.name, orderDate: today(), expectedDate: expected, notes: "", lines: short.map((i) => ({ itemNumber: i.itemNumber, description: i.description, orderedQty: Math.max(100, i.reorderPoint * 2), receivedQty: 0, cost: Math.round(i.rate * 55) / 100 })) }));
          if (!FIXED) await Promise.all(short.map((i) => recomputeQtyOnPo(user, i.itemNumber)));
          event(user, "vendor-po-created", { po: po.poNumber, lines: short.length });
        }, { retryOn409: false });
      }
    }
    await work(45);
  }
}

async function salesManager(user) {
  while (!dayOver()) {
    // Analytics.tsx:79-81
    await attempt(user, "analytics", () => Promise.all([get(user, "/api/customers"), get(user, "/api/items"), get(user, "/api/sales-orders")]), { retryOn409: false });
    await work(12);
    // Customer Pricing: edit one price on a key account (CustomerPricing.tsx:86)
    await attempt(user, "edit-pricing", async () => {
      const [cs] = await Promise.all([get(user, "/api/customers"), get(user, "/api/items")]);
      const c = mapCustomer(rng.pick(cs.filter((x) => (x.priceOverrides?.length ?? 0) > 100)));
      await work(4);
      const p = rng.pick(c.priceOverrides);
      p.price = Math.round(p.price * 1.03 * 100) / 100;
      const t0 = performance.now();
      await put(user, `/api/customers/${c.id}`, c);
      event(user, "pricing-saved", { customer: c.name, overrides: c.priceOverrides.length, ms: Math.round(performance.now() - t0) });
    });
    await work(20);
  }
}

async function admin(user) {
  while (!dayOver()) {
    await attempt(user, "accounts", () => get(user, "/api/accounts"), { retryOn409: false });
    await attempt(user, "audit-log", () => get(user, "/api/audit-log?limit=200"), { retryOn409: false });
    await openDashboard(user);
    await work(10);
    // Edits an item's description/notes from Item Profile (whole-object PUT
    // carrying qtyOnHand from when the page loaded).
    await attempt(user, "edit-item", async () => {
      const it = mapItem(await get(user, `/api/items/${rng.pick(itemPool.slice(0, 60)).id}`));
      await get(user, "/api/sales-orders"); // ItemProfile.tsx:41
      await work(3);
      await put(user, `/api/items/${it.id}`, { ...it, notes: `Reviewed ${new Date().toISOString()}` });
      event(user, "item-edited", { item: it.itemNumber });
    });
    await work(25);
  }
}

// ----------------------------------------------------------------- driver --
const ROLE_FN = { "order-entry": orderEntry, "customer-service": orderEntry, validation: validator, warehouse, receiving: receiver, purchasing: buyer, "sales-manager": salesManager, ADMIN: admin };

async function configureScenario(adminUser) {
  const accounts = await get(adminUser, "/api/accounts");
  // "workaround" = the extra grants an admin has to discover and hand out
  // today for these jobs to work at all (see report: permission mismatch).
  const extra = SCENARIO === "workaround"
    ? { warehouse: { catalog: "edit" }, "order-entry": { catalog: "edit" }, receiving: { catalog: "edit", "purchase-orders": "edit" }, validation: { "purchase-orders": "view" } }
    : {};
  for (const [username, preset] of seed.staff) {
    if (preset === "ADMIN") continue;
    const acc = accounts.find((a) => a.username === username);
    await put(adminUser, `/api/accounts/${acc.id}`, { role: "CUSTOM", permissions: { ...PERMS[preset], ...(extra[preset] ?? {}) } });
  }
}

async function enterBacklog(adminUser) {
  const customers = (await get(adminUser, "/api/customers")).map(mapCustomer);
  adminUser.account = (await get(adminUser, "/api/auth/me")).account;
  for (let i = 0; i < BACKLOG; i++) {
    const { body } = await buildOrder(adminUser, customers);
    await post(adminUser, "/api/sales-orders", body);
  }
}

async function audit(adminUser) {
  const items = await listItems(adminUser);
  // Always the full history here (shipped orders included), whatever client mode.
  const orders = (await get(adminUser, "/api/sales-orders")).map(mapOrder);
  const pos = (await get(adminUser, "/api/vendor-purchase-orders")).map(mapPo);
  const start = new Map(seed.items.map((i) => [i.itemNumber, i.startQty]));
  const shipped = new Map();
  let overShippedLines = 0;
  for (const o of orders) for (const li of o.lineItems) {
    const s = (o.shipmentHistory ?? []).reduce((a, r) => a + (r.lines.find((l) => l.lineItemId === li.id)?.qty ?? 0), 0);
    shipped.set(li.item, (shipped.get(li.item) ?? 0) + s);
    if (s > li.ordered) overShippedLines++;
  }
  const received = new Map();
  for (const p of pos) for (const l of p.lines) received.set(l.itemNumber, (received.get(l.itemNumber) ?? 0) + l.receivedQty);
  let driftItems = 0, driftUnits = 0, negative = 0, overcommitted = 0, overcommittedUnits = 0, onPoMismatch = 0;
  const drifts = [];
  for (const it of items) {
    const expected = (start.get(it.itemNumber) ?? 0) + (received.get(it.itemNumber) ?? 0) - (shipped.get(it.itemNumber) ?? 0);
    const diff = it.qtyOnHand - expected;
    if (diff !== 0) { driftItems++; driftUnits += Math.abs(diff); drifts.push({ item: it.itemNumber, expected, actual: it.qtyOnHand, diff }); }
    if (it.qtyOnHand < 0) negative++;
    const reserved = qtyAllocatedOnOrders(it.itemNumber, orders);
    if (reserved > Math.max(0, it.qtyOnHand)) { overcommitted++; overcommittedUnits += reserved - Math.max(0, it.qtyOnHand); }
    const outstanding = pos.filter((p) => p.status !== "Closed").reduce((s, p) => s + p.lines.filter((l) => l.itemNumber === it.itemNumber).reduce((a, l) => a + Math.max(0, l.orderedQty - l.receivedQty), 0), 0);
    if (outstanding !== it.qtyOnPurchaseOrder) onPoMismatch++;
  }
  const byStatus = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  const todays = orders.filter((o) => o.orderDate === today());
  const orderedUnits = todays.reduce((s, o) => s + o.lineItems.reduce((a, li) => a + li.ordered, 0), 0);
  const shippedUnits = todays.reduce((s, o) => s + o.lineItems.reduce((a, li) => a + (o.shipmentHistory ?? []).reduce((x, r) => x + (r.lines.find((l) => l.lineItemId === li.id)?.qty ?? 0), 0), 0), 0);
  return {
    orders: { total: orders.length, byStatus, orderedUnits, shippedUnits },
    inventory: { driftItems, driftUnits, negative, overcommittedItems: overcommitted, overcommittedUnits, qtyOnPurchaseOrderMismatches: onPoMismatch, sampleDrifts: drifts.slice(0, 10) },
    overShippedLines,
    vendorPos: { total: pos.length, received: pos.filter((p) => p.status === "Received").length, partial: pos.filter((p) => p.status === "Partially Received").length },
  };
}

function summarize() {
  const byRoute = {};
  for (const c of metrics.calls) {
    const k = c.route;
    (byRoute[k] ??= { n: 0, ms: [], bytes: 0, status: {} }).n++;
    byRoute[k].ms.push(c.ms);
    byRoute[k].bytes += c.bytes;
    byRoute[k].status[c.status] = (byRoute[k].status[c.status] ?? 0) + 1;
  }
  const routes = Object.entries(byRoute).map(([route, r]) => {
    const s = r.ms.sort((a, b) => a - b);
    return { route, n: r.n, p50: Math.round(percentile(s, 50)), p95: Math.round(percentile(s, 95)), max: Math.round(s[s.length - 1]), avgKB: Math.round(r.bytes / r.n / 1024), status: r.status };
  }).sort((a, b) => b.n - a.n);
  const kinds = {};
  const byRole = {};
  for (const e of metrics.events) {
    kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    ((byRole[e.role] ??= {})[e.kind] = (byRole[e.role][e.kind] ?? 0) + 1);
  }
  const problems = {};
  for (const e of metrics.events.filter((x) => ["blocked-403", "conflict-409", "gave-up", "error"].includes(x.kind))) {
    const k = `${e.kind} | ${e.role} | ${e.detail.action} | ${e.detail.message}`;
    problems[k] = (problems[k] ?? 0) + 1;
  }
  const all = metrics.calls.map((c) => c.ms).sort((a, b) => a - b);
  return {
    totalCalls: metrics.calls.length,
    statusTotals: metrics.calls.reduce((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {}),
    overall: { p50: Math.round(percentile(all, 50)), p95: Math.round(percentile(all, 95)), p99: Math.round(percentile(all, 99)), max: Math.round(all[all.length - 1] ?? 0) },
    totalMB: Math.round(metrics.calls.reduce((s, c) => s + c.bytes, 0) / 1048576),
    routes, eventKinds: kinds, eventsByRole: byRole, problems,
  };
}

async function main() {
  const adminUser = { username: "admin", password: "123", roleLabel: "setup" };
  await login(adminUser);
  if (process.env.SIM_AUDIT_ONLY) {
    console.log(JSON.stringify(await audit(adminUser), null, 1));
    return;
  }
  await configureScenario(adminUser);
  await enterBacklog(adminUser);
  console.log(`[${SCENARIO}] backlog of ${BACKLOG} orders entered; starting ${REAL_MINUTES}-minute compressed day with ${seed.staff.length} users`);

  metrics.calls.length = 0;
  metrics.startedAt = Date.now();
  const users = seed.staff.map(([username, preset, roleLabel]) => ({ username, preset, roleLabel, password: "Sim-pass-1" }));
  const heartbeat = setInterval(() => {
    const k = {};
    for (const e of metrics.events) k[e.kind] = (k[e.kind] ?? 0) + 1;
    console.log(`  t+${Math.round((Date.now() - metrics.startedAt) / 1000)}s calls=${metrics.calls.length} ${JSON.stringify(k)}`);
  }, 30_000);
  await Promise.all(users.map(async (u, i) => {
    await sleep(i * 300); // staggered arrival
    await login(u);
    await openDashboard(u);
    await ROLE_FN[u.preset](u).catch((err) => event(u, "crash", { action: "role-loop", message: String(err?.stack ?? err) }));
  }));
  clearInterval(heartbeat);
  const elapsed = Date.now() - metrics.startedAt;
  const summary = summarize();
  const auditResult = await audit(adminUser);
  const result = { scenario: SCENARIO, client: CLIENT, realMinutes: REAL_MINUTES, elapsedMs: elapsed, ordersPlanned: ORDERS_TODAY, backlog: BACKLOG, ledger: { shipAttempts: ledger.shipAttempts, doubleShipRetries: ledger.doubleShipRetries, receiveRetries: ledger.receiveRetries }, summary, audit: auditResult, events: metrics.events };
  writeFileSync(OUT, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ scenario: SCENARIO, statusTotals: summary.statusTotals, overall: summary.overall, eventKinds: summary.eventKinds, audit: auditResult }, null, 1));
  console.log(`wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
