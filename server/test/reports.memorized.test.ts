import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { runDueSchedules, runSchedule } from "../src/integrations/reportSchedules.js";
import { fakeQuickBooks } from "../src/integrations/quickbooks/fake.js";
import { cronMatches, isValidCron, lastDue, parseCron } from "../src/lib/reports/cron.js";
import { prisma } from "../src/prisma.js";
import request from "supertest";
import { admin, app, as, issueInvoiceFor, makeCustomer, makeItem, ok, orderReadyToShip, resetDb, ship, type Client } from "./helpers.js";

// A POST whose answer is a file: the body comes back as a Buffer.
function download(c: Client, path: string, body: unknown): Promise<{ status: number; body: Buffer; type: string }> {
  return request(app)
    .post(path)
    .set("Authorization", `Bearer ${c.token}`)
    .send(body as object)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    })
    .then((r) => ({ status: r.status, body: r.body as Buffer, type: r.headers["content-type"] ?? "" }));
}

// Memorized reports, groups, export and schedules (phase 5) over a small
// scene: Acme's shipped order of 4 x BR-1001 @ 2.50, invoiced.
let root: Client;
let clerk: Client;

const summary = { source: "sales-order-lines", kind: "summary", measures: ["qtyOrdered", "amount"], rows: ["customer"], columns: null, filters: [], sort: null, dateRange: { preset: "all" }, subColumns: [], presentation: {} };
const detail = { ...summary, kind: "detail", measures: [], rows: ["customer"], fields: ["soNumber", "item", "qtyOrdered", "amount"], presentation: { title: "Order lines by customer", footer: "Internal" } };

beforeAll(async () => {
  await resetDb();
  fakeQuickBooks.reset();
  root = await admin();
  clerk = await as("clerk", { permissions: { reports: "edit", "order-entry": "view" } });
  await makeItem(root, "BR-1001", 100, 2.5);
  const acme = await makeCustomer(root, "Acme Fabrication");
  const o = ok(await ship(root, await orderReadyToShip(root, [{ item: "BR-1001", ordered: 4, rate: 2.5 }], { customerId: acme.id })));
  await issueInvoiceFor(root, o.soNumber);
});

