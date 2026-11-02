import { Prisma } from "@prisma/client";
import { hasPermission, type AuthedAccount } from "../../middleware/auth.js";
import { prisma } from "../../prisma.js";
import { StaleWhileRefresh } from "../cache.js";
import { HttpError } from "../conflictError.js";
import { canSeeCost, canSeePrices } from "../orderView.js";
import { previousPeriod, previousYear, resolveRange, type ResolvedRange } from "./dates.js";
import { SOURCES, type DetailColumn, type Dimension, type SourceDef, type ValueKind } from "./sources.js";
import { DATE_BUCKETS, type ReportFilter, type ReportSource, type ReportSpec, type SubColumn } from "./spec.js";

// The report engine: one parameterized query per report, built from the
// source definitions in sources.ts. A summary groups by the row dimensions
// (and the column dimension, when the report displays columns by one) with
// GROUPING SETS, so the groups, their row totals, the subtotals of each
// leading dimension, the column totals and the grand total all come back
// from the same scan and the same filters. A detail report pages the
// records and totals them with a second grouped query.

export const MAX_GROUPS = 20_000;
const s = Prisma.sql;

export interface RunContext {
  account: AuthedAccount;
  tzOffset: number;
  page?: number;
  pageSize?: number;
  now?: Date;
}

export type Cell = string | number | null;

export interface ResultColumn {
  key: string;
  label: string;
  kind: ValueKind;
  measure?: string;
  // The measure's own label, for the group header above pivot columns.
  measureLabel?: string;
  pivot?: string | null;
  sub?: SubColumn;
  sum?: boolean;
  dimension?: string;
}

export interface ResultRow {
  dims: Record<string, string | null>;
  cells: Record<string, Cell>;
  link?: string;
}

export interface ReportResult {
  kind: "summary" | "detail";
  columns: ResultColumn[];
  rows: ResultRow[];
  subtotals: { dims: Record<string, string | null>; cells: Record<string, Cell> }[];
  total: Record<string, Cell>;
  page?: number;
  pageSize?: number;
  totalRows?: number;
  truncated: boolean;
  generatedAt: string;
  range: ResolvedRange;
  hidden: string[];
  labels: Record<string, Record<string, string>>;
}

// ---- access ----------------------------------------------------------------

export function canReadSource(account: AuthedAccount, source: SourceDef): boolean {
  return account.role === "ADMIN" || source.viewPages.some((p) => hasPermission(account, p, "view"));
}

// Money is for the office and cost for purchasing (lib/orderView.ts): a
// measure or column of either kind is left out for everyone else.
function canSeeKind(account: AuthedAccount, kind: ValueKind): boolean {
  if (kind === "money" || kind === "rate") return canSeePrices(account);
  if (kind === "cost") return canSeeCost(account);
  return true;
}

// ---- dimensions ------------------------------------------------------------

function localDate(source: SourceDef, tzOffset: number): Prisma.Sql | null {
  if (!source.dateField) return null;
  if (source.dateField.type === "date") return source.dateField.sql;
  // The timestamp's calendar day where the browser is. tzOffset is a
  // validated integer and is inlined so the expression carries no bound
  // parameter: the same text must appear in SELECT, GROUP BY and GROUPING().
  return s`((${source.dateField.sql}) - make_interval(mins => ${Prisma.raw(String(Math.trunc(tzOffset)))}))::date`;
}

function bucketDimensions(source: SourceDef, tzOffset: number): Dimension[] {
  const d = localDate(source, tzOffset);
  if (!d) return [];
  const label = source.dateField!.label;
  return [
    { key: "day", label: `${label} (Day)`, sql: s`to_char(${d}, 'YYYY-MM-DD')` },
    { key: "week", label: `${label} (Week of)`, sql: s`to_char(date_trunc('week', ${d}), 'YYYY-MM-DD')` },
    { key: "month", label: `${label} (Month)`, sql: s`to_char(${d}, 'YYYY-MM')` },
    { key: "quarter", label: `${label} (Quarter)`, sql: s`(to_char(${d}, 'YYYY') || '-Q' || to_char(${d}, 'Q'))` },
    { key: "year", label: `${label} (Year)`, sql: s`to_char(${d}, 'YYYY')` },
  ];
}

function dimensionMap(source: SourceDef, tzOffset: number): Map<string, Dimension> {
  const map = new Map<string, Dimension>();
  for (const d of source.dimensions) map.set(d.key, d);
  for (const d of bucketDimensions(source, tzOffset)) map.set(d.key, d);
  return map;
}

