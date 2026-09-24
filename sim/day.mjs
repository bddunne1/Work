// One compressed business day for the 15-person office, driven through the
// real HTTP API with the same request sequences the React pages make.
//
//   Purchasing (2)       vendor POs for shortages, receiving trucks and
//                        returned goods, vendor upkeep, cycle counts
//   Customer Service (4) phone orders, "where's my order" calls, price &
//                        availability quotes, returns, cancellations
//   Order Entry (2)      keying customer POs, printing released pick lists
//   Analysts (2)         validation, allocation, releasing picks, back orders
//                        and ship-date estimates from vendor ETAs
//   Logistics (1)        confirming what shipped once the floor finishes a
//                        pick, BOLs for big orders, pickup scheduling,
//                        end-of-day shipped report
//   Director (1)         dashboard, analytics, activity log, reports
//   Sales Managers (3)   new accounts, account upkeep, pricing, account review
//
// Warehouse pickers aren't app users: a printed pick takes floor time
// (proportional to lines and units) before logistics can confirm it.
//
// Every person spends human time on each task (scaled from an 8-hour day
// into SIM_MINUTES real minutes), picks work from the top of shared queues,
// and reacts to errors the way the screens let them (a 409 -> reload and try
// once more; 403/400/500 -> give up on that task). Busy vs idle time is
// tracked per person so the report can show where the bottlenecks are.
//
// At the end an audit checks: on-hand vs the stock ledger, on-hand vs the
// documents (starting count + PO receipts - shipments + restocked returns +
// count adjustments), over-allocation, cancelled orders holding stock, and
// what's left in each queue.
//
//   SIM_MINUTES=12 SIM_ORDERS=150 SIM_BACKLOG=60 node sim/day.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  ApiError, get, post, put, patch, makeRng, metrics, event, sleep, today,
  mapOrder, mapItem, mapPo, mapCustomer, remainingToShip, allocatedQtyFor, qtyAllocatedOnOrders, percentile,
} from "./lib.mjs";
import { PERMS } from "./presets.mjs";

const REAL_MINUTES = Number(process.env.SIM_MINUTES ?? 12);
const DAY_MS = REAL_MINUTES * 60_000;
const SIM_MIN = DAY_MS / 480; // real ms per simulated business minute
const ORDERS_TODAY = Number(process.env.SIM_ORDERS ?? 150);
const BACKLOG = Number(process.env.SIM_BACKLOG ?? 60);
const rng = makeRng(Number(process.env.SIM_SEED ?? 7));
const seed = JSON.parse(readFileSync(new URL("./seed-state.json", import.meta.url), "utf8"));
// What-if staffing: SIM_SWAP="cs.priya:analyst" moves people to another role
// for this run (their account gets that role's preset).
const ROLE_LABEL = { purchasing: "Purchasing", "customer-service": "Customer Service", "order-entry": "Order Entry", analyst: "Analyst", logistics: "Logistics", "sales-manager": "Sales Manager", ADMIN: "Director" };
for (const pair of (process.env.SIM_SWAP ?? "").split(",").filter(Boolean)) {
  const [name, preset] = pair.split(":");
  const row = seed.staff.find((r) => r[0] === name);
  if (row && ROLE_LABEL[preset]) {
    row[1] = preset;
    row[2] = ROLE_LABEL[preset];
  }
}
const OUT = process.env.SIM_OUT ?? new URL("./results-roles.json", import.meta.url).pathname;

const dayOver = () => Date.now() >= metrics.startedAt + DAY_MS;
const simNow = () => (Date.now() - metrics.startedAt) / SIM_MIN; // simulated minutes since 8:00

// ---- human time, tracked per person ------------------------------------
const clock = new Map(); // username -> { busyMs, idleMs }
function acct(user) {
  if (!clock.has(user.username)) clock.set(user.username, { busyMs: 0, idleMs: 0, role: user.roleLabel });
  return clock.get(user.username);
}
async function work(user, mins) {
  const ms = Math.max(5, mins * SIM_MIN * (0.7 + rng.next() * 0.6));
  acct(user).busyMs += ms;
  await sleep(ms);
}
async function idle(user, mins) {
  const ms = mins * SIM_MIN;
  acct(user).idleMs += ms;
  await sleep(ms);
}

// ---- API helpers mirroring src/lib/*Store.ts ------------------------------
const listOpen = async (u) => (await get(u, "/api/sales-orders?open=1")).map(mapOrder);
const getOrder = async (u, so) => mapOrder(await get(u, `/api/sales-orders/${so}`));
const listItems = async (u) => (await get(u, "/api/items")).map(mapItem);
const updateOrder = async (u, o, expectedStatus) => mapOrder(await put(u, `/api/sales-orders/${o.soNumber}`, { ...o, expectedStatus }));
const search = (u, params) => get(u, `/api/sales-orders/search?${new URLSearchParams(params)}`);
const pickFromTop = (list, n = 3) => (list.length ? list[Math.floor(rng.next() * Math.min(n, list.length))] : undefined);
const bySo = (a, b) => Number(a.soNumber) - Number(b.soNumber);

async function login(user) {
  const res = await post(null, "/api/auth/login", { username: user.username, password: user.password });
  user.token = res.token;
  user.account = res.account;
  await get(user, "/api/auth/me");
  await get(user, "/api/settings");
}
// Dashboard.tsx: customer count (summary), item count, open orders, recent 5.
async function openDashboard(user) {
  await Promise.allSettled([
    get(user, "/api/customers?summary=1"),
    get(user, "/api/items"),
    get(user, "/api/sales-orders?open=1"),
    get(user, "/api/sales-orders?limit=5"),
  ]);
}

