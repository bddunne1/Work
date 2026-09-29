import { Prisma } from "@prisma/client";

// Document money math in integer cents (review finding L-04): every line
// is rounded to the cent on its own, then summed, so the printed lines
// always add up to the printed subtotal.
export type Money = Prisma.Decimal | number | string;

export function toCents(v: Money): number {
  return Math.round(new Prisma.Decimal(v).mul(100).toNumber());
}

export function fromCents(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100);
}

export function lineAmountCents(qty: number, rate: Money): number {
  return Math.round(new Prisma.Decimal(rate).mul(qty).mul(100).toNumber());
}

// `taxRatePercent` is e.g. 6.25 for 6.25%.
export function taxCents(subtotalCents: number, taxRatePercent: Money): number {
  return Math.round(new Prisma.Decimal(subtotalCents).mul(new Prisma.Decimal(taxRatePercent)).div(100).toNumber());
}

// Days until due from the free-text terms field: "Net 30" -> 30,
// "2% 10 Net 30" -> 30, "Due on receipt" / "COD" / "Prepaid" -> 0.
// Unrecognised text defaults to 30.
export function termsDays(terms: string): number {
  const t = terms.trim().toLowerCase();
  if (!t) return 30;
  if (/receipt|cod|prepaid|cash|credit card/.test(t)) return 0;
  const net = /net\s*(\d{1,3})/.exec(t);
  if (net) return Number(net[1]);
  const bare = /^(\d{1,3})$/.exec(t);
  if (bare) return Number(bare[1]);
  return 30;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
