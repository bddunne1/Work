import { DATE_PRESET_LABELS, type ReportCell, type ReportPresentation, type ReportResult, type ReportSpec, type ValueKind } from "./spec";

// How a report cell prints: numbers right-aligned with thousands separators,
// money to the cent, percentages to a tenth, and negatives in the style the
// Numbers tab chose (-1,234.50, (1,234.50) or red).

const NUMERIC: ValueKind[] = ["qty", "money", "cost", "count", "pct", "rate"];

export function isNumericKind(kind: ValueKind): boolean {
  return NUMERIC.includes(kind);
}

export interface FormattedCell {
  text: string;
  negative: boolean;
}

export function formatCell(kind: ValueKind, value: ReportCell, presentation: ReportPresentation = {}): FormattedCell {
  if (value === null || value === undefined || value === "") return { text: "", negative: false };
  if (!isNumericKind(kind)) return { text: String(value), negative: false };
  let n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return { text: String(value), negative: false };
  if (presentation.divideBy1000 && (kind === "money" || kind === "cost" || kind === "qty")) n = n / 1000;
  const negative = n < 0;
  const abs = Math.abs(n);
  let text: string;
  switch (kind) {
    case "money":
    case "cost":
    case "rate":
      text = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: kind === "rate" ? 4 : 2 });
      break;
    case "pct":
      text = `${abs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
      break;
    default:
      text = abs.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (negative) text = presentation.negativeStyle === "parens" ? `(${text})` : `-${text}`;
  return { text, negative };
}

// A row with nothing but zeros and blanks in its numeric cells.
export function isZeroRow(cells: Record<string, ReportCell>, kinds: Record<string, ValueKind>): boolean {
  let sawNumber = false;
  for (const [k, v] of Object.entries(cells)) {
    if (!isNumericKind(kinds[k] ?? "text")) continue;
    sawNumber = true;
    if (typeof v === "number" && v !== 0) return false;
  }
  return sawNumber;
}

// "2026-10-01 to 2026-10-31", for the report header and the print header.
export function describeRange(result: ReportResult | null, spec: ReportSpec): string {
  if (spec.dateRange.preset === "all") return "All dates";
  const r = result?.range;
  if (!r) return DATE_PRESET_LABELS[spec.dateRange.preset];
  if (r.from && r.to) return r.from === r.to ? r.from : `${r.from} to ${r.to}`;
  if (r.from) return `From ${r.from}`;
  if (r.to) return `Through ${r.to}`;
  return "All dates";
}
