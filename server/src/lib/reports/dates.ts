import type { DatePreset, ReportDateRange } from "./spec.js";

// Date presets resolve here, on the day the browser is in: `tzOffset` is the
// browser's clock offset in minutes (as analytics/capacity takes it), so
// "Today" at 9 pm in Illinois is still the Illinois day, not UTC's tomorrow.

export interface ResolvedRange {
  from: string | null;
  to: string | null;
}

const DAY = 86_400_000;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}
function parts(s: string): [number, number, number] {
  const [y, m, d] = s.split("-").map(Number);
  return [y, m - 1, d];
}
export function addDays(s: string, n: number): string {
  const [y, m, d] = parts(s);
  return iso(utc(y, m, d + n));
}
function addMonths(s: string, n: number): string {
  const [y, m, d] = parts(s);
  return iso(utc(y, m + n, d));
}
function addYears(s: string, n: number): string {
  const [y, m, d] = parts(s);
  return iso(utc(y + n, m, d));
}

export function localToday(tzOffsetMin: number, now = new Date()): string {
  return iso(new Date(now.getTime() - tzOffsetMin * 60_000));
}

// Monday-based weeks, as Postgres' date_trunc('week') and the week bucket.
function weekStart(s: string): string {
  const [y, m, d] = parts(s);
  const date = utc(y, m, d);
  const dow = (date.getUTCDay() + 6) % 7;
  return iso(utc(y, m, d - dow));
}
function monthStart(s: string): string {
  return `${s.slice(0, 7)}-01`;
}
function monthEnd(s: string): string {
  const [y, m] = parts(s);
  return iso(utc(y, m + 1, 0));
}
function quarterStart(s: string): string {
  const [y, m] = parts(s);
  return iso(utc(y, m - (m % 3), 1));
}
function quarterEnd(s: string): string {
  const [y, m] = parts(s);
  return iso(utc(y, m - (m % 3) + 3, 0));
}
function yearStart(s: string): string {
  return `${s.slice(0, 4)}-01-01`;
}
function yearEnd(s: string): string {
  return `${s.slice(0, 4)}-12-31`;
}

export function resolveRange(range: ReportDateRange, tzOffsetMin: number, now = new Date()): ResolvedRange {
  const today = localToday(tzOffsetMin, now);
  const p: DatePreset = range.preset;
  switch (p) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "this-week":
      return { from: weekStart(today), to: addDays(weekStart(today), 6) };
    case "last-week": {
      const start = addDays(weekStart(today), -7);
      return { from: start, to: addDays(start, 6) };
    }
    case "this-month":
      return { from: monthStart(today), to: monthEnd(today) };
    case "this-month-to-date":
      return { from: monthStart(today), to: today };
    case "last-month": {
      const lm = addMonths(monthStart(today), -1);
      return { from: lm, to: monthEnd(lm) };
    }
    case "this-quarter":
      return { from: quarterStart(today), to: quarterEnd(today) };
    case "last-quarter": {
      const lq = addMonths(quarterStart(today), -3);
      return { from: lq, to: quarterEnd(lq) };
    }
    case "this-year":
      return { from: yearStart(today), to: yearEnd(today) };
    case "this-year-to-date":
      return { from: yearStart(today), to: today };
    case "last-year": {
      const ly = addYears(yearStart(today), -1);
      return { from: ly, to: yearEnd(ly) };
    }
    case "last-30-days":
      return { from: addDays(today, -29), to: today };
    case "last-90-days":
      return { from: addDays(today, -89), to: today };
    case "last-365-days":
      return { from: addDays(today, -364), to: today };
    case "all":
      return { from: null, to: null };
    case "custom":
      return { from: range.from ?? null, to: range.to ?? null };
  }
}

// The same length of time immediately before the range (QuickBooks'
// Previous Period); null when the range is open on either end.
export function previousPeriod(r: ResolvedRange): ResolvedRange | null {
  if (!r.from || !r.to) return null;
  const [fy, fm, fd] = parts(r.from);
  const [ty, tm, td] = parts(r.to);
  const days = Math.round((utc(ty, tm, td).getTime() - utc(fy, fm, fd).getTime()) / DAY) + 1;
  // Whole calendar months slide by months so Previous Period of March is February.
  if (r.from === monthStart(r.from) && r.to === monthEnd(r.to)) {
    const months = (ty - fy) * 12 + (tm - fm) + 1;
    const from = addMonths(r.from, -months);
    return { from, to: addDays(r.from, -1) };
  }
  return { from: addDays(r.from, -days), to: addDays(r.from, -1) };
}

export function previousYear(r: ResolvedRange): ResolvedRange | null {
  if (!r.from && !r.to) return null;
  return { from: r.from ? addYears(r.from, -1) : null, to: r.to ? addYears(r.to, -1) : null };
}
