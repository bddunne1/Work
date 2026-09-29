import { beforeEach, describe, expect, it } from "vitest";
import { fakeQuickBooks } from "../src/integrations/quickbooks/fake.js";
import { processOutbox } from "../src/integrations/sync.js";
import { prisma } from "../src/prisma.js";
import {
  admin, allocate, cancel, check, makeItem, makeOrder, makePo, makeVendor, markPrinted, ok, receive, release, resetDb,
  ship, so, undoShipment, type Client,
} from "./helpers.js";

// A randomized, concurrent workload against the real API followed by a full
// audit of the invariants the system promises. The point is not any one
// scenario but that no interleaving of legitimate operations can leave the
// stock ledger, the documents and the order states disagreeing.
//
//   STRESS_WORKERS=12 STRESS_STEPS=80 npm test -- stress   for a heavier run

beforeEach(async () => {
  await resetDb();
  fakeQuickBooks.reset();
});

const WORKERS = Number(process.env.STRESS_WORKERS ?? 8);
const STEPS = Number(process.env.STRESS_STEPS ?? 40);
const ITEMS = ["ST-1", "ST-2", "ST-3", "ST-4", "ST-5", "ST-6"];
const START_QTY = 60;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Tally = Record<string, number>;

async function worker(id: number, c: Client, tally: Tally, ledgerOnly: { adjust: Record<string, number> }) {
  const rand = rng(1000 + id);
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const count = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
  const note = (label: string, status: number) => {
    if (status >= 500) count(`500:${label}`);
    else if (status >= 400) count(`${label}:${status}`);
    else count(`${label}:ok`);
    return status;
  };
  for (let step = 0; step < STEPS; step++) {
    const r = rand();
    if (r < 0.08) {
      // Receive against a random open PO.
      const pos = ok(await c.get("/api/vendor-purchase-orders?open=1"));
      const po = pick(pos);
      if (!po) continue;
      const qtys = po.lines.map((l: any) => Math.floor(rand() * Math.max(1, l.orderedQty - l.receivedQty + 1)));
      note("receive", (await receive(c, po, qtys)).status);
      continue;
    }
    if (r < 0.12) {
      // Cycle count: nudge an item's on-hand by a few units either way.
      const itemNumber = pick(ITEMS);
      const item = ok(await c.get(`/api/items?q=${itemNumber}`)).find((i: any) => i.itemNumber === itemNumber);
      const delta = Math.floor(rand() * 7) - 3;
      if (!item || delta === 0 || item.qtyOnHand + delta < 0) continue;
      const res = await c.patch(`/api/items/by-number/${itemNumber}/qty`, { setQtyOnHand: item.qtyOnHand + delta, expectedQtyOnHand: item.qtyOnHand });
      if (note("adjust", res.status) === 200) ledgerOnly.adjust[itemNumber] = (ledgerOnly.adjust[itemNumber] ?? 0) + delta;
      continue;
    }
    if (r < 0.15) {
      // Issue and receive a return against a shipped order.
      const shipped = ok(await c.get("/api/sales-orders/search?status=Shipped,Backordered&pageSize=50")).rows.filter((o: any) => o.shipmentHistory.length > 0);
      const o = pick(shipped);
      if (!o) continue;
      const rec = pick(o.shipmentHistory) as any;
      const line = pick(rec.lines) as any;
      const li = o.lineItems.find((l: any) => l.id === line.lineItemId);
      const ra = await c.post("/api/returns", {
        soNumber: String(o.soNumber),
        billTo: o.billTo,
        requestDate: "2026-09-29",
        lines: [{ itemNumber: li.item, description: li.description, qty: 1, rate: 1, restock: rand() < 0.8 }],
      });
      if (note("return-issue", ra.status) !== 201) continue;
      note("return-receive", (await c.post(`/api/returns/${ra.body.raNumber}/receive`, { version: ra.body.version, lines: [] })).status);
      continue;
    }
    // Otherwise: advance a random open order one step.
    const open = ok(await c.get("/api/sales-orders?open=1"));
    const o = pick(open);
    if (!o) continue;
    switch (o.status) {
      case "Entered":
        note("check", (await check(c, o)).status);
        break;
      case "Checked":
      case "Backordered": {
        const qtys = o.lineItems.map((li: any) => {
          const shipped = o.shipmentHistory.reduce((s: number, rec: any) => s + (rec.lines.find((l: any) => l.lineItemId === li.id)?.qty ?? 0), 0);
          const remaining = Math.max(0, li.ordered - shipped);
          return rand() < 0.7 ? remaining : Math.floor(rand() * (remaining + 1));
        });
        note("allocate", (await allocate(c, o, qtys, rand() < 0.3)).status);
        break;
      }
      case "Allocated":
        if (rand() < 0.1) note("unallocate", (await c.post(`${so(o)}/unallocate`, { version: o.version })).status);
        else if (rand() < 0.08) note("cancel", (await cancel(c, o, "stress")).status);
        else {
          const partial = rand() < 0.3;
          const qtys = partial ? o.allocation.lines.map((l: any) => Math.floor(rand() * (l.allocatedQty + 1))) : undefined;
          note("release", (await release(c, o, qtys)).status);
        }
        break;
      case "Pick & Packed":
        if (!(o.pickListPrintedAt && o.packingSlipPrintedAt)) {
          const trim = rand() < 0.2 ? o.pendingShipment.map((l: any) => ({ lineItemId: l.lineItemId, qty: Math.max(0, l.qty - 1) })) : undefined;
          note("print", (await markPrinted(c, o, trim)).status);
        } else if (o.pendingShipment.length === 0) {
          note("undo", (await undoShipment(c, o)).status);
        } else {
          const qtys = o.lineItems.map((li: any) => {
            const staged = o.pendingShipment.find((l: any) => l.lineItemId === li.id)?.qty ?? 0;
            return rand() < 0.1 ? Math.floor(staged * 0.8) : staged;
          });
          note("ship", (await ship(c, o, qtys)).status);
        }
        break;
      default:
        break;
    }
    // Occasionally undo a shipment on a closed order.
    if (rand() < 0.05) {
      const done = ok(await c.get("/api/sales-orders/search?status=Shipped&pageSize=20")).rows;
      const d = pick(done);
      if (d) note("undo", (await undoShipment(c, d)).status);
    }
  }
}

