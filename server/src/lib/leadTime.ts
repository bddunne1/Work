import type { Prisma } from "@prisma/client";

// The estimated ship date every new order starts with: the order date plus
// the standard lead time in business days (Settings › Order Defaults). It
// used to be computed by Order Entry and sent along, but since round 5 the
// ship date is a server-owned field that only the schedule command may set,
// so the value was dropped on create and orders showed no estimate.

export const LEAD_TIME_SETTING = "lead_time_days";
export const DEFAULT_LEAD_TIME_DAYS = 5;

type Tx = Prisma.TransactionClient;

export async function leadTimeDays(tx: Tx): Promise<number> {
  const row = await tx.setting.findUnique({ where: { key: LEAD_TIME_SETTING } });
  if (!row) return DEFAULT_LEAD_TIME_DAYS;
  try {
    const n = Number(JSON.parse(row.value));
    return Number.isInteger(n) && n >= 0 && n <= 60 ? n : DEFAULT_LEAD_TIME_DAYS;
  } catch {
    return DEFAULT_LEAD_TIME_DAYS;
  }
}

// Mirrors src/lib/dateUtils.ts addBusinessDays: weekends skipped, no
// holiday calendar.
export function addBusinessDays(date: Date, days: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d;
}

export async function estimatedShipDateFor(tx: Tx, orderDate: Date): Promise<Date> {
  return addBusinessDays(orderDate, await leadTimeDays(tx));
}
