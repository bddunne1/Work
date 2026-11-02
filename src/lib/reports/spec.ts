// The report specification: what a report is made of, independent of how it
// is drawn. Modeled on QuickBooks' Customize Report dialog - a source (the
// transaction or list type), measures (the numbers), rows (what to total
// by), an optional column dimension (display columns by), filters, a date
// range and presentation choices. The server mirrors this shape with a zod
// schema in server/src/lib/reports/spec.ts; every report the app runs, from
// the standard catalog to a memorized one, is one of these.

export const REPORT_SOURCES = [
  "sales-order-lines",
  "shipments",
  "invoice-lines",
  "credit-memo-lines",
  "purchase-order-lines",
  "receipts",
  "stock-movements",
  "inventory",
  "returns",
  "customers",
  "vendors",
] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

export type ReportKind = "summary" | "detail";

export const DATE_BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export const FILTER_OPS = ["equals", "contains", "in", "between", "gte", "lte", "isEmpty"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface ReportFilter {
  field: string;
  op: FilterOp;
  // `equals`, `contains`, `gte`, `lte` read `value`; `in` reads `values`;
  // `between` reads `values[0]` and `values[1]`; `isEmpty` reads nothing.
  value?: string;
  values?: string[];
}

export const DATE_PRESETS = [
  "today",
  "this-week",
  "this-month",
  "this-month-to-date",
  "this-quarter",
  "this-year",
  "this-year-to-date",
  "yesterday",
  "last-week",
  "last-month",
  "last-quarter",
  "last-year",
  "last-30-days",
  "last-90-days",
  "last-365-days",
  "all",
  "custom",
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  "this-week": "This Week",
  "this-month": "This Month",
  "this-month-to-date": "This Month-to-date",
  "this-quarter": "This Quarter",
  "this-year": "This Year",
  "this-year-to-date": "This Year-to-date",
  yesterday: "Yesterday",
  "last-week": "Last Week",
  "last-month": "Last Month",
  "last-quarter": "Last Quarter",
  "last-year": "Last Year",
  "last-30-days": "Last 30 Days",
  "last-90-days": "Last 90 Days",
  "last-365-days": "Last 365 Days",
  all: "All",
  custom: "Custom",
};

export interface ReportDateRange {
  preset: DatePreset;
  // "YYYY-MM-DD", read when preset is "custom".
  from?: string;
  to?: string;
}

export const SUB_COLUMNS = ["previousPeriod", "previousYear", "pctOfRow", "pctOfColumn"] as const;
export type SubColumn = (typeof SUB_COLUMNS)[number];

export const SUB_COLUMN_LABELS: Record<SubColumn, string> = {
  previousPeriod: "Previous Period",
  previousYear: "Previous Year",
  pctOfRow: "% of Row",
  pctOfColumn: "% of Column",
};

export type NegativeStyle = "minus" | "parens" | "red";

export interface ReportPresentation {
  title?: string;
  subtitle?: string;
  showCompany?: boolean;
  showDatePrepared?: boolean;
  showPageNumbers?: boolean;
  footer?: string;
  hideZeroRows?: boolean;
  divideBy1000?: boolean;
  negativeStyle?: NegativeStyle;
}

export interface ReportSort {
  // A dimension key, a measure key (summary) or a detail column key.
  by: string;
  dir: "asc" | "desc";
}

export interface ReportSpec {
  source: ReportSource;
  kind: ReportKind;
  // Measure keys from the source. A detail report shows every column it
  // may unless `fields` narrows them.
  measures: string[];
  // Dimension keys to total by (summary) or group by (detail), outermost first.
  rows: string[];
  // Display columns by this dimension (a pivot), or a single Total column.
  columns: null | { by: string };
  filters: ReportFilter[];
  sort: ReportSort | null;
  dateRange: ReportDateRange;
  subColumns: SubColumn[];
  presentation: ReportPresentation;
  // Detail reports only: the columns to show, in order.
  fields?: string[];
}

// ---- what the server answers --------------------------------------------

export type ValueKind = "text" | "date" | "datetime" | "qty" | "money" | "cost" | "count" | "pct" | "rate";

export interface ReportResultColumn {
  key: string;
  label: string;
  kind: ValueKind;
  // Summary: the measure this column carries, and the pivot value when the
  // report displays columns by a dimension ("total" for the row total).
  measure?: string;
  pivot?: string | null;
  sub?: SubColumn;
  // Detail: whether the column is summed into subtotals.
  sum?: boolean;
  // Detail: the column holds a dimension value a QuickZoom can filter on.
  dimension?: string;
}

export type ReportCell = string | number | null;

export interface ReportResultRow {
  // Dimension values keyed by dimension key (null where the record has none).
  dims: Record<string, string | null>;
  cells: Record<string, ReportCell>;
  // Detail rows: the document this row came from.
  link?: string;
}

export interface ReportSubtotal {
  // The leading dimension values this subtotal covers.
  dims: Record<string, string | null>;
  cells: Record<string, ReportCell>;
}

export interface ReportResult {
  kind: ReportKind;
  columns: ReportResultColumn[];
  rows: ReportResultRow[];
  subtotals: ReportSubtotal[];
  total: Record<string, ReportCell>;
  // Detail paging.
  page?: number;
  pageSize?: number;
  totalRows?: number;
  truncated: boolean;
  generatedAt: string;
  // The resolved date range the figures cover (null bounds mean open).
  range: { from: string | null; to: string | null };
  // Measures or columns the account may not see were left out.
  hidden: string[];
  // Display labels for dimension values with a fixed vocabulary
  // (status codes), keyed by dimension then raw value.
  labels: Record<string, Record<string, string>>;
}

export interface ReportFieldInfo {
  key: string;
  label: string;
  kind: ValueKind;
  // Filter options for a field with a fixed vocabulary (statuses, reasons).
  options?: { value: string; label: string }[];
}

// What a source offers, for the Customize panel.
export interface ReportSourceInfo {
  key: ReportSource;
  label: string;
  dateField: string;
  dimensions: ReportFieldInfo[];
  measures: ReportFieldInfo[];
  fields: ReportFieldInfo[];
}

export const DEFAULT_PRESENTATION: ReportPresentation = {
  showCompany: true,
  showDatePrepared: true,
  showPageNumbers: true,
  negativeStyle: "minus",
};

export function emptySpec(source: ReportSource, kind: ReportKind = "summary"): ReportSpec {
  return {
    source,
    kind,
    measures: [],
    rows: [],
    columns: null,
    filters: [],
    sort: null,
    dateRange: { preset: "this-month" },
    subColumns: [],
    presentation: { ...DEFAULT_PRESENTATION },
  };
}

// The spec travels in the URL as base64 JSON (the runner's filters did the
// same), so Back returns to the summary with its state.
export function encodeSpec(spec: ReportSpec): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(spec))));
}

export function decodeSpec(encoded: string): ReportSpec | null {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(encoded)))) as ReportSpec;
  } catch {
    return null;
  }
}
