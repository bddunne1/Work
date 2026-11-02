import type { ReportFilter, ReportResultColumn, ReportSpec } from "./spec";

// QuickZoom: the detail behind a summary figure. The same spec switched to
// a detail report, with the row's dimension values (and the pivot column's
// value) added as equals filters, so the records listed are exactly the
// ones the number was totaled from. A blank dimension value becomes an
// "is blank" filter.
export function zoomSpec(spec: ReportSpec, dims: Record<string, string | null>, column: ReportResultColumn | null, title: string, labels: Record<string, Record<string, string>> = {}): ReportSpec {
  const filters: ReportFilter[] = [...spec.filters];
  const parts: string[] = [];
  const add = (field: string, value: string | null) => {
    if (value === null || value === "") {
      filters.push({ field, op: "isEmpty" });
      parts.push("(none)");
    } else {
      filters.push({ field, op: "equals", value });
      parts.push(labels[field]?.[value] ?? value);
    }
  };
  for (const [field, value] of Object.entries(dims)) add(field, value);
  if (column && spec.columns && column.pivot !== null && column.pivot !== undefined && column.pivot !== "total") add(spec.columns.by, column.pivot);
  return {
    ...spec,
    kind: "detail",
    rows: [],
    columns: null,
    measures: [],
    subColumns: [],
    sort: null,
    fields: undefined,
    filters,
    presentation: { ...spec.presentation, title: parts.length ? `${title}: ${parts.join(" · ")}` : `${title}: detail` },
  };
}
