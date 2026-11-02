import { z } from "zod";
import { isoDate } from "../dates.js";

// The server's copy of src/lib/reports/spec.ts: the same vocabulary as a zod
// schema, so a spec from the browser, a memorized report or a schedule is
// validated once here before anything is built from it.

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

export const DATE_BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export const FILTER_OPS = ["equals", "contains", "in", "between", "gte", "lte", "isEmpty"] as const;

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

export const SUB_COLUMNS = ["previousPeriod", "previousYear", "pctOfRow", "pctOfColumn"] as const;
export type SubColumn = (typeof SUB_COLUMNS)[number];

const key = z.string().trim().min(1).max(60);
const text = z.string().max(500);

export const reportFilterSchema = z.object({
  field: key,
  op: z.enum(FILTER_OPS),
  value: z.string().max(500).optional(),
  values: z.array(z.string().max(500)).max(200).optional(),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

export const reportDateRangeSchema = z.object({
  preset: z.enum(DATE_PRESETS),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ReportDateRange = z.infer<typeof reportDateRangeSchema>;

export const reportPresentationSchema = z
  .object({
    title: text.optional(),
    subtitle: text.optional(),
    showCompany: z.boolean().optional(),
    showDatePrepared: z.boolean().optional(),
    showPageNumbers: z.boolean().optional(),
    footer: text.optional(),
    hideZeroRows: z.boolean().optional(),
    divideBy1000: z.boolean().optional(),
    negativeStyle: z.enum(["minus", "parens", "red"]).optional(),
  })
  .default({});

export const reportSpecSchema = z.object({
  source: z.enum(REPORT_SOURCES),
  kind: z.enum(["summary", "detail"]).default("summary"),
  measures: z.array(key).max(20).default([]),
  rows: z.array(key).max(4).default([]),
  columns: z.object({ by: key }).nullable().default(null),
  filters: z.array(reportFilterSchema).max(30).default([]),
  sort: z.object({ by: key, dir: z.enum(["asc", "desc"]) }).nullable().default(null),
  dateRange: reportDateRangeSchema.default({ preset: "all" }),
  subColumns: z.array(z.enum(SUB_COLUMNS)).max(4).default([]),
  presentation: reportPresentationSchema,
  fields: z.array(key).max(60).optional(),
});
export type ReportSpec = z.infer<typeof reportSpecSchema>;

// The browser's clock offset in minutes, as Date.prototype.getTimezoneOffset
// gives it (300 for Chicago in summer - positive west of UTC).
export const tzOffsetSchema = z.coerce.number().int().min(-14 * 60).max(14 * 60).default(0);

export const runRequestSchema = z.object({
  spec: reportSpecSchema,
  tzOffset: tzOffsetSchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
