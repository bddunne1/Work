import { getSetting, setSetting } from "./settingsCache";

export interface CompanyInfo {
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
}

const COMPANY_SETTING_KEY = "company_info";

// Matches what was hardcoded across every printed document before this
// became an editable setting - see Settings.tsx.
const DEFAULT_COMPANY_INFO: CompanyInfo = {
  name: "Aamstrand Ropes & Twines",
  street: "711 N Grove St",
  city: "Manteno",
  state: "IL",
  zip: "60950",
  phone: "800-338-0557",
};

export function getCompanyInfo(): CompanyInfo {
  return { ...DEFAULT_COMPANY_INFO, ...getSetting(COMPANY_SETTING_KEY, {}) };
}

export async function setCompanyInfo(info: CompanyInfo): Promise<void> {
  await setSetting(COMPANY_SETTING_KEY, info);
}

// The one-line "street, city, state zip" format used under the company
// name on every printed document.
export function companyAddressLine(info: CompanyInfo): string {
  return `${info.street}, ${info.city}, ${info.state} ${info.zip}`;
}
