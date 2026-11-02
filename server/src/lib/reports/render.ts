import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { Cell, ReportResult, ResultColumn } from "./engine.js";
import type { ValueKind } from "./sources.js";
import type { ReportSpec } from "./spec.js";

// Report renderers for export and email: CSV, XLSX (with subtotal rows) and
// PDF, all from the same flattened rows, so a file downloaded from the
// runner and one a schedule mails look the same.

export interface RenderedReport {
  title: string;
  subtitle: string;
  company?: string;
  preparedAt: Date;
  rowDims: { key: string; label: string }[];
  result: ReportResult;
  presentation: ReportSpec["presentation"];
}

export type FlatRowKind = "row" | "group" | "subtotal" | "total";
export interface FlatRow {
  kind: FlatRowKind;
  cells: Cell[];
  depth?: number;
}
export interface Flat {
  header: string[];
  kinds: ValueKind[];
  rows: FlatRow[];
}

const NUMERIC: ValueKind[] = ["qty", "money", "cost", "count", "pct", "rate"];
export const isNumeric = (k: ValueKind) => NUMERIC.includes(k);

function columnLabel(c: ResultColumn, pivoted: boolean): string {
  const sub = c.sub === "previousPeriod" ? " Prev. Period" : c.sub === "previousYear" ? " Prev. Year" : c.sub === "pctOfRow" ? " % of Row" : c.sub === "pctOfColumn" ? " % of Column" : "";
  return pivoted ? `${c.measureLabel ?? c.measure} ${c.label}${sub}` : `${c.label}${sub}`;
}

const sortValues = (a: (string | null)[], b: (string | null)[]) => {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === null) return 1;
    if (y === null) return -1;
    const c = x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
    if (c !== 0) return c;
  }
  return 0;
};

// The grid as rows of cells, the way the screen lays it out: summary rows
// with subtotals after each leading group and a total; detail rows under a
// group heading with a subtotal per group and a total.
export function flatten(r: RenderedReport): Flat {
  const { result, rowDims } = r;
  const label = (dim: string, v: string | null) => (v === null || v === "" ? "(none)" : (result.labels[dim]?.[v] ?? v));
  const pivoted = result.kind === "summary" && result.columns.some((c) => c.pivot !== null && c.pivot !== undefined);
  const depth = rowDims.length;
  const rows: FlatRow[] = [];
  if (result.kind === "summary") {
    const header = [rowDims.map((d) => d.label).join(" / ") || "", ...result.columns.map((c) => columnLabel(c, pivoted))];
    const kinds: ValueKind[] = ["text", ...result.columns.map((c) => c.kind)];
    const subtotalFor = (vals: (string | null)[], k: number) => result.subtotals.find((st) => Object.keys(st.dims).length === k && rowDims.slice(0, k).every((d, i) => st.dims[d.key] === vals[i]));
    let prev: (string | null)[] = [];
    const closeFrom = (level: number, vals: (string | null)[]) => {
      for (let k = depth - 1; k >= level; k--) {
        if (k === 0) continue;
        const st = subtotalFor(vals, k);
        rows.push({ kind: "subtotal", depth: k - 1, cells: [`Total ${label(rowDims[k - 1].key, vals[k - 1])}`, ...result.columns.map((c) => st?.cells[c.key] ?? null)] });
      }
    };
    for (const row of result.rows) {
      const vals = rowDims.map((d) => row.dims[d.key] ?? null);
      let firstDiff = 0;
      while (firstDiff < depth - 1 && prev.length > 0 && prev[firstDiff] === vals[firstDiff]) firstDiff++;
      if (prev.length > 0 && depth > 1) closeFrom(firstDiff + 1, prev);
      for (let k = firstDiff; k < depth - 1; k++) rows.push({ kind: "group", depth: k, cells: [label(rowDims[k].key, vals[k]), ...result.columns.map(() => null)] });
      rows.push({ kind: "row", depth: Math.max(0, depth - 1), cells: [depth === 0 ? "Total" : label(rowDims[depth - 1].key, vals[depth - 1]), ...result.columns.map((c) => row.cells[c.key] ?? null)] });
      prev = vals;
    }
    if (prev.length > 0 && depth > 1) closeFrom(1, prev);
    if (depth > 0 && result.rows.length > 0) rows.push({ kind: "total", cells: ["Total", ...result.columns.map((c) => result.total[c.key] ?? null)] });
    return { header, kinds, rows };
  }
  const header = result.columns.map((c) => c.label);
  const kinds = result.columns.map((c) => c.kind);
  const groupKey = (row: ReportResult["rows"][number]) => JSON.stringify(rowDims.map((d) => row.dims[d.key] ?? null));
  const subtotalFor = (vals: (string | null)[]) => result.subtotals.find((st) => rowDims.every((d, i) => st.dims[d.key] === vals[i]));
  let prevKey: string | null = null;
  const pushSubtotal = (key: string) => {
    const vals = JSON.parse(key) as (string | null)[];
    const st = subtotalFor(vals);
    if (st) rows.push({ kind: "subtotal", cells: result.columns.map((c, i) => (i === 0 ? `Total ${rowDims.map((d, j) => label(d.key, vals[j])).join(" · ")}` : c.sum ? (st.cells[c.key] ?? null) : null)) });
  };
  for (const row of result.rows) {
    const key = groupKey(row);
    if (depth > 0 && key !== prevKey) {
      if (prevKey !== null) pushSubtotal(prevKey);
      const vals = JSON.parse(key) as (string | null)[];
      rows.push({ kind: "group", cells: result.columns.map((_, i) => (i === 0 ? rowDims.map((d, j) => label(d.key, vals[j])).join(" · ") : null)) });
      prevKey = key;
    }
    rows.push({ kind: "row", cells: result.columns.map((c) => (c.dimension && !isNumeric(c.kind) ? label(c.dimension, row.cells[c.key] === null ? null : String(row.cells[c.key])) : (row.cells[c.key] ?? null))) });
  }
  if (prevKey !== null) pushSubtotal(prevKey);
  if (result.rows.length > 0) rows.push({ kind: "total", cells: result.columns.map((c, i) => (i === 0 ? "Total" : c.sum ? (result.total[c.key] ?? null) : null)) });
  void sortValues;
  return { header, kinds, rows };
}