describe("memorized reports", () => {
  it("translates a report memorized on the old page into a spec that opens", async () => {
    const legacy = await prisma.savedReport.create({ data: { name: "Old open orders", dataSourceKey: "sales-orders", filters: { status: "open", customer: "acme" }, columns: ["soNumber", "customer", "total"] } });
    const list = ok(await root.get("/api/saved-reports"));
    const row = list.find((r: any) => r.id === legacy.id);
    expect(row.spec).toMatchObject({ source: "sales-order-lines", kind: "detail", rows: ["soNumber"], dateRange: { preset: "all" } });
    expect(row.spec.filters).toEqual([
      { field: "status", op: "in", values: ["ENTERED", "CHECKED", "ALLOCATED", "BACKORDERED", "PICK_PACKED"] },
      { field: "customer", op: "contains", value: "acme" },
    ]);
    expect((await prisma.savedReport.findUniqueOrThrow({ where: { id: legacy.id } })).spec).not.toBeNull();
    const run = ok(await root.post("/api/reports/run", { spec: row.spec, tzOffset: 0 }));
    expect(run.kind).toBe("detail");
    // Ownerless, so anyone with reports edit may manage it; still shared.
    expect(row).toMatchObject({ shared: true, ownerId: null, canEdit: true, mine: false });
  });

  it("memorizes, shares, groups, updates and deletes by owner or admin", async () => {
    const mine = ok(await clerk.post("/api/saved-reports", { name: "Clerk's private", spec: summary, shared: false }), 201);
    expect(mine).toMatchObject({ name: "Clerk's private", shared: false, mine: true, canEdit: true, ownerName: "clerk", groupName: null });
    const shared = ok(await clerk.post("/api/saved-reports", { name: "Month end lines", spec: detail, shared: true, groupName: "Month End" }), 201);
    expect(shared).toMatchObject({ shared: true, groupName: "Month End" });
    // Admin sees the shared one but not the clerk's private one; the clerk sees both.
    const adminList = ok(await root.get("/api/saved-reports")).map((r: any) => r.name);
    expect(adminList).toContain("Month end lines");
    expect(adminList).not.toContain("Clerk's private");
    expect(ok(await clerk.get("/api/saved-reports")).map((r: any) => r.name)).toEqual(expect.arrayContaining(["Clerk's private", "Month end lines"]));
    // Another login can't change or delete the clerk's shared report; admin can.
    const other = await as("other", { permissions: { reports: "edit" } });
    expect((await other.put(`/api/saved-reports/${shared.id}`, { name: "x" })).status).toBe(403);
    expect((await other.del(`/api/saved-reports/${shared.id}`)).status).toBe(403);
    const renamed = ok(await root.put(`/api/saved-reports/${shared.id}`, { name: "Month end order lines", groupName: "Month End" }));
    expect(renamed.name).toBe("Month end order lines");
    const updated = ok(await clerk.put(`/api/saved-reports/${mine.id}`, { spec: { ...summary, rows: ["item"] }, groupName: "Month End" }));
    expect(updated.spec.rows).toEqual(["item"]);
    expect(ok(await clerk.get("/api/saved-reports/groups"))).toEqual(["Month End"]);
    expect((await other.post("/api/saved-reports", { name: "bad", spec: { source: "nope" } })).status).toBe(400);
    expect((await clerk.del(`/api/saved-reports/${mine.id}`)).status).toBe(204);
    expect(ok(await clerk.get("/api/saved-reports")).map((r: any) => r.id)).not.toContain(mine.id);
  });

  it("runs a group for Print group with every readable report in it", async () => {
    const res = ok(await root.post("/api/reports/groups/Month End/run", { tzOffset: 0 }));
    expect(res.group).toBe("Month End");
    expect(res.reports.map((r: any) => r.name)).toEqual(["Month end order lines"]);
    expect(res.reports[0].result).toMatchObject({ kind: "detail", totalRows: 1 });
    expect(res.reports[0].result.total).toEqual({ qtyOrdered: 4, amount: 10, _count: 1 });
    expect((await root.post("/api/reports/groups/Nothing/run", {})).status).toBe(404);
  });
});

describe("export", () => {
  it("renders CSV with subtotal and total rows", async () => {
    const res = await download(root, "/api/reports/export", { spec: detail, format: "csv", tzOffset: 0, title: "Lines" });
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/text\/csv/);
    const text = res.body.toString("utf8");
    const lines = text.replace(/^﻿/, "").split("\n");
    expect(lines[0]).toBe("S.O. #,Item,Ordered,Amount");
    expect(lines[1]).toBe("Acme Fabrication,,,");
    expect(lines[2]).toMatch(/^\d+,BR-1001,4,10$/);
    expect(lines[3]).toBe("Total Acme Fabrication,,4,10");
    expect(lines[4]).toBe("Total,,4,10");
  });

  it("renders XLSX with a header, bold subtotal and total rows, and PDF", async () => {
    const res = await download(root, "/api/reports/export", { spec: summary, format: "xlsx", tzOffset: 0, title: "Sales" });
    expect(res.status).toBe(200);
    const buf = res.body;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getRow(2).getCell(1).value).toBe("Sales");
    expect(ws.getRow(4).values).toEqual([undefined, "Customer", "Qty Ordered", "Amount"]);
    expect(ws.getRow(5).values).toEqual([undefined, "Acme Fabrication", 4, 10]);
    expect(ws.getRow(6).values).toEqual([undefined, "Total", 4, 10]);
    expect(ws.getRow(6).font?.bold).toBe(true);
    expect(ws.getColumn(3).numFmt).toBe("#,##0.00;(#,##0.00)");
    const pdf = await download(root, "/api/reports/export", { spec: detail, format: "pdf", tzOffset: 0 });
    expect(pdf.status).toBe(200);
    expect(pdf.type).toMatch(/application\/pdf/);
    const pdfBuf = pdf.body;
    expect(pdfBuf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfBuf.length).toBeGreaterThan(1500);
  });

  it("keeps money out of an export for a login that may not see prices", async () => {
    const dock = await as("dock2", { permissions: { reports: "view", "shipment-history": "view" } });
    const res = await download(dock, "/api/reports/export", { spec: detail, format: "csv", tzOffset: 0 });
    expect(res.status).toBe(200);
    expect(res.body.toString("utf8").replace(/^\uFEFF/, "").split("\n")[0]).toBe("S.O. #,Item,Ordered");
  });
});

