const LEAD_TIME_KEY = "erp_lead_time_days";
const DEFAULT_LEAD_TIME_DAYS = 5;

export function getLeadTimeDays(): number {
  try {
    const raw = localStorage.getItem(LEAD_TIME_KEY);
    if (!raw) return DEFAULT_LEAD_TIME_DAYS;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LEAD_TIME_DAYS;
  } catch {
    return DEFAULT_LEAD_TIME_DAYS;
  }
}

export function setLeadTimeDays(days: number): void {
  try {
    localStorage.setItem(LEAD_TIME_KEY, String(Math.max(0, Math.floor(days))));
  } catch {
    // storage unavailable (private mode, blocked site data, etc.) - no-op
  }
}
