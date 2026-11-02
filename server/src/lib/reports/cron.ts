// A five-field cron matcher (minute hour day-of-month month day-of-week)
// for report schedules: "*", "*/n", "a-b", "a-b/n" and comma lists, with
// 0 or 7 for Sunday. Dates are read in the server's local time.

const RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function parseField(field: string, [min, max]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`"${part}" is not a cron field`);
    const step = m[3] ? Number(m[3]) : 1;
    let lo: number;
    let hi: number;
    if (m[1] === "*") {
      lo = min;
      hi = max;
    } else {
      lo = Number(m[1]);
      hi = m[2] ? Number(m[2]) : m[3] ? max : lo;
    }
    if (step < 1 || lo < min || hi > max || lo > hi) throw new Error(`"${part}" is out of range`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export interface Cron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  dayOfMonthAny: boolean;
  dayOfWeekAny: boolean;
}

export function parseCron(expr: string): Cron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("A schedule has five fields: minute hour day-of-month month day-of-week");
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields.map((f, i) => parseField(f, RANGES[i]));
  if (dayOfWeek.has(7)) dayOfWeek.add(0);
  return { minute, hour, dayOfMonth, month, dayOfWeek, dayOfMonthAny: fields[2] === "*", dayOfWeekAny: fields[4] === "*" };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

// Does the schedule fire in the minute `at` falls in? As in cron, a day
// matches when either the day-of-month or the day-of-week field does,
// unless both are "*".
export function cronMatches(cron: Cron, at: Date): boolean {
  if (!cron.minute.has(at.getMinutes()) || !cron.hour.has(at.getHours()) || !cron.month.has(at.getMonth() + 1)) return false;
  const domOk = cron.dayOfMonth.has(at.getDate());
  const dowOk = cron.dayOfWeek.has(at.getDay());
  if (cron.dayOfMonthAny && cron.dayOfWeekAny) return true;
  if (cron.dayOfMonthAny) return dowOk;
  if (cron.dayOfWeekAny) return domOk;
  return domOk || dowOk;
}

// The minute the schedule last should have fired at or before `now`, if
// any in the window - how the worker catches up a tick it slept through.
export function lastDue(cron: Cron, now: Date, windowMinutes = 10): Date | null {
  const t = new Date(now);
  t.setSeconds(0, 0);
  for (let i = 0; i < windowMinutes; i++) {
    if (cronMatches(cron, t)) return new Date(t);
    t.setMinutes(t.getMinutes() - 1);
  }
  return null;
}
