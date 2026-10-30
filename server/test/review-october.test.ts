// Regression tests for the defects found in the October review
// (docs/review/open-bugs.md). One describe per item.
import { beforeEach, describe, expect, it } from "vitest";
import { fakeQuickBooks } from "../src/integrations/quickbooks/fake.js";
import { processOutbox, recoverProcessingRows, startSyncScheduler } from "../src/integrations/sync.js";
import { lineAmountCents } from "../src/lib/money.js";
import { prisma } from "../src/prisma.js";
import { admin, issueInvoiceFor, makeCustomer, makeItem, makeOrder, ok, orderReadyToShip, resetDb, ship } from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  fakeQuickBooks.reset();
});

async function draftInvoiceFor(c: Awaited<ReturnType<typeof admin>>, soNumber: string | number) {
  const list = ok(await c.get(`/api/invoices?soNumber=${soNumber}&status=DRAFT`));
  return list.rows.at(-1);
}

// A shipped order with an issued invoice and a received return, so there is
// a draft credit memo to work with.
async function receivedReturn(root: Awaited<ReturnType<typeof admin>>) {
  await makeItem(root, "BR-1001", 100, 3);
  const cust = await makeCustomer(root, "Acme Fabrication");
  const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 10, rate: 3 }], { customerId: cust.id })));
  await issueInvoiceFor(root, o.soNumber);
  const ra = ok(await root.post("/api/returns", { customerId: cust.id, soNumber: String(o.soNumber), billTo: cust.billTo, requestDate: "2026-09-29", lines: [{ itemNumber: "BR-1001", description: "x", qty: 4, rate: 3, restock: true }] }), 201);
  ok(await root.post(`/api/returns/${ra.raNumber}/receive`, { version: ra.version, lines: [] }));
  const memo = ok(await root.get(`/api/invoices/credit-memos?status=DRAFT`)).rows.find((m: any) => m.raNumber === ra.raNumber);
  return { o, ra, memo };
}

const statuses = (rs: { status: number }[]) => rs.map((r) => r.status).sort();
const asInput = (lines: any[]) => lines.map((l) => ({ id: l.id, kind: l.kind, item: l.item, description: l.description, qty: l.qty, rate: Number(l.rate), taxable: l.taxable }));