// ---- filters ---------------------------------------------------------------

const NUMERIC: ValueKind[] = ["qty", "money", "cost", "count", "pct", "rate"];

function filterClause(expr: Prisma.Sql, kind: ValueKind, f: ReportFilter): Prisma.Sql {
  const numeric = NUMERIC.includes(kind);
  const val = (v: string | undefined): Prisma.Sql => {
    if (numeric) {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new HttpError(400, `"${v}" is not a number for the ${f.field} filter.`);
      return s`${n}`;
    }
    return s`${v ?? ""}`;
  };
  const e = numeric ? expr : s`(${expr})::text`;
  switch (f.op) {
    case "equals":
      return s`${e} = ${val(f.value)}`;
    case "contains":
      return s`${e} ILIKE ${"%" + (f.value ?? "").replace(/[%_\\]/g, (c) => `\\${c}`) + "%"}`;
    case "in": {
      const values = f.values ?? [];
      if (values.length === 0) return s`FALSE`;
      return s`${e} IN (${Prisma.join(values.map((v) => val(v)))})`;
    }
    case "between": {
      const [a, b] = f.values ?? [];
      const parts: Prisma.Sql[] = [];
      if (a !== undefined && a !== "") parts.push(s`${e} >= ${val(a)}`);
      if (b !== undefined && b !== "") parts.push(s`${e} <= ${val(b)}`);
      return parts.length ? s`(${Prisma.join(parts, " AND ")})` : s`TRUE`;
    }
    case "gte":
      return s`${e} >= ${val(f.value)}`;
    case "lte":
      return s`${e} <= ${val(f.value)}`;
    case "isEmpty":
      return s`(${expr} IS NULL OR (${expr})::text = '')`;
  }
}

interface Built {
  source: SourceDef;
  dims: Map<string, Dimension>;
  where: Prisma.Sql;
  range: ResolvedRange;
}

function buildWhere(spec: ReportSpec, source: SourceDef, dims: Map<string, Dimension>, tzOffset: number, range: ResolvedRange): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (source.where) parts.push(source.where);
  const d = localDate(source, tzOffset);
  if (d) {
    if (range.from) parts.push(s`${d} >= ${range.from}::date`);
    if (range.to) parts.push(s`${d} <= ${range.to}::date`);
  }
  for (const f of spec.filters) {
    const dim = dims.get(f.field);
    if (dim) {
      parts.push(filterClause(dim.sql, "text", f));
      continue;
    }
    const col = source.detail.find((c) => c.key === f.field && !c.hidden);
    if (!col) throw new HttpError(400, `"${f.field}" is not something ${source.label} can be filtered on.`);
    parts.push(filterClause(col.sql, col.kind, f));
  }
  return parts.length ? s`WHERE ${Prisma.join(parts, " AND ")}` : Prisma.empty;
}

function labelsFor(source: SourceDef): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const d of source.dimensions) if (d.options) out[d.key] = Object.fromEntries(d.options.map((o) => [o.value, o.label]));
  return out;
}

function round(kind: ValueKind, v: unknown): Cell {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  if (kind === "money" || kind === "cost") return Math.round(n * 100) / 100;
  if (kind === "pct") return Math.round(n * 10) / 10;
  return n;
}