describe("randomized concurrent workload", () => {
  it("leaves the ledger, the documents and every order state consistent", async () => {
    const root = await admin();
    for (const n of ITEMS) await makeItem(root, n, START_QTY);
    const vendor = await makeVendor(root);
    for (let i = 0; i < 4; i++) {
      await makePo(root, vendor, ITEMS.slice(i, i + 3).map((itemNumber) => ({ itemNumber, orderedQty: 20 })));
    }
    const orders = 30;
    for (let i = 0; i < orders; i++) {
      const lines = [1, 2, 3].slice(0, 1 + (i % 3)).map((k) => ({ item: ITEMS[(i + k) % ITEMS.length], ordered: 1 + ((i * 7 + k) % 9) }));
      await makeOrder(root, lines);
    }

    const tally: Tally = {};
    const ledgerOnly = { adjust: {} as Record<string, number> };
    await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i, root, tally, ledgerOnly)));

    // 1. Nothing ever blew up.
    const fives = Object.keys(tally).filter((k) => k.startsWith("500:"));
    expect(fives, JSON.stringify(tally)).toEqual([]);
    // Something actually happened.
    expect(tally["ship:ok"] ?? 0, JSON.stringify(tally)).toBeGreaterThan(0);

    // 2. The ledger explains on-hand for every item.
    for (const n of ITEMS) {
      const item = await prisma.item.findUniqueOrThrow({ where: { itemNumber: n } });
      const moves = await prisma.stockMovement.findMany({ where: { itemNumber: n }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      const sum = moves.reduce((s, m) => s + m.delta, 0);
      // Opening stock is itself the first movement (A-17), so the ledger
      // explains on hand from nothing.
      expect(item.qtyOnHand, `${n}: ledger`).toBe(sum);
      expect(moves[0]?.reason, `${n}: first movement`).toBe("OPENING");
      // 3. Shipping never drove on-hand negative.
      for (const m of moves) if (m.reason === "SHIP") expect(m.qtyAfter, `${n}: SHIP left ${m.qtyAfter}`).toBeGreaterThanOrEqual(0);
    }

    // 4. The documents explain on-hand too: receipts - shipments + restocked
    //    returns + count corrections.
    const byLine = new Map<string, string>();
    for (const l of await prisma.salesOrderLine.findMany()) byLine.set(l.id, l.item);
    const poLineItem = new Map<string, string>();
    for (const l of await prisma.vendorPoLine.findMany()) poLineItem.set(l.id, l.itemNumber);
    const fromDocs: Record<string, number> = Object.fromEntries(ITEMS.map((n) => [n, START_QTY + (ledgerOnly.adjust[n] ?? 0)]));
    for (const rec of await prisma.vendorReceivingRecord.findMany()) {
      for (const l of rec.lines as { lineId: string; qty: number }[]) fromDocs[poLineItem.get(l.lineId)!] += l.qty;
    }
    for (const rec of await prisma.shipmentRecord.findMany()) {
      for (const l of rec.lines as { lineItemId: string; qty: number }[]) fromDocs[byLine.get(l.lineItemId)!] -= l.qty;
    }
    for (const line of await prisma.returnLine.findMany({ where: { restock: true, returnAuth: { status: "RECEIVED" } } })) {
      fromDocs[line.itemNumber] += line.qty;
    }
    for (const n of ITEMS) {
      const item = await prisma.item.findUniqueOrThrow({ where: { itemNumber: n } });
      expect(item.qtyOnHand, `${n}: documents`).toBe(fromDocs[n]);
    }

    // 5. Every order is in a coherent state.
    const all = await prisma.salesOrder.findMany({ include: { lineItems: true, shipmentHistory: true } });
    for (const o of all) {
      const shipped = new Map<string, number>();
      for (const rec of o.shipmentHistory) for (const l of rec.lines as any[]) shipped.set(l.lineItemId, (shipped.get(l.lineItemId) ?? 0) + l.qty);
      const remaining = (li: { id: string; ordered: number }) => Math.max(0, li.ordered - (shipped.get(li.id) ?? 0));
      for (const li of o.lineItems) expect(shipped.get(li.id) ?? 0, `S.O. ${o.soNumber} ${li.item} over-shipped`).toBeLessThanOrEqual(li.ordered);
      const alloc = (o.allocation as any)?.lines ?? [];
      const staged = (o.pendingShipment as any[]) ?? [];
      switch (o.status) {
        case "SHIPPED":
          for (const li of o.lineItems) expect(shipped.get(li.id) ?? 0, `S.O. ${o.soNumber} shipped short`).toBe(li.ordered);
          expect(staged).toEqual([]);
          break;
        case "ALLOCATED":
          expect(alloc.reduce((s: number, l: any) => s + l.allocatedQty, 0), `S.O. ${o.soNumber} allocated nothing`).toBeGreaterThan(0);
          for (const l of alloc) expect(l.allocatedQty).toBeLessThanOrEqual(remaining(o.lineItems.find((x) => x.id === l.lineItemId)!));
          break;
        case "PICK_PACKED":
          expect(staged.length, `S.O. ${o.soNumber} packed with nothing staged`).toBeGreaterThan(0);
          for (const l of staged) expect(l.qty).toBeLessThanOrEqual(remaining(o.lineItems.find((x) => x.id === l.lineItemId)!));
          break;
        case "BACKORDERED":
          // A hold (allocated nothing) or the remainder of a partial
          // shipment (allocation released, A-07): either way nothing is held.
          expect(alloc.reduce((s: number, l: any) => s + l.allocatedQty, 0), `S.O. ${o.soNumber} backordered but holding`).toBe(0);
          expect(staged).toEqual([]);
          break;
        case "CANCELLED":
          expect(o.allocation).toBeNull();
          expect(staged).toEqual([]);
          break;
        case "CHECKED":
        case "ENTERED":
          expect(o.allocation).toBeNull();
          break;
      }
    }

    // 5b. The reservation table agrees with the orders' JSON and with the
    // per-item total every screen reads Available from.
    const rows = await prisma.allocation.findMany();
    const rowsByLine = new Map(rows.map((r) => [r.lineItemId, r]));
    for (const o of all) {
      const holding = ["ALLOCATED", "BACKORDERED", "PICK_PACKED"].includes(o.status);
      const held = new Map<string, number>();
      if (holding) {
        for (const l of (o.allocation as any)?.lines ?? []) if (l.allocatedQty > 0) held.set(l.lineItemId, (held.get(l.lineItemId) ?? 0) + l.allocatedQty);
        for (const l of (o.pendingShipment as any[]) ?? []) if (l.qty > 0) held.set(l.lineItemId, (held.get(l.lineItemId) ?? 0) + l.qty);
      }
      for (const li of o.lineItems) {
        expect(rowsByLine.get(li.id)?.qty ?? 0, `S.O. ${o.soNumber} ${li.item} reservation row`).toBe(held.get(li.id) ?? 0);
        if (rowsByLine.has(li.id)) expect(rowsByLine.get(li.id)!.itemId).toBe(li.itemId);
      }
    }
    for (const n of ITEMS) {
      const item = await prisma.item.findUniqueOrThrow({ where: { itemNumber: n }, include: { allocations: true } });
      expect(item.qtyReserved, `${n}: qtyReserved`).toBe(item.allocations.reduce((s, a) => s + a.qty, 0));
    }

    // 6. POs: line receipts equal their receiving records; status is derived.
    for (const po of await prisma.vendorPurchaseOrder.findMany({ include: { lines: true, receivingHistory: true } })) {
      const got = new Map<string, number>();
      for (const rec of po.receivingHistory) for (const l of rec.lines as any[]) got.set(l.lineId, (got.get(l.lineId) ?? 0) + l.qty);
      for (const l of po.lines) expect(l.receivedQty, `${po.poNumber} ${l.itemNumber}`).toBe(got.get(l.id) ?? 0);
      const full = po.lines.every((l) => l.receivedQty >= l.orderedQty);
      const any = po.lines.some((l) => l.receivedQty > 0);
      expect(po.status).toBe(full ? "RECEIVED" : any ? "PARTIALLY_RECEIVED" : "OPEN");
    }

    // 7. Every shipment has exactly one live invoice whose lines match it, an
    //    undone shipment left a void one behind, and every received return
    //    has a credit memo. Every document is queued for the bridge.
    const shipments = await prisma.shipmentRecord.findMany();
    const invoices = await prisma.invoice.findMany({ include: { lines: true } });
    const byShipment = new Map(invoices.filter((i) => i.shipmentRecordId).map((i) => [i.shipmentRecordId!, i]));
    for (const rec of shipments) {
      const inv = byShipment.get(rec.id);
      expect(inv, `shipment ${rec.id} has no invoice`).toBeTruthy();
      // Drafts until Accounting issues them; the workload has no reviewer.
      expect(inv!.status).toBe("DRAFT");
      const shippedLines = (rec.lines as { lineItemId: string; qty: number }[]).filter((l) => l.qty > 0);
      expect(inv!.lines.map((l) => [l.salesOrderLineId, l.qty]).sort()).toEqual(shippedLines.map((l) => [l.lineItemId, l.qty]).sort());
      const sum = inv!.lines.reduce((s, l) => s + Number(l.amount), 0);
      expect(Math.round(sum * 100)).toBe(Math.round(Number(inv!.subtotal) * 100));
    }
    for (const inv of invoices) if (!inv.shipmentRecordId) expect(inv.status, `${inv.invoiceNumber} orphaned but live`).toBe("VOID");
    const receivedRas = await prisma.returnAuthorization.findMany({ where: { status: "RECEIVED" } });
    for (const ra of receivedRas) expect(await prisma.creditMemo.count({ where: { raNumber: ra.raNumber } }), `${ra.raNumber} has no credit memo`).toBe(1);
    for (const inv of invoices) if (inv.invoiceNumber) expect(await prisma.syncOutbox.count({ where: { entityType: "invoice", entityId: inv.invoiceNumber } }), `${inv.invoiceNumber} never queued`).toBeGreaterThan(0);
    // And the bridge drains without a single failure against the fake.
    const drained = await processOutbox({ limit: 10_000 });
    expect(drained.failed + drained.dead, JSON.stringify(drained)).toBe(0);
    expect(await prisma.syncOutbox.count({ where: { status: { not: "DONE" } } })).toBe(0);

    // 8. Every stock movement names who did it and what for.
    const anonymous = await prisma.stockMovement.count({ where: { actorId: null } });
    expect(anonymous).toBe(0);
    // eslint-disable-next-line no-console
    console.log("workload:", JSON.stringify(tally));
  });
});
