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
  await setSetting("capacity_lookback_days", Math.min(90, Math.max(1, Math.floor(days))));
}

// How Generate BOL and the shipping label prefill handling units (G-07):
// units per package and packages per handling unit turn the staged
// quantities into package and H.U. counts; the rest are the names and
// freight codes the forms start with.
export interface BolDefaults {
  unitsPerPackage: number;
  packagesPerHandlingUnit: number;
  handlingUnitType: string;
  packageType: string;
  freightClass: string;
  nmfcNumber: string;
}

const DEFAULT_BOL_DEFAULTS: BolDefaults = {
  unitsPerPackage: 1,
  packagesPerHandlingUnit: 1,
  handlingUnitType: "Pallet",
  packageType: "Cartons",
  freightClass: "",
  nmfcNumber: "",
};

export function getBolDefaults(): BolDefaults {
  return { ...DEFAULT_BOL_DEFAULTS, ...getSetting<Partial<BolDefaults>>("bol_defaults", {}) };
}

export async function setBolDefaults(value: BolDefaults): Promise<void> {
  await setSetting("bol_defaults", value);
}
