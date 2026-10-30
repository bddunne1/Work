// Regression tests for the defects found in the October review
// (docs/review/open-bugs.md). One describe per item.
import { beforeEach, describe, expect, it } from "vitest";
import { fakeQuickBooks } from "../src/integrations/quickbooks/fake.js";
import { prisma } from "../src/prisma.js";
import { admin, issueInvoiceFor, makeCustomer, makeItem, ok, orderReadyToShip, resetDb, ship } from "./helpers.js";

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
