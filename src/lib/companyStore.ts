export interface CompanyInfo {
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
}

const COMPANY_KEY = "erp_company_info";

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
  try {
    const raw = localStorage.getItem(COMPANY_KEY);
    if (!raw) return DEFAULT_COMPANY_INFO;
    return { ...DEFAULT_COMPANY_INFO, ...(JSON.parse(raw) as Partial<CompanyInfo>) };
  } catch {
    return DEFAULT_COMPANY_INFO;
  }
}

export function setCompanyInfo(info: CompanyInfo): void {
  try {
    localStorage.setItem(COMPANY_KEY, JSON.stringify(info));
  } catch {
    // storage unavailable (private mode, blocked site data, etc.) - no-op
  }
}

// The one-line "street, city, state zip" format used under the company
// name on every printed document.
export function companyAddressLine(info: CompanyInfo): string {
  return `${info.street}, ${info.city}, ${info.state} ${info.zip}`;
}
