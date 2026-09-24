// Core types for the reporting framework - modeled loosely on QuickBooks'
// report system: a data source (what QuickBooks calls a report's underlying
// transaction/list type) exposes a fixed set of columns and filters; a
// report is just a data source plus a chosen filter/column configuration.
// "Memorizing" a report (QuickBooks' term) is saving that configuration for
// reuse - see reportStore.ts.

export type ReportCellValue = string | number;
export type ReportRow = Record<string, ReportCellValue>;

export interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  // When set, this column's cells link to their source record (e.g. an S.O.
  // # links back to that sales order) instead of rendering as plain text.
  linkTo?: (row: ReportRow) => string;
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface ReportFilterField {
  key: string;
  label: string;
  type: "text" | "dateRange" | "select";
  options?: FilterOption[];
  placeholder?: string;
}

// Filter values are always strings from form controls; a dateRange field
// reads two keys, `${key}From` and `${key}To`.
export type ReportFilterValues = Record<string, string>;

export interface ReportDataSource {
  key: string;
  label: string;
  description: string;
  columns: ReportColumn[];
  filterFields: ReportFilterField[];
  defaultColumns: string[];
  buildRows(filters: ReportFilterValues): Promise<ReportRow[] | ReportRowsResult>;
}

// What buildRows returns when the rows come with a caveat - e.g. order
// history is fetched from the server up to a row cap, and `notice` says so
// when more orders matched than were fetched.
export interface ReportRowsResult {
  rows: ReportRow[];
  notice?: string;
}

export interface ReportPreset {
  key: string;
  label: string;
  description: string;
  dataSourceKey: string;
  defaultFilters?: ReportFilterValues;
  defaultColumns?: string[];
}

export interface SavedReport {
  id: string;
  name: string;
  dataSourceKey: string;
  filters: ReportFilterValues;
  columns: string[];
  createdAt: string;
}
