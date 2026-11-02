// Rows of the one browser-built report left - the Item Quick Report
// (itemStore.getItemQuickReport); every other report runs on the engine.
export type ReportCellValue = string | number;
export type ReportRow = Record<string, ReportCellValue>;