describe("schedules", () => {
  it("parses and matches cron expressions", () => {
    expect(isValidCron("0 7 * * 1-5")).toBe(true);
    expect(isValidCron("*/15 8-17 * * *")).toBe(true);
    expect(isValidCron("0 7 * *")).toBe(false);
    expect(isValidCron("61 7 * * *")).toBe(false);
    const weekdays = parseCron("30 6 * * 1-5");
    expect(cronMatches(weekdays, new Date(2026, 10, 2, 6, 30))).toBe(true); // Monday 2 Nov 2026
    expect(cronMatches(weekdays, new Date(2026, 10, 1, 6, 30))).toBe(false); // Sunday
    expect(cronMatches(weekdays, new Date(2026, 10, 2, 6, 31))).toBe(false);
    expect(cronMatches(parseCron("0 0 1 * *"), new Date(2026, 11, 1, 0, 0))).toBe(true);
    expect(cronMatches(parseCron("0 9 * * 0"), new Date(2026, 10, 1, 9, 0))).toBe(true);
    expect(lastDue(weekdays, new Date(2026, 10, 2, 6, 34))).toEqual(new Date(2026, 10, 2, 6, 30));
    expect(lastDue(weekdays, new Date(2026, 10, 2, 6, 45))).toBeNull();
  });

  it("is managed by Settings editors, runs as its maker, and records each run", async () => {
    const other = await as("other", { permissions: { reports: "edit" } });
    expect((await other.get("/api/reports/schedules")).status).toBe(403);
    const bad = await root.post("/api/reports/schedules", { groupName: "Month End", cron: "nope", format: "pdf", recipients: ["a@example.com"] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/five cron fields/);
    const s = ok(await root.post("/api/reports/schedules", { groupName: "Month End", cron: "0 7 * * 1-5", format: "xlsx", recipients: ["cfo@example.com", "ops@example.com"] }), 201);
    expect(s).toMatchObject({ active: true, createdBy: "admin", lastRunAt: null });
    // Run now: with SMTP_URL unset the mail is logged, and the run is recorded.
    const run = ok(await root.post(`/api/reports/schedules/${s.id}/run`));
    expect(run).toMatchObject({ sent: false, reports: 1 });
    expect(run.bytes).toBeGreaterThan(1000);
    const after = ok(await root.get("/api/reports/schedules")).find((x: any) => x.id === s.id);
    expect(after.lastRunAt).toBeTruthy();
    expect(after.lastError).toBeNull();
    // The worker runs a schedule whose cron just fired, once.
    await prisma.reportSchedule.update({ where: { id: s.id }, data: { lastRunAt: null } });
    const monday = new Date(2026, 10, 2, 7, 2);
    expect(await runDueSchedules(monday)).toEqual([s.id]);
    expect(await runDueSchedules(monday)).toEqual([]);
    expect(await runDueSchedules(new Date(2026, 10, 1, 7, 2))).toEqual([]);
    // A schedule for an empty group fails and says so.
    const empty = ok(await root.post("/api/reports/schedules", { groupName: "Nothing here", cron: "0 7 * * *", format: "csv", recipients: ["a@example.com"] }), 201);
    expect((await root.post(`/api/reports/schedules/${empty.id}/run`)).status).toBe(400);
    expect((await prisma.reportSchedule.findUniqueOrThrow({ where: { id: empty.id } })).lastError).toMatch(/No memorized report/);
    await expect(runSchedule("missing")).rejects.toThrow(/not found/);
    ok(await root.put(`/api/reports/schedules/${s.id}`, { active: false }));
    expect((await root.del(`/api/reports/schedules/${s.id}`)).status).toBe(204);
  });
});