describe("item 1: issuing, voiding and editing a document is serialized", () => {
  it("two concurrent issues of one draft invoice: one wins, one number, one outbox row, one audit entry", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 2 }])));
    const draft = await draftInvoiceFor(root, o.soNumber);
    const results = await Promise.all([
      root.post(`/api/invoices/${draft.id}/issue`, { version: draft.version }),
      root.post(`/api/invoices/${draft.id}/issue`, { version: draft.version }),
    ]);
    expect(statuses(results)).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body).toMatchObject({ conflict: true });
    const issued = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(issued.invoiceNumber).toBe("INV-20001");
    expect(issued.version).toBe(draft.version + 1);
    // The counter moved once: the next invoice takes the next number.
    expect((await prisma.counter.findUniqueOrThrow({ where: { key: "invoice" } })).value).toBe(20001);
    expect(await prisma.syncOutbox.count({ where: { entityType: "invoice" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "INVOICE_ISSUED" } })).toBe(1);
  });

  it("two concurrent issues of one draft credit memo behave the same way", async () => {
    const root = await admin();
    const { memo } = await receivedReturn(root);
    const results = await Promise.all([
      root.post(`/api/invoices/credit-memos/${memo.id}/issue`, { version: memo.version }),
      root.post(`/api/invoices/credit-memos/${memo.id}/issue`, { version: memo.version }),
    ]);
    expect(statuses(results)).toEqual([200, 409]);
    const issued = await prisma.creditMemo.findUniqueOrThrow({ where: { id: memo.id } });
    expect(issued.creditMemoNumber).toBe("CM-30001");
    expect((await prisma.counter.findUniqueOrThrow({ where: { key: "creditMemo" } })).value).toBe(30001);
    expect(await prisma.syncOutbox.count({ where: { entityType: "credit-memo" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "CREDIT_MEMO_ISSUED" } })).toBe(1);
  });

  it("two concurrent voids of one issued invoice: one wins, one VOID row queued, one audit entry", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 2 }])));
    const issued = await issueInvoiceFor(root, o.soNumber);
    const results = await Promise.all([
      root.post(`/api/invoices/${issued.id}/void`, { reason: "first" }),
      root.post(`/api/invoices/${issued.id}/void`, { reason: "second" }),
    ]);
    expect(statuses(results)).toEqual([200, 409]);
    expect(await prisma.syncOutbox.count({ where: { entityType: "invoice", action: "VOID" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "INVOICE_VOIDED" } })).toBe(1);
  });

  it("two concurrent voids of one issued credit memo behave the same way", async () => {
    const root = await admin();
    const { memo } = await receivedReturn(root);
    const issued = ok(await root.post(`/api/invoices/credit-memos/${memo.id}/issue`, { version: memo.version }));
    const results = await Promise.all([
      root.post(`/api/invoices/credit-memos/${issued.id}/void`, { reason: "first" }),
      root.post(`/api/invoices/credit-memos/${issued.id}/void`, { reason: "second" }),
    ]);
    expect(statuses(results)).toEqual([200, 409]);
    expect(await prisma.syncOutbox.count({ where: { entityType: "credit-memo", action: "VOID" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "CREDIT_MEMO_VOIDED" } })).toBe(1);
  });

  it("two concurrent edits of one draft invoice from the same version: one wins, the version moves once", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 2 }])));
    const draft = await draftInvoiceFor(root, o.soNumber);
    const lines = asInput(draft.lines);
    const results = await Promise.all([
      root.put(`/api/invoices/${draft.id}`, { version: draft.version, notes: "first", lines: [...lines, { kind: "CHARGE", item: "FREIGHT", description: "Freight", qty: 1, rate: 10, taxable: false }] }),
      root.put(`/api/invoices/${draft.id}`, { version: draft.version, notes: "second", lines: [...lines, { kind: "CHARGE", item: "HANDLING", description: "Handling", qty: 1, rate: 5, taxable: false }] }),
    ]);
    expect(statuses(results)).toEqual([200, 409]);
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: true } });
    expect(after.version).toBe(draft.version + 1);
    const winner = results.find((r) => r.status === 200)!.body;
    expect(after.notes).toBe(winner.notes);
    expect(after.lines.filter((l) => l.kind === "CHARGE")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "INVOICE_DRAFT_UPDATED" } })).toBe(1);
  });

  it("two concurrent edits of one draft credit memo behave the same way", async () => {
    const root = await admin();
    const { memo } = await receivedReturn(root);
    const lines = asInput(memo.lines);
    const results = await Promise.all([
      root.put(`/api/invoices/credit-memos/${memo.id}`, { version: memo.version, lines: [...lines, { kind: "CHARGE", item: "DEDUCTION", description: "Restock fee", qty: 1, rate: -1, taxable: false }] }),
      root.put(`/api/invoices/credit-memos/${memo.id}`, { version: memo.version, lines: [...lines, { kind: "CHARGE", item: "DEDUCTION", description: "Freight back", qty: 1, rate: -2, taxable: false }] }),
    ]);
    expect(statuses(results)).toEqual([200, 409]);
    const after = await prisma.creditMemo.findUniqueOrThrow({ where: { id: memo.id }, include: { lines: true } });
    expect(after.version).toBe(memo.version + 1);
    expect(after.lines.filter((l) => l.kind === "CHARGE")).toHaveLength(1);
  });
});

