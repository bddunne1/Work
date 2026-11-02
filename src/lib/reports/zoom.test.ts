import { describe, expect, it } from "vitest";
import { emptySpec } from "./spec";
import { zoomSpec } from "./zoom";

describe("zoomSpec", () => {
  const summary = { ...emptySpec("invoice-lines"), measures: ["amount"], rows: ["customer"], columns: { by: "month" }, filters: [{ field: "status", op: "equals" as const, value: "ISSUED" }], subColumns: ["pctOfRow" as const], sort: { by: "amount", dir: "desc" as const } };

  it("switches to detail and adds the row and column values as equals filters", () => {
    const z = zoomSpec(summary, { customer: "Acme" }, { key: "amount|2026-10", label: "2026-10", kind: "money", measure: "amount", pivot: "2026-10" }, "Sales by Customer Summary");
    expect(z.kind).toBe("detail");
    expect(z.rows).toEqual([]);
    expect(z.columns).toBeNull();
    expect(z.measures).toEqual([]);
    expect(z.subColumns).toEqual([]);
    expect(z.sort).toBeNull();
    expect(z.filters).toEqual([
      { field: "status", op: "equals", value: "ISSUED" },
      { field: "customer", op: "equals", value: "Acme" },
      { field: "month", op: "equals", value: "2026-10" },
    ]);
    expect(z.presentation.title).toBe("Sales by Customer Summary: Acme · 2026-10");
    expect(z.dateRange).toEqual(summary.dateRange);
  });

  it("filters on blank with isEmpty, skips the Total column, and labels coded values", () => {
    const z = zoomSpec({ ...summary, rows: ["status"] }, { status: null }, { key: "amount|total", label: "Total", kind: "money", measure: "amount", pivot: "total" }, "Report", { status: { ISSUED: "Issued" } });
    expect(z.filters.slice(1)).toEqual([{ field: "status", op: "isEmpty" }]);
    const labeled = zoomSpec(summary, { status: "ISSUED" }, null, "Report", { status: { ISSUED: "Issued" } });
    expect(labeled.presentation.title).toBe("Report: Issued");
  });
});
