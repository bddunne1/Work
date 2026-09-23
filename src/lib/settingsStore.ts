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

const CAPACITY_LOOKBACK_KEY = "erp_capacity_lookback_days";
const DEFAULT_CAPACITY_LOOKBACK_DAYS = 30;

// Default lookback window for the Warehouse Capacity report (see
// warehouseCapacity.ts) - the page itself can still pick a different window
// per view, but this is where it starts and what it resets to.
export function getCapacityLookbackDays(): number {
  try {
    const raw = localStorage.getItem(CAPACITY_LOOKBACK_KEY);
    if (!raw) return DEFAULT_CAPACITY_LOOKBACK_DAYS;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAPACITY_LOOKBACK_DAYS;
  } catch {
    return DEFAULT_CAPACITY_LOOKBACK_DAYS;
  }
}

export function setCapacityLookbackDays(days: number): void {
  try {
    localStorage.setItem(CAPACITY_LOOKBACK_KEY, String(Math.max(1, Math.floor(days))));
  } catch {
    // storage unavailable (private mode, blocked site data, etc.) - no-op
  }
}