// ---- text formatting (PDF, CSV keeps raw numbers) --------------------------

export function formatValue(kind: ValueKind, v: Cell, presentation: ReportSpec["presentation"] = {}): string {
  if (v === null || v === undefined || v === "") return "";
  if (!isNumeric(kind)) return String(v);
  let n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (presentation.divideBy1000 && (kind === "money" || kind === "cost" || kind === "qty")) n /= 1000;
  const abs = Math.abs(n);
  let text =
    kind === "money" || kind === "cost" || kind === "rate"
      ? abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: kind === "rate" ? 4 : 2 })
      : kind === "pct"
        ? `${abs.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
        : abs.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n < 0) text = presentation.negativeStyle === "parens" ? `(${text})` : `-${text}`;
  return text;
}

// ---- CSV -------------------------------------------------------------------

// Same rules as src/lib/csv.ts csvCell: formulas neutralised, quotes doubled.
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+@\t\r]/.test(v) || (/^-/.test(v) && !/^-\d+(\.\d+)?$/.test(v))) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function renderCsv(reports: RenderedReport[]): Buffer {
  const lines: string[] = [];
  reports.forEach((r, i) => {
    if (reports.length > 1) {
      if (i > 0) lines.push("");
      lines.push(csvCell(r.title));
      lines.push(csvCell(r.subtitle));
    }
    const flat = flatten(r);
    lines.push(flat.header.map(csvCell).join(","));
    for (const row of flat.rows) lines.push(row.cells.map((c) => csvCell(c === null ? "" : String(c))).join(","));
  });
  return Buffer.from("﻿" + lines.join("\n"), "utf8");
}

// ---- XLSX ------------------------------------------------------------------

const NUM_FMT: Partial<Record<ValueKind, string>> = { money: "#,##0.00;(#,##0.00)", cost: "#,##0.00;(#,##0.00)", rate: "#,##0.00##", qty: "#,##0.##", count: "#,##0", pct: '0.0"%"' };

export async function renderXlsx(reports: RenderedReport[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Splice";
  const used = new Set<string>();
  for (const r of reports) {
    let name = r.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "Report";
    for (let n = 2; used.has(name); n++) name = `${name.slice(0, 25)} ${n}`;
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }] });
    const flat = flatten(r);
    ws.addRow([r.company ?? ""]).font = { size: 10 };
    ws.addRow([r.title]).font = { bold: true, size: 14 };
    ws.addRow([r.subtitle]).font = { italic: true, size: 10 };
    const head = ws.addRow(flat.header);
    head.font = { bold: true };
    head.border = { bottom: { style: "thin" } };
    for (const row of flat.rows) {
      const x = ws.addRow(row.cells.map((c) => (c === null ? null : c)));
      if (row.kind === "subtotal" || row.kind === "total" || row.kind === "group") x.font = { bold: true };
      if (row.kind === "total") x.border = { top: { style: "medium" } };
      if (row.kind === "subtotal") x.border = { top: { style: "thin" } };
      if (row.depth) x.getCell(1).alignment = { indent: row.depth };
    }
    flat.kinds.forEach((k, i) => {
      const col = ws.getColumn(i + 1);
      const fmt = NUM_FMT[k];
      if (fmt) col.numFmt = fmt;
      col.alignment = isNumeric(k) ? { horizontal: "right" } : undefined;
      const longest = Math.max(flat.header[i]?.length ?? 0, ...flat.rows.slice(0, 500).map((row) => String(row.cells[i] ?? "").length));
      col.width = Math.min(48, Math.max(10, longest + 2));
    });
    if (r.presentation.footer) ws.addRow([r.presentation.footer]).font = { italic: true, size: 9 };
    if (r.presentation.showDatePrepared !== false) ws.addRow([`Prepared ${r.preparedAt.toLocaleString("en-US")}`]).font = { size: 9 };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- PDF -------------------------------------------------------------------

export function renderPdf(reports: RenderedReport[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    reports.forEach((r, index) => {
      if (index > 0) doc.addPage();
      const flat = flatten(r);
      if (r.company && r.presentation.showCompany !== false) doc.font("Helvetica").fontSize(10).text(r.company);
      doc.font("Helvetica-Bold").fontSize(15).text(r.title);
      doc.font("Helvetica").fontSize(10).fillColor("#555").text(r.subtitle).fillColor("#000");
      doc.moveDown(0.6);

      // Column widths from content, text columns get what the numbers leave.
      const n = flat.header.length;
      const measure = (s: string, bold = false) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).widthOfString(s);
      const want = flat.header.map((h, i) => Math.max(measure(h, true), ...flat.rows.slice(0, 400).map((row) => measure(formatValue(flat.kinds[i], row.cells[i], r.presentation)))) + 8);
      const total = want.reduce((a, b) => a + b, 0);
      const widths = total <= pageWidth ? want.map((w) => w + (pageWidth - total) / n) : want.map((w) => (w / total) * pageWidth);
      const rowHeight = 14;
      const drawHeader = () => {
        let x = doc.page.margins.left;
        const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(8);
        flat.header.forEach((h, i) => {
          doc.text(h, x + 2, y, { width: widths[i] - 4, align: isNumeric(flat.kinds[i]) ? "right" : "left", lineBreak: false, ellipsis: true });
          x += widths[i];
        });
        doc.moveTo(doc.page.margins.left, y + rowHeight - 2).lineTo(doc.page.margins.left + pageWidth, y + rowHeight - 2).lineWidth(0.8).stroke();
        doc.y = y + rowHeight + 2;
      };
      drawHeader();
      for (const row of flat.rows) {
        if (doc.y + rowHeight > bottom() - 14) {
          doc.addPage();
          drawHeader();
        }
        const bold = row.kind !== "row";
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
        const y = doc.y;
        if (row.kind === "total") doc.moveTo(doc.page.margins.left, y - 1).lineTo(doc.page.margins.left + pageWidth, y - 1).lineWidth(1).stroke();
        let x = doc.page.margins.left;
        row.cells.forEach((c, i) => {
          const text = formatValue(flat.kinds[i], c, r.presentation);
          const indent = i === 0 && row.depth ? row.depth * 10 : 0;
          const red = r.presentation.negativeStyle === "red" && typeof c === "number" && c < 0;
          if (red) doc.fillColor("#c62828");
          doc.text(text, x + 2 + indent, y, { width: widths[i] - 4 - indent, align: isNumeric(flat.kinds[i]) ? "right" : "left", lineBreak: false, ellipsis: true });
          if (red) doc.fillColor("#000");
          x += widths[i];
        });
        doc.y = y + rowHeight;
      }
      if (flat.rows.length === 0) doc.font("Helvetica").fontSize(9).fillColor("#555").text("Nothing in this period for these filters.", doc.page.margins.left, doc.y + 4).fillColor("#000");
    });

    // Footer on every page: footer line, prepared date, page numbers.
    const range = doc.bufferedPageRange();
    const footerParts = (r: RenderedReport, page: number, count: number) => [
      r.presentation.footer ?? "",
      r.presentation.showDatePrepared !== false ? `Prepared ${r.preparedAt.toLocaleString("en-US")}` : "",
      r.presentation.showPageNumbers !== false ? `Page ${page} of ${count}` : "",
    ];
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const r = reports[Math.min(reports.length - 1, 0)];
      const [left, middle, right] = footerParts(r, i - range.start + 1, range.count);
      const y = doc.page.height - doc.page.margins.bottom + 6;
      doc.font("Helvetica").fontSize(7).fillColor("#555");
      doc.text(left, doc.page.margins.left, y, { width: pageWidth / 3, align: "left", lineBreak: false });
      doc.text(middle, doc.page.margins.left + pageWidth / 3, y, { width: pageWidth / 3, align: "center", lineBreak: false });
      doc.text(right, doc.page.margins.left + (2 * pageWidth) / 3, y, { width: pageWidth / 3, align: "right", lineBreak: false });
      doc.fillColor("#000");
    }
    doc.end();
  });
}

export type ExportFormat = "csv" | "xlsx" | "pdf";
export const EXPORT_FORMATS: ExportFormat[] = ["csv", "xlsx", "pdf"];
export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export async function render(format: ExportFormat, reports: RenderedReport[]): Promise<Buffer> {
  switch (format) {
    case "csv":
      return renderCsv(reports);
    case "xlsx":
      return renderXlsx(reports);
    case "pdf":
      return renderPdf(reports);
  }
}

export function fileName(title: string, format: ExportFormat): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report"}.${format}`;
}