// Refuses a grouping that would produce more rows than anyone can read.
async function assertGroupCount(from: Prisma.Sql, where: Prisma.Sql, exprs: Prisma.Sql[], what: string): Promise<void> {
  if (exprs.length === 0) return;
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS "n" FROM (SELECT 1 FROM ${from} ${where} GROUP BY ${Prisma.join(exprs)} LIMIT ${MAX_GROUPS + 1}) g`;
  if ((rows[0]?.n ?? 0) > MAX_GROUPS) {
    throw new HttpError(400, `This report would have more than ${MAX_GROUPS.toLocaleString()} rows of ${what}. Add a filter or total by something broader.`);
  }
}

// ---- grouped query (shared by summary and detail subtotals) ----------------

interface Agg {
  key: string;
  sql: Prisma.Sql;
  kind: ValueKind;
}

interface GroupedRow {
  // Which of the grouping expressions this row is grouped by (true) or
  // aggregated over (false), in expression order.
  on: boolean[];
  values: (string | null)[];
  cells: Record<string, Cell>;
}

function dedupeSets(sets: number[][]): number[][] {
  const seen = new Set<string>();
  return sets.filter((set) => {
    const k = set.join(",");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Every grouping set the report needs: the full grouping, every leading
// prefix of the row dimensions (with and without the pivot) and the whole.
function groupingSets(rowCount: number, hasPivot: boolean): number[][] {
  const rows = Array.from({ length: rowCount }, (_, i) => i);
  const pivot = hasPivot ? [rowCount] : [];
  const sets: number[][] = [[...rows, ...pivot]];
  if (hasPivot) sets.push(rows);
  for (let k = rowCount - 1; k >= 1; k--) {
    const prefix = rows.slice(0, k);
    if (hasPivot) sets.push([...prefix, ...pivot]);
    sets.push(prefix);
  }
  if (hasPivot) sets.push(pivot);
  sets.push([]);
  return dedupeSets(sets);
}

async function grouped(from: Prisma.Sql, where: Prisma.Sql, exprs: Prisma.Sql[], sets: number[][], aggs: Agg[]): Promise<GroupedRow[]> {
  const select: Prisma.Sql[] = [];
  if (exprs.length > 0) select.push(s`GROUPING(${Prisma.join(exprs)}) AS "g"`);
  exprs.forEach((e, i) => select.push(s`(${e})::text AS ${Prisma.raw(`"d${i}"`)}`));
  for (const a of aggs) select.push(s`${a.sql} AS ${Prisma.raw(`"${a.key}"`)}`);
  const groupBy =
    exprs.length > 0
      ? s`GROUP BY GROUPING SETS (${Prisma.join(
          sets.map((set) => (set.length ? s`(${Prisma.join(set.map((i) => exprs[i]))})` : s`()`)),
          ", "
        )})`
      : Prisma.empty;
  const raw = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT ${Prisma.join(select)} FROM ${from} ${where} ${groupBy}`;
  const n = exprs.length;
  return raw.map((r) => {
    const g = Number(r.g ?? 0);
    const on = exprs.map((_, i) => (g & (1 << (n - 1 - i))) === 0);
    const values = exprs.map((_, i) => (r[`d${i}`] === null || r[`d${i}`] === undefined ? null : String(r[`d${i}`])));
    const cells: Record<string, Cell> = {};
    for (const a of aggs) cells[a.key] = round(a.kind, r[a.key]);
    return { on, values, cells };
  });
}

const groupKey = (values: (string | null)[]) => JSON.stringify(values);
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

// ---- summary ---------------------------------------------------------------

interface SummaryCore {
  pivots: string[];
  // group key -> pivot (or "" when no pivot) -> cells
  groups: Map<string, { values: (string | null)[]; byPivot: Map<string, Record<string, Cell>> }>;
  rowTotals: Map<string, Record<string, Cell>>;
  // prefix length -> group key -> pivot -> cells
  subtotals: Map<number, Map<string, { values: (string | null)[]; byPivot: Map<string, Record<string, Cell>>; total: Record<string, Cell> }>>;
  colTotals: Map<string, Record<string, Cell>>;
  grand: Record<string, Cell>;
}

async function summaryCore(b: Built, rowExprs: Prisma.Sql[], pivotExpr: Prisma.Sql | null, aggs: Agg[]): Promise<SummaryCore> {
  const exprs = pivotExpr ? [...rowExprs, pivotExpr] : rowExprs;
  const rows = await grouped(b.source.from, b.where, exprs, groupingSets(rowExprs.length, Boolean(pivotExpr)), aggs);
  const n = rowExprs.length;
  const core: SummaryCore = { pivots: [], groups: new Map(), rowTotals: new Map(), subtotals: new Map(), colTotals: new Map(), grand: {} };
  const pivotSet = new Set<string>();
  for (const r of rows) {
    const rowOn = r.on.slice(0, n);
    const pivotOn = pivotExpr ? r.on[n] : false;
    const k = rowOn.filter(Boolean).length;
    const prefixOnly = rowOn.every((v, i) => (i < k ? v : !v));
    if (!prefixOnly) continue;
    const values = r.values.slice(0, k);
    const pivot = pivotOn ? (r.values[n] ?? "") : "";
    if (pivotOn) pivotSet.add(pivot);
    if (k === n && n > 0) {
      const key = groupKey(values);
      if (pivotExpr && !pivotOn) {
        core.rowTotals.set(key, r.cells);
      } else {
        const g = core.groups.get(key) ?? { values, byPivot: new Map() };
        g.byPivot.set(pivot, r.cells);
        core.groups.set(key, g);
        if (!pivotExpr) core.rowTotals.set(key, r.cells);
      }
    } else if (k === 0) {
      if (pivotOn) core.colTotals.set(pivot, r.cells);
      else core.grand = r.cells;
    } else {
      const level = core.subtotals.get(k) ?? new Map();
      const key = groupKey(values);
      const g = level.get(key) ?? { values, byPivot: new Map(), total: {} };
      if (pivotOn) g.byPivot.set(pivot, r.cells);
      else g.total = r.cells;
      level.set(key, g);
      core.subtotals.set(k, level);
    }
  }
  core.pivots = [...pivotSet].sort((a, b2) => sortValues([a], [b2]));
  return core;
}

