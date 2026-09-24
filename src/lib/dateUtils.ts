// Today's date as "YYYY-MM-DD" in the user's own timezone. Don't use
// `new Date().toISOString().slice(0, 10)` for this - that's the UTC date,
// which is already tomorrow for US users after ~7-8pm local time.
export function localIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Normalizes a date typed or imported by a person to "YYYY-MM-DD", or
// returns null if it isn't a real calendar date. Accepts ISO (2026-09-22)
// and US-style (9/22/2026, 09/22/26) - the latter is what Excel exports by
// default and used to crash the importer.
export function normalizeDateInput(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Adds `days` business days (skipping Saturdays and Sundays) to a
// "YYYY-MM-DD" date string using UTC date math so the result doesn't
// drift with the local timezone, returning the same format.
export function addBusinessDays(dateStr: string, days: number): string {
  const normalized = normalizeDateInput(dateStr);
  if (!normalized) throw new Error(`Invalid date "${dateStr}"`);
  const [y, m, d] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) remaining--;
  }
  return date.toISOString().slice(0, 10);
}
