import { describe, expect, it } from "vitest";
import { lineAmountCents } from "./money";

// The one line-amount rule, shared with server/src/lib/money.ts: multiply
// the quantity by the full-precision rate, then round half up to the cent.
// The server suite runs the same table (test/review-october.test.ts).
describe("lineAmountCents", () => {
  it.each([
    [100, 1.2345, 12345],
    [500, 0.4875, 24375],
    [18, 15.125, 27225],
    [1000, 0.005, 500],
    [3, 1.005, 302],
  ])("%d x %s = %d cents", (qty, rate, cents) => {
    expect(lineAmountCents(qty, rate)).toBe(cents);
  });

  it("keeps the exact cases exact", () => {
    expect(lineAmountCents(18, 15.12)).toBe(27216);
    expect(lineAmountCents(4, 2.5)).toBe(1000);
    expect(lineAmountCents(7, 0.3333)).toBe(233);
    expect(lineAmountCents(0, 9.99)).toBe(0);
  });
});
