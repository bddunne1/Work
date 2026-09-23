import { getSetting, setSetting } from "./settingsCache";

const DEFAULT_LEAD_TIME_DAYS = 5;

export function getLeadTimeDays(): number {
  return getSetting("lead_time_days", DEFAULT_LEAD_TIME_DAYS);
}

export async function setLeadTimeDays(days: number): Promise<void> {
  await setSetting("lead_time_days", Math.max(0, Math.floor(days)));
}

const DEFAULT_CAPACITY_LOOKBACK_DAYS = 30;

// Default lookback window for the Warehouse Capacity report (see
// warehouseCapacity.ts) - the page itself can still pick a different window
// per view, but this is where it starts and what it resets to.
export function getCapacityLookbackDays(): number {
  return getSetting("capacity_lookback_days", DEFAULT_CAPACITY_LOOKBACK_DAYS);
}

export async function setCapacityLookbackDays(days: number): Promise<void> {
  await setSetting("capacity_lookback_days", Math.max(1, Math.floor(days)));
}
