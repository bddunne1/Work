// Money on screen, in integer cents, mirroring server/src/lib/money.ts so an
// order page and the invoice raised from it agree to the cent (L-04). Half
// cents round up, as the server does.

export const toCents = (amount: number): number => Math.round((Number(amount) || 0) * 100);

export const fromCents = (cents: number): number => cents / 100;

// qty x unit rate. The rate is taken to the cent first, so 18 x 15.12 is
// exactly 27216 cents rather than a float that may print as 272.15.
export function lineAmountCents(qty: number, rate: number): number {
  return Math.round(toCents(rate) * (Number(qty) || 0));
}

// `taxRatePercent` is e.g. 6.25 for 6.25%, kept to four decimals.
export function taxCents(subtotalCents: number, taxRatePercent: number): number {
  const rate = Math.round((Number(taxRatePercent) || 0) * 10_000);
  return Math.round((subtotalCents * rate) / 1_000_000);
}

export const money = (amount: number): string =>
  amount.toLocaleString(undefined, { style: "currency", currency: "USD" });