describe("item 2: one line-amount rule - multiply, then round half up to the cent", () => {
  // The same table runs against the client helper in src/lib/money.test.ts.
  it.each([
    [100, 1.2345, 12345],
    [500, 0.4875, 24375],
    [18, 15.125, 27225],
    [1000, 0.005, 500],
    [3, 1.005, 302],
  ])("%d x %s = %d cents", (qty, rate, cents) => {
    expect(lineAmountCents(qty, rate)).toBe(cents);
  });

  it("prices charge lines on a draft by the same rule as item lines", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100, 1.005);
    const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 3, rate: 1.005 }])));
    const draft = await draftInvoiceFor(root, o.soNumber);
    expect(draft.lines[0].amount).toBe("3.02");
    const saved = ok(await root.put(`/api/invoices/${draft.id}`, {
      version: draft.version,
      lines: [
        ...asInput(draft.lines),
        { kind: "CHARGE", item: "FREIGHT", description: "3 cartons", qty: 3, rate: 1.005, taxable: false },
        { kind: "CHARGE", item: "HANDLING", description: "500 pieces", qty: 500, rate: 0.4875, taxable: false },
      ],
    }));
    const charges = saved.lines.filter((l: any) => l.kind === "CHARGE").map((l: any) => l.amount);
    expect(charges).toEqual(["3.02", "243.75"]);
    expect(saved.subtotal).toBe("249.79");
  });

  it("refuses a rate with more than four decimals, which is what the columns hold", async () => {
    const root = await admin();
    await makeItem(root, "BR-1001", 100);
    const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 2 }])));
    const draft = await draftInvoiceFor(root, o.soNumber);
    const res = await root.put(`/api/invoices/${draft.id}`, { version: draft.version, lines: [...asInput(draft.lines), { kind: "CHARGE", item: "FREIGHT", description: "x", qty: 1, rate: 1.23456, taxable: false }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/four decimals/);
    const order = await makeOrder(root, [{ item: "BR-1001", ordered: 1, rate: 0.33333 }]).catch((e: Error) => e);
    expect(order).toBeInstanceOf(Error);
  });
});

describe("item 3: outbox rows stuck in PROCESSING are retried", () => {
  // A row the processor marked PROCESSING and never finished (the process
  // died mid-call) used to be invisible to every later run.
  async function stuckRow(root: Awaited<ReturnType<typeof admin>>, ageMs: number) {
    await makeItem(root, "BR-1001", 100);
    const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 2 }])));
    await issueInvoiceFor(root, o.soNumber);
    const row = await prisma.syncOutbox.findFirstOrThrow({ where: { entityType: "invoice" } });
    await prisma.syncOutbox.update({ where: { id: row.id }, data: { status: "PROCESSING" } });
    await prisma.$executeRaw`UPDATE "SyncOutbox" SET "updatedAt" = now() - make_interval(secs => ${ageMs / 1000}) WHERE "id" = ${row.id}`;
    return row;
  }

  it("attempts a PROCESSING row older than five minutes", async () => {
    const root = await admin();
    const row = await stuckRow(root, 6 * 60_000);
    expect(await processOutbox()).toMatchObject({ attempted: 1, done: 1 });
    expect((await prisma.syncOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("DONE");
  });

  it("leaves a fresh PROCESSING row alone - another run may still be on it", async () => {
    const root = await admin();
    const row = await stuckRow(root, 30_000);
    expect(await processOutbox()).toMatchObject({ attempted: 0 });
    expect((await prisma.syncOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PROCESSING");
  });

  it("resets PROCESSING rows to PENDING once when the scheduler starts", async () => {
    const root = await admin();
    const row = await stuckRow(root, 30_000);
    // Nothing else can be mid-flight when the process has just started.
    await recoverProcessingRows();
    expect((await prisma.syncOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PENDING");
    await prisma.syncOutbox.update({ where: { id: row.id }, data: { status: "PROCESSING" } });
    const previous = process.env.QBO_SYNC_INTERVAL_MS;
    process.env.QBO_SYNC_INTERVAL_MS = "3600000";
    const stop = startSyncScheduler();
    process.env.QBO_SYNC_INTERVAL_MS = previous;
    try {
      expect(stop).not.toBeNull();
      await expect.poll(async () => (await prisma.syncOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PENDING");
    } finally {
      stop?.();
    }
  });
});
