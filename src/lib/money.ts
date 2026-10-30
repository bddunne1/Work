// Money on screen, in integer cents, mirroring server/src/lib/money.ts so an
// order page and the invoice raised from it agree to the cent (L-04). Half
// cents round up, as the server does.

export const toCents = (amount: number): number => Math.round((Number(amount) || 0) * 100);

export const fromCents = (cents: number): number => cents / 100;

// qty x unit rate: the one rule shared with server/src/lib/money.ts.
// Multiply by the full-precision rate first, then round half up to the cent
// (3 x 1.005 = 3.015 -> 302 cents; 18 x 15.125 = 272.25 exactly). Rates are
// kept to four decimals (what the database columns hold), so the rate is
// taken to ten-thousandths as an integer before multiplying, which keeps
// 3 x 1.005 at exactly 301.5 rather than a float just under it.
export function lineAmountCents(qty: number, rate: number): number {
  const rateE4 = Math.round((Number(rate) || 0) * 10_000);
  return Math.round((rateE4 * (Number(qty) || 0)) / 100);
}

// `taxRatePercent` is e.g. 6.25 for 6.25%, kept to four decimals.
export function taxCents(subtotalCents: number, taxRatePercent: number): number {
  const rate = Math.round((Number(taxRatePercent) || 0) * 10_000);
  return Math.round((subtotalCents * rate) / 1_000_000);
}

export const money = (amount: number): string =>
  amount.toLocaleString(undefined, { style: "currency", currency: "USD" });