// Runs one task; a 409 means "someone else changed it" -> reload and retry once.
async function attempt(user, label, fn, { retry = true } = {}) {
  try {
    return await fn(false);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    if (status === 409 && retry) {
      event(user, "conflict-409", { action: label, message: err.message });
      await work(user, 0.5);
      try {
        return await fn(true);
      } catch (err2) {
        event(user, "gave-up", { action: label, status: err2.status ?? 0, message: err2.message });
        return undefined;
      }
    }
    event(user, status === 403 ? "blocked-403" : status === 409 ? "conflict-409" : "error", { action: label, status, message: err.message });
    return undefined;
  }
}

// ---- order generation (same mix as the first review) ----------------------
const TOP = seed.customers.filter((c) => c.top);
const REST = seed.customers.filter((c) => !c.top);
let acc = 0;
const popCdf = seed.items.map((i) => (acc += i.share));
function pickItem() {
  const r = rng.next() * acc;
  return seed.items[popCdf.findIndex((c) => c >= r)];
}
function orderShape() {
  const r = rng.next();
  if (r < 0.1) return { kind: "large", lines: rng.int(20, 40), qty: () => rng.int(100, 900) };
  if (r < 0.5) return { kind: "medium", lines: rng.int(8, 14), qty: () => rng.int(10, 150) };
  if (rng.chance(0.35)) return { kind: "tiny", lines: rng.int(1, 2), qty: () => rng.int(3, 4) };
  return { kind: "small", lines: rng.int(3, 7), qty: () => rng.int(5, 60) };
}
// Order Entry / Customer Service load the slim customer list, then the full
// record of the one being ordered for (prices + part numbers).
async function buildOrder(user) {
  const meta = rng.chance(0.8) ? rng.pick(TOP) : rng.pick(REST);
  const c = mapCustomer(await get(user, `/api/customers/${meta.id}`));
  const shape = orderShape();
  const chosen = new Map();
  while (chosen.size < shape.lines) {
    const it = pickItem();
    chosen.set(it.itemNumber, it);
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

// Orders arrive on their own schedule through the day - customer POs by
// email (55%, order entry) and phone orders (45%, customer service) - evenly
// between 8:00 and 16:30. Staff take whatever has arrived; nobody can key an
// order before it arrives, and an order nobody gets to just waits.
const ARRIVAL_WINDOW = 510;
const channelTotal = { "order-entry": Math.round(ORDERS_TODAY * 0.55), "customer-service": ORDERS_TODAY - Math.round(ORDERS_TODAY * 0.55) };
const channelTaken = { "order-entry": 0, "customer-service": 0 };
const arrived = (preset) => Math.min(channelTotal[preset], Math.floor(channelTotal[preset] * Math.min(1, (simNow() + 15) / ARRIVAL_WINDOW)));
let ordersRemaining = ORDERS_TODAY;
// Daily caps for the rarer customer-service events.
const caps = { returns: 8, cancels: 3 };
const entered = { "order-entry": 0, "customer-service": 0 };
function claimOrder(preset) {
  if (channelTaken[preset] >= arrived(preset)) return false;
  channelTaken[preset]++;
  ordersRemaining--;
  entered[preset]++;
  return true;
}

async function enterOrder(user) {
  await Promise.all([get(user, "/api/customers?summary=1"), get(user, "/api/items"), get(user, "/api/counters/salesOrder")]);
  const { shape, body } = await buildOrder(user);
  await work(user, 2 + body.lineItems.length * 0.6); // keying it in
  const saved = await attempt(user, "enter-order", () => post(user, "/api/sales-orders", body), { retry: false });
  if (saved) event(user, "order-entered", { so: saved.soNumber, kind: shape.kind, lines: body.lineItems.length, units: body.lineItems.reduce((s, l) => s + l.ordered, 0), at: simNow() });
}

// ---------------------------------------------------------------- roles --
async function orderEntry(user) {
  while (!dayOver()) {
    let did = false;
    if (claimOrder("order-entry")) {
      await enterOrder(user);
      did = true;
    }
    // Pick & Pack list: print pick lists + packing slips for released picks.
    if (rng.chance(did ? 0.35 : 0.9)) {
      const list = await attempt(user, "open-pick-pack", () => listOpen(user), { retry: false });
      const released = (list ?? []).filter((o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0 && !(o.pickListPrintedAt && o.packingSlipPrintedAt));
      if (released.length) {
        did = true;
        await work(user, 1 + released.length * 0.3); // printer
        const now = new Date().toISOString();
        for (const o of released) {
          await attempt(user, "print-picks", async (again) => {
            const cur = again ? await getOrder(user, o.soNumber) : o;
            if (cur.pickListPrintedAt && cur.packingSlipPrintedAt) return;
            await updateOrder(user, { ...cur, pickListPrintedAt: now, packingSlipPrintedAt: now }, "Pick & Packed");
            event(user, "pick-printed", { so: o.soNumber, at: simNow() });
          });
        }
      }
    }
    if (!did) await idle(user, 5);
    else await work(user, 1);
  }
}

async function customerService(user) {
  while (!dayOver()) {
    const r = rng.next();
    if (claimOrder("customer-service")) {
      await enterOrder(user); // a phone order is waiting - take it first
    } else if (r < 0.55) {
      // "Where's my order?" - find the customer's orders, open one, check
      // its schedule / shipments.
      await attempt(user, "order-status-call", async () => {
        const c = rng.chance(0.8) ? rng.pick(TOP) : rng.pick(REST);
        const res = await search(user, { customerId: c.id, pageSize: 25, sort: "soNumber", dir: "desc" });
        await work(user, 1.5);
        const o = res.rows?.[0];
        if (o) await getOrder(user, o.soNumber);
        await work(user, 2);
        event(user, "status-call", {});
      }, { retry: false });
    } else if (r < 0.85) {
      // Price & availability quote: customer's prices + stock less what's
      // already promised to open orders.
      await attempt(user, "price-availability", async () => {
        const c = rng.chance(0.8) ? rng.pick(TOP) : rng.pick(REST);
        await get(user, `/api/customers/${c.id}`);
        const [items, open] = await Promise.all([listItems(user), listOpen(user)]);
        const asked = Array.from({ length: rng.int(1, 5) }, pickItem);
        for (const it of asked) {
          const item = items.find((i) => i.itemNumber === it.itemNumber);
          void (item.qtyOnHand - qtyAllocatedOnOrders(it.itemNumber, open));
        }
        await work(user, 2 + asked.length * 0.5);
        event(user, "quote", { items: asked.length });
      }, { retry: false });
    } else if (r < 0.96 && caps.returns > 0) {
      caps.returns--;
      // Return: find a shipped order for the customer and issue an RA.
      await attempt(user, "issue-return", async () => {
        const res = await search(user, { status: "Shipped", pageSize: 20, sort: "shippedAt", dir: "desc" });
        const o = res.rows?.length ? mapOrder(rng.pick(res.rows)) : null;
        if (!o) return;
        const li = rng.pick(o.lineItems);
        const shipped = (o.shipmentHistory ?? []).reduce((s, rec) => s + (rec.lines.find((l) => l.lineItemId === li.id)?.qty ?? 0), 0);
        if (shipped < 1) return;
        await work(user, 4);
        const ra = await post(user, "/api/returns", {
          customerId: o.customerId, soNumber: o.soNumber, billTo: o.billTo, requestDate: today(), reason: rng.pick(["Wrong item", "Damaged in transit", "Overstock"]),
          lines: [{ itemNumber: li.item, description: li.description, qty: Math.max(1, Math.floor(shipped * rng.pick([0.05, 0.1, 0.25]))), rate: li.rate, restock: rng.chance(0.8) }],
          writtenBy: user.account.initials, writtenById: user.account.id,
        });
        event(user, "return-issued", { ra: ra.raNumber, so: o.soNumber });
      }, { retry: false });
    } else if (r >= 0.96 && caps.cancels > 0 && rng.chance(0.3)) {
      caps.cancels--;
      // Cancellation request on an order that hasn't shipped.
      await attempt(user, "cancel-order", async (again) => {
        const open = await listOpen(user);
        const target = pickFromTop(open.filter((o) => ["Entered", "Checked", "Backordered"].includes(o.status)).sort(bySo).reverse(), 10);
        if (!target) return;
        const o = again ? await getOrder(user, target.soNumber) : await getOrder(user, target.soNumber);
        await work(user, 2);
        await post(user, `/api/sales-orders/${o.soNumber}/cancel`, { version: o.version, reason: "Customer request" });
        event(user, "order-cancelled", { so: o.soNumber, from: o.status });
      });
    }
    await work(user, 1);
    await idle(user, rng.int(2, 8)); // waiting for the next call / email
  }
}

async function analyst(user) {
  while (!dayOver()) {
    let did = false;
    const open = await attempt(user, "open-queues", () => listOpen(user), { retry: false });
    if (!open) {
      await idle(user, 3);
      continue;
    }
    const entered = open.filter((o) => o.status === "Entered").sort(bySo);
    const checked = open.filter((o) => o.status === "Checked").sort(bySo);
    const allocated = open.filter((o) => o.status === "Allocated" && o.lineItems.some((li) => allocatedQtyFor(o, li.id) > 0)).sort(bySo);
    const backordered = open.filter((o) => o.status === "Backordered").sort(bySo);
    // Priority: keep picks flowing to the floor, then allocate, then validate.
    const jobs = [];
    if (allocated.length) jobs.push(["release", allocated]);
    if (checked.length) jobs.push(["allocate", checked]);
    if (entered.length) jobs.push(["validate", entered]);
    if (backordered.length && rng.chance(0.2)) jobs.push(["backorder", backordered]);
    const job = jobs.length ? jobs[Math.min(jobs.length - 1, Math.floor(rng.next() * Math.min(2, jobs.length)))] : null;
    if (job) {
      did = true;
      const target = pickFromTop(job[1]);
      if (job[0] === "validate") await validate(user, target.soNumber);
      else if (job[0] === "allocate") await allocate(user, target.soNumber);
      else if (job[0] === "release") await releasePick(user, target.soNumber);
      else await backorderReview(user, target.soNumber);
    }
    if (!did) await idle(user, 4);
    else await work(user, 0.3);
  }
}

async function validate(user, soNumber) {
  await attempt(user, "validate", async () => {
    const [o] = await Promise.all([getOrder(user, soNumber), listItems(user)]);
    if (o.status !== "Entered") return; // page shows "already moved on"
    await work(user, 1 + o.lineItems.length * 0.15);
    await updateOrder(user, { ...o, status: "Checked", checkedAt: new Date().toISOString(), checkedBy: user.account.initials, checkedByColor: user.account.color }, "Entered");
    event(user, "order-checked", { so: o.soNumber, at: simNow() });
  });
}

// AllocationDecision.tsx (fixed): each line starts at min(remaining, free).
async function allocate(user, soNumber) {
  await attempt(user, "allocate", async () => {
    const [items, open, o] = await Promise.all([listItems(user), listOpen(user), getOrder(user, soNumber)]);
    if (!["Checked", "Backordered"].includes(o.status)) return;
    const cust = o.customerId ? mapCustomer(await get(user, `/api/customers/${o.customerId}`)) : null;
    const byNum = new Map(items.map((i) => [i.itemNumber.toLowerCase(), i]));
    await work(user, 1 + o.lineItems.length * 0.25);
    const others = open.filter((x) => x.soNumber !== o.soNumber);
    const taken = new Map();
    const qtys = {};
    for (const li of o.lineItems) {
      const key = li.item.toLowerCase();
      const it = byNum.get(key);
      const free = it ? it.qtyOnHand - qtyAllocatedOnOrders(li.item, others) - (taken.get(key) ?? 0) : 0;
      qtys[li.id] = Math.max(0, Math.min(remainingToShip(o, li), free));
      taken.set(key, (taken.get(key) ?? 0) + qtys[li.id]);
    }
    const fully = o.lineItems.every((li) => qtys[li.id] >= remainingToShip(o, li));
    const shipCompleteOnly = cust?.shipCompleteOnly ?? false;
    const total = Object.values(qtys).reduce((a, b) => a + b, 0);
    const hold = (!fully && shipCompleteOnly) || total === 0;
    await updateOrder(user, {
      ...o, status: hold ? "Backordered" : "Allocated",
      allocation: { lines: o.lineItems.map((li) => ({ lineItemId: li.id, allocatedQty: hold ? 0 : qtys[li.id] })), fullyAllocated: fully, shipCompleteOnly: fully ? undefined : shipCompleteOnly, decidedAt: new Date().toISOString() },
    }, o.status);
    event(user, "order-allocated", { so: o.soNumber, status: hold ? "Backordered" : "Allocated", fully, at: simNow() });
  });
}

// PickPackDetail.tsx release: allocated -> packed & staged for printing.
async function releasePick(user, soNumber) {
  await attempt(user, "release-pick", async () => {
    const [, , o] = await Promise.all([listItems(user), listOpen(user), getOrder(user, soNumber)]);
    if (o.status !== "Allocated") return;
    await work(user, 1 + o.lineItems.length * 0.1);
    const qtys = Object.fromEntries(o.lineItems.map((li) => [li.id, allocatedQtyFor(o, li.id)]));
    const pendingShipment = o.lineItems.filter((li) => qtys[li.id] > 0).map((li) => ({ lineItemId: li.id, qty: qtys[li.id] }));
    const complete = o.lineItems.every((li) => remainingToShip(o, li) - qtys[li.id] <= 0);
    await updateOrder(user, {
      ...o, status: "Pick & Packed", pickPackStatus: complete ? "Complete" : "Partial", pickedAt: new Date().toISOString(), pendingShipment,
      pickListPrintedAt: undefined, packingSlipPrintedAt: undefined,
      allocation: o.allocation ? { ...o.allocation, lines: o.lineItems.map((li) => ({ lineItemId: li.id, allocatedQty: qtys[li.id] > 0 ? 0 : allocatedQtyFor(o, li.id) })) } : o.allocation,
    }, "Allocated");
    event(user, "pick-released", { so: o.soNumber, units: pendingShipment.reduce((s, l) => s + l.qty, 0), at: simNow() });
  });
}

// Back Order Queue: check vendor ETAs, set an estimated ship date, and
// re-run allocation if stock has come in.
async function backorderReview(user, soNumber) {
  await attempt(user, "backorder-review", async () => {
    const [pos, o] = await Promise.all([get(user, "/api/vendor-purchase-orders"), getOrder(user, soNumber)]);
    if (o.status !== "Backordered") return;
    await work(user, 2);
    const eta = pos.filter((p) => p.status !== "Closed" && p.expectedDate).map((p) => p.expectedDate.slice(0, 10)).sort()[0];
    if (eta && o.estimatedShipDate !== eta) {
      await updateOrder(user, { ...o, estimatedShipDate: eta }, "Backordered");
      event(user, "eta-set", { so: o.soNumber });
    }
  });
  await allocate(user, soNumber);
}

// Warehouse floor time from "pick list printed" to "goods at the dock".
const floorMinutes = (o) => 10 + o.lineItems.length * 1.5 + Math.min(45, o.pendingShipment.reduce((s, l) => s + l.qty, 0) / 200);

async function logistics(user) {
  let reportDone = false;
  while (!dayOver()) {
    let did = false;
    const open = await attempt(user, "open-picks", () => listOpen(user), { retry: false });
    const staged = (open ?? []).filter((o) => o.status === "Pick & Packed" && (o.pendingShipment?.length ?? 0) > 0 && o.pickListPrintedAt && o.packingSlipPrintedAt);
    const now = Date.now();
    const readyToConfirm = staged.filter((o) => now - Date.parse(o.pickListPrintedAt) >= floorMinutes(o) * SIM_MIN).sort(bySo);
    // BOL for big orders before they go out.
    const needBol = readyToConfirm.find((o) => o.lineItems.length >= 20 && !o.bol);
    if (needBol) {
      did = true;
      await attempt(user, "generate-bol", async (again) => {
        const cur = again ? await getOrder(user, needBol.soNumber) : needBol;
        await work(user, 4);
        await updateOrder(user, { ...cur, bol: { weight: "1200", packageCount: "3", palletSlip: "Y", handlingUnitQty: "3", handlingUnitType: "PLT", packageQty: "40", packageType: "CTN", hazmat: false, commodityDescription: "Hardware", nmfcNumber: "", freightClass: "70", additionalInfo: "", generatedAt: new Date().toISOString() } }, "Pick & Packed");
        event(user, "bol-generated", { so: cur.soNumber });
      });
    }
    const target = readyToConfirm[0];
    if (target) {
      did = true;
      await attempt(user, "confirm-shipped", async () => {
        const o = await getOrder(user, target.soNumber);
        if (o.status !== "Pick & Packed" || !(o.pendingShipment?.length)) return;
        await work(user, 1.5 + o.pendingShipment.length * 0.15);
        // ~5% of lines come back short from the floor
        const lines = o.pendingShipment.map((l) => ({ lineItemId: l.lineItemId, qty: rng.chance(0.05) ? Math.floor(l.qty * 0.9) : l.qty }));
        await post(user, `/api/sales-orders/${o.soNumber}/ship`, { version: o.version, lines });
        event(user, "order-shipped", { so: o.soNumber, units: lines.reduce((s, l) => s + l.qty, 0), at: simNow() });
      });
    }
    // Schedule truck pickups for staged orders that aren't ready yet.
    const unscheduled = staged.filter((o) => !o.estimatedShipDate || o.estimatedShipDate < today()).slice(0, 3);
    if (unscheduled.length && rng.chance(0.3)) {
      did = true;
      await work(user, 3 + unscheduled.length); // phone the carrier
      for (const o of unscheduled) {
        await attempt(user, "schedule-pickup", async (again) => {
          const cur = again ? await getOrder(user, o.soNumber) : o;
          await updateOrder(user, { ...cur, estimatedShipDate: today() }, "Pick & Packed");
          event(user, "pickup-scheduled", { so: o.soNumber });
        });
      }
    }
    // End of day: what shipped today.
    if (!reportDone && simNow() > 450) {
      reportDone = true;
      await attempt(user, "eod-report", async () => {
        const res = await search(user, { status: "Shipped,Backordered", shippedFrom: today(), shippedTo: today(), pageSize: 500, sort: "shippedAt", dir: "desc" });
        const moves = await get(user, `/api/stock-movements?reason=SHIP&from=${today()}&to=${today()}&limit=1000`);
        await work(user, 10);
        event(user, "eod-report", { orders: res.total, units: -moves.reduce((s, m) => s + m.delta, 0) });
      }, { retry: false });
    }
    if (!did) await idle(user, 3);
  }
}

async function purchasing(user, index) {
  let nextPoAt = index === 0 ? 30 : 9999; // one buyer writes POs
  while (!dayOver()) {
    let did = false;
    // Receive a truck that's due.
    const pos = await attempt(user, "open-receiving", async () => (await get(user, "/api/vendor-purchase-orders")).map(mapPo), { retry: false });
    const due = (pos ?? []).filter((p) => (p.status === "Open" || p.status === "Partially Received") && p.expectedDate && p.expectedDate <= today());
    const truck = pickFromTop(due, 4);
    if (truck && rng.chance(0.6)) {
      did = true;
      await work(user, 10 + truck.lines.length * 1.5); // unload + count
      await attempt(user, "receive-po", async () => {
        const po = mapPo(await get(user, `/api/vendor-purchase-orders/${truck.poNumber}`));
        const lines = po.lines.map((l) => ({ lineId: l.id, qty: rng.chance(0.85) ? Math.max(0, l.orderedQty - l.receivedQty) : Math.floor((l.orderedQty - l.receivedQty) * 0.5) })).filter((l) => l.qty > 0);
        if (!lines.length) return;
        await post(user, `/api/vendor-purchase-orders/${po.poNumber}/receive`, { version: po.version, lines });
        event(user, "po-received", { po: po.poNumber, units: lines.reduce((s, l) => s + l.qty, 0) });
      });
    }
    // Returned goods waiting at the dock.
    const ras = await attempt(user, "returns-list", () => get(user, "/api/returns"), { retry: false });
    const waiting = (ras ?? []).filter((r) => r.status === "Issued");
    if (waiting.length && rng.chance(0.5)) {
      did = true;
      const ra = waiting[0];
      await work(user, 5);
      await attempt(user, "receive-return", async () => {
        const cur = await get(user, `/api/returns/${ra.raNumber}`);
        if (cur.status !== "Issued") return;
        await post(user, `/api/returns/${ra.raNumber}/receive`, { version: cur.version, lines: [] });
        event(user, "return-received", { ra: ra.raNumber });
      });
    }
    // Buyer: POs for items that will run short.
    if (simNow() >= nextPoAt) {
      nextPoAt = simNow() + 60;
      did = true;
      await attempt(user, "create-vendor-po", async () => {
        const [items, open] = await Promise.all([listItems(user), listOpen(user)]);
        await work(user, 15);
        const short = items.filter((i) => i.reorderPoint != null && i.qtyOnHand + i.qtyOnPurchaseOrder - qtyAllocatedOnOrders(i.itemNumber, open) < i.reorderPoint).slice(0, rng.int(5, 15));
        if (!short.length) return;
        const v = rng.pick(seed.vendors);
        const expected = new Date(Date.now() + (rng.chance(0.3) ? 0 : 5 * 86400000)).toISOString().slice(0, 10);
        const po = await post(user, "/api/vendor-purchase-orders", { vendorId: v.id, vendorName: v.name, orderDate: today(), expectedDate: expected, notes: "", lines: short.map((i) => ({ itemNumber: i.itemNumber, description: i.description, orderedQty: Math.max(100, i.reorderPoint * 2), receivedQty: 0, cost: Math.round(i.rate * 55) / 100 })) });
        event(user, "vendor-po-created", { po: po.poNumber, lines: short.length });
      }, { retry: false });
    }
    // Cycle count on a busy SKU (compare-and-set; a shipment landing in the
    // middle of the count is refused, and they recount).
    if (rng.chance(0.15)) {
      did = true;
      await attempt(user, "cycle-count", async () => {
        const it = mapItem(await get(user, `/api/items/${rng.pick(seed.items.slice(0, 80)).id}`));
        await work(user, 6);
        const counted = Math.max(0, it.qtyOnHand + rng.pick([0, 0, 0, -2, -1, 1, 3]));
        await patch(user, `/api/items/by-number/${encodeURIComponent(it.itemNumber)}/qty`, { setQtyOnHand: counted, expectedQtyOnHand: it.qtyOnHand });
        event(user, "cycle-count", { item: it.itemNumber, delta: counted - it.qtyOnHand });
      });
    }
    // Vendor relations: update a contact.
    if (rng.chance(0.05)) {
      await attempt(user, "vendor-update", async () => {
        const vs = await get(user, "/api/vendors");
        const v = rng.pick(vs);
        await work(user, 3);
        await put(user, `/api/vendors/${v.id}`, { ...v, phone: `555-01${rng.int(10, 99)}` });
        event(user, "vendor-updated", {});
      });
    }
    if (!did) await idle(user, 8);
  }
}

async function director(user) {
  while (!dayOver()) {
    await openDashboard(user);
    await attempt(user, "analytics", () => get(user, "/api/analytics/summary"), { retry: false });
    await work(user, 10);
    await attempt(user, "activity-log", () => get(user, "/api/audit-log?limit=200"), { retry: false });
    await attempt(user, "stock-ledger", () => get(user, `/api/stock-movements?from=${today()}&limit=300`), { retry: false });
    await work(user, 8);
    await attempt(user, "shipped-report", () => search(user, { status: "Shipped", pageSize: 100, sort: "shippedAt", dir: "desc" }), { retry: false });
    await work(user, 5);
    await idle(user, 30);
  }
}

let newCustomerSeq = 0;
async function salesManager(user, index) {
  const myAccounts = seed.customers.filter((_, i) => i % 3 === index);
  while (!dayOver()) {
    const r = rng.next();
    if (r < 0.05) {
      // A lead converts: set up the new customer.
      await attempt(user, "new-customer", async () => {
        await work(user, 12);
        const n = ++newCustomerSeq;
        const name = `New Account ${String(n).padStart(2, "0")} (${user.username})`;
        const addr = { name, addressLine1: `${rng.int(100, 999)} Commerce Dr`, addressLine2: "", city: "Columbus", state: "OH", zip: "43004", notes: "" };
        const c = await post(user, "/api/customers", { name, accountNumber: `N${Date.now() % 100000}${n}`, billTo: addr, terms: "Net 30", shipVia: "UPS Ground", fob: "Origin", rep: user.account.initials, shipCompleteOnly: false, shipToLocations: [{ label: "Main", address: addr }], notes: [{ text: "Converted from trade-show lead" }], partNumberMap: [], priceOverrides: [] });
        event(user, "customer-created", { id: c.id });
      }, { retry: false });
    } else if (r < 0.45) {
      // Account upkeep: log a call, adjust a price.
      await attempt(user, "account-update", async () => {
        const meta = rng.pick(myAccounts);
        const c = mapCustomer(await get(user, `/api/customers/${meta.id}`));
        await work(user, 5);
        c.notes = [{ id: randomUUID(), text: `Account review ${new Date().toISOString().slice(0, 16)}`, createdAt: new Date().toISOString() }, ...c.notes];
        if (c.priceOverrides?.length && rng.chance(0.6)) {
          const p = rng.pick(c.priceOverrides);
          p.price = Math.round(p.price * (rng.chance(0.5) ? 1.03 : 0.98) * 100) / 100;
        }
        const t0 = performance.now();
        await put(user, `/api/customers/${c.id}`, c);
        event(user, "account-updated", { overrides: c.priceOverrides?.length ?? 0, ms: Math.round(performance.now() - t0) });
      });
    } else {
      // Review an account: its recent orders and the analytics page.
      await attempt(user, "account-review", async () => {
        const meta = rng.pick(myAccounts);
        await search(user, { customerId: meta.id, pageSize: 50, sort: "orderDate", dir: "desc" });
        if (rng.chance(0.3)) await get(user, "/api/analytics/summary");
        await work(user, 8);
        event(user, "account-reviewed", {});
      }, { retry: false });
    }
    await idle(user, rng.int(5, 20));
  }
}

const ROLE_FN = {
  "order-entry": orderEntry,
  "customer-service": customerService,
  analyst,
  logistics,
  purchasing,
  "sales-manager": salesManager,
  ADMIN: director,
};

// ---------------------------------------------------------------- setup --
async function configureAccounts(adminUser) {
  const accounts = await get(adminUser, "/api/accounts");
  for (const [username, preset] of seed.staff) {
    const acc = accounts.find((a) => a.username === username);
    const body = preset === "ADMIN" ? { role: "ADMIN" } : { role: "CUSTOM", permissions: PERMS[preset] };
    if (acc) await put(adminUser, `/api/accounts/${acc.id}`, body);
    else await post(adminUser, "/api/accounts", { username, password: "Sim-pass-1", ...body });
  }
}

async function enterBacklog(adminUser) {
  adminUser.account = (await get(adminUser, "/api/auth/me")).account;
  for (let i = 0; i < BACKLOG; i++) {
    const { body } = await buildOrder(adminUser);
    await post(adminUser, "/api/sales-orders", body);
  }
}

// ---------------------------------------------------------------- audit --
async function audit(adminUser) {
  const items = await listItems(adminUser);
  const all = (await get(adminUser, "/api/sales-orders")).map(mapOrder);
  const pos = (await get(adminUser, "/api/vendor-purchase-orders")).map(mapPo);
  const ras = await get(adminUser, "/api/returns");
  const moves = await get(adminUser, "/api/stock-movements?limit=1000");
  const start = new Map(seed.items.map((i) => [i.itemNumber, i.startQty]));
  const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
  const shipped = new Map(), received = new Map(), restocked = new Map(), adjusted = new Map(), ledger = new Map();
  let overShippedLines = 0;
  for (const o of all) for (const li of o.lineItems) {
    const s = (o.shipmentHistory ?? []).reduce((a, r) => a + (r.lines.find((l) => l.lineItemId === li.id)?.qty ?? 0), 0);
    add(shipped, li.item, s);
    if (s > li.ordered) overShippedLines++;
  }
  for (const p of pos) for (const l of p.lines) add(received, l.itemNumber, l.receivedQty);
  for (const ra of ras) if (ra.status !== "Issued") for (const l of ra.lines) if (l.restock) add(restocked, l.itemNumber, l.qty);
  for (const m of moves) {
    add(ledger, m.itemNumber, m.delta);
    if (m.reason === "ADJUST" || m.reason === "ITEM_EDIT") add(adjusted, m.itemNumber, m.delta);
  }
  let docDrift = 0, docDriftUnits = 0, ledgerDrift = 0, negative = 0, over = 0, overUnits = 0, onPoMismatch = 0;
  const samples = [];
  for (const it of items) {
    const s0 = start.get(it.itemNumber) ?? 0;
    const expected = s0 + (received.get(it.itemNumber) ?? 0) - (shipped.get(it.itemNumber) ?? 0) + (restocked.get(it.itemNumber) ?? 0) + (adjusted.get(it.itemNumber) ?? 0);
    if (it.qtyOnHand !== expected) { docDrift++; docDriftUnits += Math.abs(it.qtyOnHand - expected); samples.push({ item: it.itemNumber, expected, actual: it.qtyOnHand }); }
    if (it.qtyOnHand !== s0 + (ledger.get(it.itemNumber) ?? 0)) ledgerDrift++;
    if (it.qtyOnHand < 0) negative++;
    const reserved = qtyAllocatedOnOrders(it.itemNumber, all.filter((o) => o.status !== "Cancelled"));
    if (reserved > Math.max(0, it.qtyOnHand)) { over++; overUnits += reserved - Math.max(0, it.qtyOnHand); }
    const outstanding = pos.filter((p) => p.status !== "Closed").reduce((s, p) => s + p.lines.filter((l) => l.itemNumber === it.itemNumber).reduce((a, l) => a + Math.max(0, l.orderedQty - l.receivedQty), 0), 0);
    if (outstanding !== it.qtyOnPurchaseOrder) onPoMismatch++;
  }
  // Orders still waiting for validation at close, by when they came in:
  // yesterday's backlog, before 15:00 (should have been done), or late
  // afternoon (reasonably tomorrow's work).
  const waiting = all.filter((o) => o.status === "Entered").map((o) => (Date.parse(o.createdAt) - metrics.startedAt) / SIM_MIN);
  const waitingValidation = {
    total: waiting.length,
    fromYesterday: waiting.filter((t) => t < 0).length,
    arrivedBefore3pm: waiting.filter((t) => t >= 0 && t < 420).length,
    arrivedAfter3pm: waiting.filter((t) => t >= 420).length,
  };
  const cancelledHolding = all.filter((o) => o.status === "Cancelled" && (o.allocation || (o.pendingShipment?.length ?? 0) > 0)).length;
  const byStatus = {};
  for (const o of all) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  const todays = all.filter((o) => o.orderDate === today());
  const units = (o, fn) => o.lineItems.reduce((a, li) => a + fn(li), 0);
  const shippedUnitsToday = all.reduce((s, o) => s + (o.shipmentHistory ?? []).filter((r) => r.shippedAt.slice(0, 10) === today()).reduce((a, r) => a + r.lines.reduce((x, l) => x + l.qty, 0), 0), 0);
  return {
    orders: { total: all.length, enteredToday: todays.length, byStatus, orderedUnitsToday: todays.reduce((s, o) => s + units(o, (li) => li.ordered), 0), shippedUnitsToday },
    inventory: { docDriftItems: docDrift, docDriftUnits, ledgerDriftItems: ledgerDrift, negative, overcommittedItems: over, overcommittedUnits: overUnits, qtyOnPurchaseOrderMismatches: onPoMismatch, movementsToday: moves.length, sampleDrifts: samples.slice(0, 10) },
    overShippedLines,
    cancelledHoldingStock: cancelledHolding,
    waitingValidation,
    vendorPos: { total: pos.length, received: pos.filter((p) => p.status === "Received").length, partial: pos.filter((p) => p.status === "Partially Received").length },
    returns: { issued: ras.filter((r) => r.status === "Issued").length, received: ras.filter((r) => r.status === "Received").length },
  };
}

function summarize() {
  const byRoute = {};
  for (const c of metrics.calls) {
    const r = (byRoute[c.route] ??= { n: 0, ms: [], bytes: 0, status: {} });
    r.n++; r.ms.push(c.ms); r.bytes += c.bytes; r.status[c.status] = (r.status[c.status] ?? 0) + 1;
  }
  const routes = Object.entries(byRoute).map(([route, r]) => {
    const s = r.ms.sort((a, b) => a - b);
    return { route, n: r.n, p50: Math.round(percentile(s, 50)), p95: Math.round(percentile(s, 95)), max: Math.round(s[s.length - 1]), avgKB: Math.round(r.bytes / r.n / 1024), status: r.status };
  }).sort((a, b) => b.n - a.n);
  const eventsByRole = {};
  for (const e of metrics.events) ((eventsByRole[e.role] ??= {})[e.kind] = (eventsByRole[e.role][e.kind] ?? 0) + 1);
  const problems = {};
  for (const e of metrics.events.filter((x) => ["blocked-403", "conflict-409", "gave-up", "error"].includes(x.kind))) {
    const k = `${e.kind} | ${e.role} | ${e.detail.action} | ${String(e.detail.message).replace(/#\d+/g, "#…").replace(/\d+ available, \d+ requested/g, "N available, M requested")}`;
    problems[k] = (problems[k] ?? 0) + 1;
  }
  const people = {};
  for (const [name, c] of clock) {
    const total = c.busyMs + c.idleMs || 1;
    people[name] = { role: c.role, busyPct: Math.round((c.busyMs / DAY_MS) * 100), idlePct: Math.round((c.idleMs / DAY_MS) * 100), busyOfTracked: Math.round((c.busyMs / total) * 100) };
  }
  // Order lead times inside the day (simulated minutes from entry).
  const at = (kind) => new Map(metrics.events.filter((e) => e.kind === kind).map((e) => [String(e.detail.so), e.detail.at]));
  const ent = at("order-entered"), chk = at("order-checked"), alloc = at("order-allocated"), rel = at("pick-released"), shp = at("order-shipped");
  const stage = (a, b) => { const d = [...b].filter(([so]) => a.has(so)).map(([so, t]) => t - a.get(so)).sort((x, y) => x - y); return d.length ? { n: d.length, p50: Math.round(percentile(d, 50)), p90: Math.round(percentile(d, 90)) } : null; };
  const all = metrics.calls.map((c) => c.ms).sort((a, b) => a - b);
  return {
    totalCalls: metrics.calls.length,
    statusTotals: metrics.calls.reduce((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {}),
    overall: { p50: Math.round(percentile(all, 50)), p95: Math.round(percentile(all, 95)), p99: Math.round(percentile(all, 99)), max: Math.round(all[all.length - 1] ?? 0) },
    totalMB: Math.round(metrics.calls.reduce((s, c) => s + c.bytes, 0) / 1048576),
    routes, eventsByRole, problems, people,
    leadTimesMinutes: { entryToChecked: stage(ent, chk), checkedToAllocated: stage(chk, alloc), allocatedToReleased: stage(alloc, rel), releasedToShipped: stage(rel, shp), entryToShipped: stage(ent, shp) },
    ordersEnteredBy: { ...entered },
  };
}

async function main() {
  const adminUser = { username: "admin", password: "123", roleLabel: "setup" };
  await login(adminUser);
  if (process.env.SIM_AUDIT_ONLY) {
    console.log(JSON.stringify(await audit(adminUser), null, 1));
    return;
  }
  await configureAccounts(adminUser);
  await enterBacklog(adminUser);
  console.log(`backlog of ${BACKLOG} orders entered; starting ${REAL_MINUTES}-minute compressed day with ${seed.staff.length} people`);

  metrics.calls.length = 0;
  metrics.events.length = 0;
  metrics.startedAt = Date.now();
  const users = seed.staff.map(([username, preset, roleLabel]) => ({ username, preset, roleLabel, password: "Sim-pass-1" }));
  const heartbeat = setInterval(() => {
    const k = {};
    for (const e of metrics.events) k[e.kind] = (k[e.kind] ?? 0) + 1;
    console.log(`  t+${Math.round((Date.now() - metrics.startedAt) / 1000)}s calls=${metrics.calls.length} ${JSON.stringify(k)}`);
  }, 30_000);
  const idx = {};
  await Promise.all(users.map(async (u, i) => {
    await sleep(i * 300);
    await login(u);
    await openDashboard(u);
    const n = (idx[u.preset] = (idx[u.preset] ?? -1) + 1);
    await ROLE_FN[u.preset](u, n).catch((err) => event(u, "crash", { action: "role-loop", message: String(err?.stack ?? err) }));
  }));
  clearInterval(heartbeat);
  const summary = summarize();
  const result = { realMinutes: REAL_MINUTES, ordersPlanned: ORDERS_TODAY, backlog: BACKLOG, staff: seed.staff, summary, audit: await audit(adminUser), events: metrics.events };
  writeFileSync(OUT, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ statusTotals: summary.statusTotals, overall: summary.overall, people: summary.people, lead: summary.leadTimesMinutes, audit: result.audit }, null, 1));
  console.log(`wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