function pct(part: Cell, whole: Cell): Cell {
  if (typeof part !== "number" || typeof whole !== "number" || whole === 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

async function runSummary(spec: ReportSpec, b: Built, ctx: RunContext, hidden: string[]): Promise<ReportResult> {
  const { source, dims } = b;
  const rowDims = spec.rows.map((k) => {
    const d = dims.get(k);
    if (!d) throw new HttpError(400, `"${k}" is not something ${source.label} can be totaled by.`);
    return d;
  });
  const pivotDim = spec.columns ? dims.get(spec.columns.by) : null;
  if (spec.columns && !pivotDim) throw new HttpError(400, `"${spec.columns.by}" is not something ${source.label} can display columns by.`);
  if (pivotDim && rowDims.some((d) => d.key === pivotDim.key)) throw new HttpError(400, "The column dimension can't also be a row dimension.");

  const measures = spec.measures.map((k) => {
    const m = source.measures.find((x) => x.key === k);
    if (!m) throw new HttpError(400, `"${k}" is not a measure of ${source.label}.`);
    return m;
  });
  if (measures.length === 0) throw new HttpError(400, "Choose at least one measure.");
  const visible = measures.filter((m) => canSeeKind(ctx.account, m.kind));
  for (const m of measures) if (!visible.includes(m)) hidden.push(m.key);
  const aggs: Agg[] = visible.map((m) => ({ key: m.key, sql: m.sql, kind: m.kind }));

  const rowExprs = rowDims.map((d) => d.sql);
  await assertGroupCount(source.from, b.where, rowExprs, rowDims.map((d) => d.label).join(" and "));
  const core = await summaryCore(b, rowExprs, pivotDim?.sql ?? null, aggs);

  // Previous Period / Previous Year: the same report over the shifted range.
  const compare = new Map<SubColumn, SummaryCore>();
  for (const sub of spec.subColumns) {
    if (sub !== "previousPeriod" && sub !== "previousYear") continue;
    const shifted = sub === "previousPeriod" ? previousPeriod(b.range) : previousYear(b.range);
    if (!shifted) continue;
    const where = buildWhere(spec, source, dims, ctx.tzOffset, shifted);
    compare.set(sub, await summaryCore({ ...b, where, range: shifted }, rowExprs, pivotDim?.sql ?? null, aggs));
  }
  const pctSubs = spec.subColumns.filter((x) => x === "pctOfRow" || x === "pctOfColumn");

  // Columns: per measure, one per pivot value plus the row total.
  const pivots = pivotDim ? [...new Set([...core.pivots, ...[...compare.values()].flatMap((c) => c.pivots)])].sort((x, y) => sortValues([x], [y])) : [];
  const columns: ResultColumn[] = [];
  const baseKeys: { key: string; measure: string; pivot: string | null }[] = [];
  for (const m of visible) {
    if (pivotDim) {
      for (const p of pivots) baseKeys.push({ key: `${m.key}|${p}`, measure: m.key, pivot: p });
      baseKeys.push({ key: `${m.key}|total`, measure: m.key, pivot: "total" });
    } else baseKeys.push({ key: m.key, measure: m.key, pivot: null });
  }
  const labels = labelsFor(source);
  const pivotLabel = (p: string | null) => (p === null ? null : p === "total" ? "Total" : (pivotDim && labels[pivotDim.key]?.[p]) || (p === "" ? "(none)" : p));
  for (const bk of baseKeys) {
    const m = visible.find((x) => x.key === bk.measure)!;
    const label = bk.pivot === null ? m.label : `${pivotLabel(bk.pivot)}`;
    columns.push({ key: bk.key, label, kind: m.kind, measure: m.key, measureLabel: m.label, pivot: bk.pivot });
    for (const sub of compare.keys()) columns.push({ key: `${bk.key}~${sub}`, label, kind: m.kind, measure: m.key, measureLabel: m.label, pivot: bk.pivot, sub });
    for (const sub of pctSubs) {
      if (sub === "pctOfRow" && !pivotDim) continue;
      columns.push({ key: `${bk.key}~${sub}`, label, kind: "pct", measure: m.key, measureLabel: m.label, pivot: bk.pivot, sub });
    }
  }

  const cellsFor = (c: SummaryCore, byPivot: Map<string, Record<string, Cell>> | undefined, total: Record<string, Cell> | undefined, colTotals: Map<string, Record<string, Cell>>, grand: Record<string, Cell>) => {
    const out: Record<string, Cell> = {};
    for (const bk of baseKeys) {
      const base = bk.pivot === null ? (total?.[bk.measure] ?? null) : bk.pivot === "total" ? (total?.[bk.measure] ?? null) : (byPivot?.get(bk.pivot)?.[bk.measure] ?? null);
      out[bk.key] = base;
      for (const sub of pctSubs) {
        if (sub === "pctOfRow") {
          if (!pivotDim) continue;
          out[`${bk.key}~${sub}`] = pct(base, total?.[bk.measure] ?? null);
        } else {
          const whole = bk.pivot === null || bk.pivot === "total" ? grand[bk.measure] : colTotals.get(bk.pivot)?.[bk.measure];
          out[`${bk.key}~${sub}`] = pct(base, whole ?? null);
        }
      }
    }
    void c;
    return out;
  };
  const mergeCompare = (out: Record<string, Cell>, lookup: (c: SummaryCore) => { byPivot?: Map<string, Record<string, Cell>>; total?: Record<string, Cell> }) => {
    for (const [sub, c] of compare) {
      const { byPivot, total } = lookup(c);
      for (const bk of baseKeys) {
        out[`${bk.key}~${sub}`] = bk.pivot === null || bk.pivot === "total" ? (total?.[bk.measure] ?? null) : (byPivot?.get(bk.pivot)?.[bk.measure] ?? null);
      }
    }
  };

  const rowKeys = new Set<string>([...core.groups.keys(), ...[...compare.values()].flatMap((c) => [...c.groups.keys()])]);
  const rows: ResultRow[] = [];
  for (const key of rowKeys) {
    const values = (core.groups.get(key) ?? [...compare.values()].map((c) => c.groups.get(key)).find(Boolean))!.values;
    const cells = cellsFor(core, core.groups.get(key)?.byPivot, core.rowTotals.get(key), core.colTotals, core.grand);
    mergeCompare(cells, (c) => ({ byPivot: c.groups.get(key)?.byPivot, total: c.rowTotals.get(key) }));
    rows.push({ dims: Object.fromEntries(rowDims.map((d, i) => [d.key, values[i] ?? null])), cells });
  }

  const dir = spec.sort?.dir === "desc" ? -1 : 1;
  const sortMeasure = spec.sort && visible.some((m) => m.key === spec.sort!.by) ? spec.sort.by : null;
  const sortDim = spec.sort && rowDims.findIndex((d) => d.key === spec.sort!.by);
  rows.sort((x, y) => {
    const xs = rowDims.map((d) => x.dims[d.key]);
    const ys = rowDims.map((d) => y.dims[d.key]);
    if (sortMeasure) {
      const k = pivotDim ? `${sortMeasure}|total` : sortMeasure;
      const a = x.cells[k];
      const b2 = y.cells[k];
      const c = (typeof a === "number" ? a : -Infinity) - (typeof b2 === "number" ? b2 : -Infinity);
      if (c !== 0) return c * dir;
    } else if (sortDim !== null && sortDim !== undefined && sortDim >= 0) {
      const c = sortValues([xs[sortDim]], [ys[sortDim]]);
      if (c !== 0) return c * dir;
    }
    return sortValues(xs, ys);
  });

  const subtotals: ReportResult["subtotals"] = [];
  for (const [level, groups] of [...core.subtotals.entries()].sort((a, b2) => a[0] - b2[0])) {
    for (const g of groups.values()) {
      const cells = cellsFor(core, g.byPivot, g.total, core.colTotals, core.grand);
      mergeCompare(cells, (c) => {
        const cg = c.subtotals.get(level)?.get(groupKey(g.values));
        return { byPivot: cg?.byPivot, total: cg?.total };
      });
      subtotals.push({ dims: Object.fromEntries(g.values.map((v, i) => [rowDims[i].key, v])), cells });
    }
  }

  const total = cellsFor(core, core.colTotals, core.grand, core.colTotals, core.grand);
  mergeCompare(total, (c) => ({ byPivot: c.colTotals, total: c.grand }));

  return {
    kind: "summary",
    columns,
    rows,
    subtotals,
    total,
    truncated: false,
    generatedAt: new Date().toISOString(),
    range: b.range,
    hidden,
    labels,
  };
}

// ---- detail ----------------------------------------------------------------

async function runDetail(spec: ReportSpec, b: Built, ctx: RunContext, hidden: string[]): Promise<ReportResult> {
  const { source, dims } = b;
  const rowDims = spec.rows.map((k) => {
    const d = dims.get(k);
    if (!d) throw new HttpError(400, `"${k}" is not something ${source.label} can be grouped by.`);
    return d;
  });
  const wanted = spec.fields && spec.fields.length > 0 ? spec.fields : source.detail.filter((c) => !c.hidden).map((c) => c.key);
  const shown: DetailColumn[] = [];
  for (const k of wanted) {
    const c = source.detail.find((x) => x.key === k && !x.hidden);
    if (!c) throw new HttpError(400, `"${k}" is not a column of ${source.label}.`);
    if (!canSeeKind(ctx.account, c.kind)) {
      hidden.push(c.key);
      continue;
    }
    if (!shown.includes(c)) shown.push(c);
  }
  const selected = [...shown, ...source.detail.filter((c) => c.hidden)];
  const page = ctx.page ?? 1;
  const pageSize = Math.min(ctx.pageSize ?? 100, 500);

  const select: Prisma.Sql[] = selected.map((c) => s`${c.sql} AS ${Prisma.raw(`"${c.key}"`)}`);
  rowDims.forEach((d, i) => select.push(s`(${d.sql})::text AS ${Prisma.raw(`"_d${i}"`)}`));
  const order: Prisma.Sql[] = rowDims.map((d) => s`${d.sql} ASC NULLS LAST`);
  if (spec.sort) {
    const col = source.detail.find((c) => c.key === spec.sort!.by && !c.hidden);
    const dim = dims.get(spec.sort.by);
    const expr = col?.sql ?? dim?.sql;
    if (!expr) throw new HttpError(400, `"${spec.sort.by}" is not a column ${source.label} can be sorted by.`);
    order.push(spec.sort.dir === "desc" ? s`${expr} DESC NULLS LAST` : s`${expr} ASC NULLS LAST`);
  }
  order.push(source.detailOrder);

  const rowExprs = rowDims.map((d) => d.sql);
  await assertGroupCount(source.from, b.where, rowExprs, rowDims.map((d) => d.label).join(" and "));
  const sums = shown.filter((c) => c.sum);
  const aggs: Agg[] = [...sums.map((c) => ({ key: c.key, sql: s`COALESCE(SUM(${c.sql}), 0)::float8`, kind: c.kind })), { key: "_count", sql: s`COUNT(*)::int`, kind: "count" }];

  const [raw, countRows, groupedRows] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${Prisma.join(select)} FROM ${source.from} ${b.where}
      ORDER BY ${Prisma.join(order)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS "n" FROM ${source.from} ${b.where}`,
    grouped(source.from, b.where, rowExprs, groupingSets(rowExprs.length, false), aggs),
  ]);
  const totalRows = countRows[0]?.n ?? 0;

  const rows: ResultRow[] = raw.map((r) => {
    const cells: Record<string, Cell> = {};
    for (const c of shown) {
      const v = r[c.key];
      cells[c.key] = v === null || v === undefined ? null : NUMERIC.includes(c.kind) ? round(c.kind, v) : String(v);
    }
    const link = source.link(r) ?? undefined;
    return { dims: Object.fromEntries(rowDims.map((d, i) => [d.key, (r[`_d${i}`] as string | null) ?? null])), cells, link };
  });

  const subtotals: ReportResult["subtotals"] = [];
  let total: Record<string, Cell> = {};
  for (const g of groupedRows) {
    const k = g.on.filter(Boolean).length;
    if (!g.on.every((v, i) => (i < k ? v : !v))) continue;
    if (k === 0) total = g.cells;
    else subtotals.push({ dims: Object.fromEntries(g.values.slice(0, k).map((v, i) => [rowDims[i].key, v])), cells: g.cells });
  }
  subtotals.sort((x, y) => sortValues(rowDims.map((d) => x.dims[d.key] ?? null), rowDims.map((d) => y.dims[d.key] ?? null)));

  return {
    kind: "detail",
    columns: shown.map((c) => ({ key: c.key, label: c.label, kind: c.kind, sum: c.sum, dimension: c.dimension })),
    rows,
    subtotals,
    total,
    page,
    pageSize,
    totalRows,
    truncated: page * pageSize < totalRows,
    generatedAt: new Date().toISOString(),
    range: b.range,
    hidden,
    labels: labelsFor(source),
  };
}

// ---- entry points ----------------------------------------------------------

async function compute(spec: ReportSpec, ctx: RunContext): Promise<ReportResult> {
  const source = SOURCES[spec.source];
  const dims = dimensionMap(source, ctx.tzOffset);
  const range = source.dateField ? resolveRange(spec.dateRange, ctx.tzOffset, ctx.now) : { from: null, to: null };
  const where = buildWhere(spec, source, dims, ctx.tzOffset, range);
  const hidden: string[] = [];
  const b: Built = { source, dims, where, range };
  return spec.kind === "detail" ? runDetail(spec, b, ctx, hidden) : runSummary(spec, b, ctx, hidden);
}

// Identical requests within a minute share one answer; the key carries what
// the account may see, so a dock login never reads an office login's figures.
const cache = new StaleWhileRefresh<ReportResult>(60_000, 64);

export function clearReportCache(): void {
  cache.clear();
}

export async function runReport(spec: ReportSpec, ctx: RunContext): Promise<ReportResult> {
  const source = SOURCES[spec.source];
  if (!source) throw new HttpError(400, "Unknown report source.");
  if (!canReadSource(ctx.account, source)) throw new HttpError(403, `Reading ${source.label} needs access to one of its pages.`);
  const key = JSON.stringify({
    spec,
    tz: ctx.tzOffset,
    page: ctx.page ?? 1,
    pageSize: ctx.pageSize ?? 100,
    prices: canSeePrices(ctx.account),
    cost: canSeeCost(ctx.account),
    day: ctx.now ? ctx.now.toISOString() : undefined,
  });
  return cache.get(key, () => compute(spec, ctx));
}

// Every row of a detail report (up to `maxRows`), for export, print and
// email, where paging makes no sense; a summary is returned as is.
export async function runReportAll(spec: ReportSpec, ctx: RunContext, maxRows = 10_000): Promise<ReportResult> {
  if (spec.kind !== "detail") return runReport(spec, ctx);
  const pageSize = 500;
  const first = await runReport(spec, { ...ctx, page: 1, pageSize });
  const rows = [...first.rows];
  const totalRows = first.totalRows ?? rows.length;
  for (let page = 2; rows.length < totalRows && rows.length < maxRows; page++) {
    const next = await runReport(spec, { ...ctx, page, pageSize });
    rows.push(...next.rows);
    if (next.rows.length === 0) break;
  }
  return { ...first, rows, page: 1, pageSize: rows.length, truncated: rows.length < totalRows };
}

// What a source offers this account, for the Customize panel.
export function describeSource(account: AuthedAccount, key: ReportSource, tzOffset = 0) {
  const source = SOURCES[key];
  const dims = [...dimensionMap(source, tzOffset).values()];
  return {
    key,
    label: source.label,
    dateField: source.dateField?.label ?? null,
    dimensions: dims.map((d) => ({ key: d.key, label: d.label, kind: "text" as ValueKind, options: d.options })),
    measures: source.measures.filter((m) => canSeeKind(account, m.kind)).map((m) => ({ key: m.key, label: m.label, kind: m.kind })),
    fields: source.detail.filter((c) => !c.hidden && canSeeKind(account, c.kind)).map((c) => ({ key: c.key, label: c.label, kind: c.kind, dimension: c.dimension })),
  };
}

export function readableSources(account: AuthedAccount): ReportSource[] {
  return (Object.keys(SOURCES) as ReportSource[]).filter((k) => canReadSource(account, SOURCES[k]));
}

export { DATE_BUCKETS };
