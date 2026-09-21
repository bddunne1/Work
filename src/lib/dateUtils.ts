// Adds `days` business days (skipping Saturdays and Sundays) to a
// "YYYY-MM-DD" date string using UTC date math so the result doesn't
// drift with the local timezone, returning the same format.
export function addBusinessDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) remaining--;
  }
  return date.toISOString().slice(0, 10);
}
