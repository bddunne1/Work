import { useEffect, useState } from "react";
import QuickBooksPanel from "../components/QuickBooksPanel";
import type { CompanyInfo } from "../lib/companyStore";
import { getCompanyInfo, setCompanyInfo } from "../lib/companyStore";
import { maxExistingSalesOrderNumber, nextSalesOrderNumber, setNextSalesOrderNumber } from "../lib/orderStore";
import {
  type BolDefaults,
  getBolDefaults,
  getCapacityLookbackDays,
  getLeadTimeDays,
  setBolDefaults,
  setCapacityLookbackDays,
  setLeadTimeDays,
} from "../lib/settingsStore";
import { maxExistingVendorPoNumber, nextVendorPoNumber, setNextVendorPoNumber } from "../lib/vendorPoStore";

export default function Settings() {
  const [company, setCompany] = useState<CompanyInfo>(() => getCompanyInfo());
  const [companySaved, setCompanySaved] = useState(false);

  const [leadTime, setLeadTime] = useState(() => getLeadTimeDays());
  const [lookback, setLookback] = useState(() => getCapacityLookbackDays());

  // BOL and label prefill (G-07): typed as text, validated on save.
  const [bolDefaults, setBolDefaultsState] = useState<BolDefaults>(() => getBolDefaults());
  const [bolText, setBolText] = useState(() => {
    const d = getBolDefaults();
    return { unitsPerPackage: String(d.unitsPerPackage), packagesPerHandlingUnit: String(d.packagesPerHandlingUnit) };
  });
  const [bolSaved, setBolSaved] = useState(false);
  const [bolError, setBolError] = useState("");

  function setBolField<K extends keyof BolDefaults>(key: K, value: BolDefaults[K]) {
    setBolDefaultsState((d) => ({ ...d, [key]: value }));
    setBolSaved(false);
  }

  async function saveBolDefaults(e: React.FormEvent) {
    e.preventDefault();
    const upp = Number(bolText.unitsPerPackage);
    const pph = Number(bolText.packagesPerHandlingUnit);
    if (!Number.isInteger(upp) || upp < 1 || !Number.isInteger(pph) || pph < 1) {
      setBolError("Units per package and packages per handling unit must be whole numbers, 1 or more.");
      return;
    }
    setBolError("");
    const next = { ...bolDefaults, unitsPerPackage: upp, packagesPerHandlingUnit: pph };
    await setBolDefaults(next);
    setBolDefaultsState(next);
    setBolSaved(true);
    setTimeout(() => setBolSaved(false), 2000);
  }

  const [nextSo, setNextSo] = useState("");
  const [soError, setSoError] = useState("");
  const [nextPo, setNextPo] = useState("");
  const [poError, setPoError] = useState("");

  useEffect(() => {
    nextSalesOrderNumber().then(setNextSo);
    nextVendorPoNumber().then((n) => setNextPo(n.replace(/^PO-/, "")));
  }, []);

  function setCompanyField<K extends keyof CompanyInfo>(key: K, value: CompanyInfo[K]) {
    setCompany((c) => ({ ...c, [key]: value }));
    setCompanySaved(false);
  }

  async function saveCompany(e: React.FormEvent) {
    e.preventDefault();
    await setCompanyInfo(company);
    setCompanySaved(true);
    setTimeout(() => setCompanySaved(false), 2000);
  }

  // Both numbers are typed into a draft and saved when the field is left,
  // after validation - clearing the lead time used to save 0 (M-11), and a
  // lookback of 365 pulled a year of shipments per page open (N-05).
  const [leadTimeText, setLeadTimeText] = useState(() => String(getLeadTimeDays()));
  const [lookbackText, setLookbackText] = useState(() => String(getCapacityLookbackDays()));
  const [defaultsError, setDefaultsError] = useState("");
  const MAX_LOOKBACK_DAYS = 90;

  function commitLeadTime() {
    const value = Number(leadTimeText);
    if (!Number.isInteger(value) || value < 0 || value > 60) {
      setDefaultsError("Lead time must be a whole number of business days, 0 to 60.");
      setLeadTimeText(String(leadTime));
      return;
    }
    setDefaultsError("");
    setLeadTime(value);
    setLeadTimeDays(value);
  }

  function commitLookback() {
    const value = Number(lookbackText);
    if (!Number.isInteger(value) || value < 1 || value > MAX_LOOKBACK_DAYS) {
      setDefaultsError(`The capacity lookback must be a whole number of days, 1 to ${MAX_LOOKBACK_DAYS}.`);
      setLookbackText(String(lookback));
      return;
    }
    setDefaultsError("");
    setLookback(value);
    setCapacityLookbackDays(value);
  }

  async function saveSoNumber(e: React.FormEvent) {
    e.preventDefault();
    setSoError("");
    const n = Number(nextSo);
    const maxExisting = await maxExistingSalesOrderNumber();
    if (!Number.isFinite(n) || n <= 0) {
      setSoError("Enter a valid number.");
      return;
    }
    if (n <= maxExisting) {
      setSoError(`Must be greater than the highest existing S.O. # (${maxExisting}).`);
      return;
    }
    await setNextSalesOrderNumber(n);
  }

  async function savePoNumber(e: React.FormEvent) {
    e.preventDefault();
    setPoError("");
    const n = Number(nextPo);
    const maxExisting = await maxExistingVendorPoNumber();
    if (!Number.isFinite(n) || n <= 0) {
      setPoError("Enter a valid number.");
      return;
    }
    if (n <= maxExisting) {
      setPoError(`Must be greater than the highest existing PO # (PO-${maxExisting}).`);
      return;
    }
    await setNextVendorPoNumber(n);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Settings</h1>
        <p className="muted">Company info, global defaults, and document numbering - all admin-only.</p>
      </div>

      <div className="import-panel">
        <div className="import-panel-header">
          <div>
            <h3>Company Profile</h3>
            <p className="muted">
              Shown on every printed sales order, return, BOL, and shipping label.
            </p>
          </div>
        </div>
        <form onSubmit={saveCompany} className="narrow-form">
          <label className="form-field">
            Company Name
            <input value={company.name} onChange={(e) => setCompanyField("name", e.target.value)} />
          </label>
          <label className="form-field">
            Street Address
            <input value={company.street} onChange={(e) => setCompanyField("street", e.target.value)} />
          </label>
          <div className="form-row">
            <label className="form-field">
              City
              <input value={company.city} onChange={(e) => setCompanyField("city", e.target.value)} />
            </label>
            <label className="form-field">
              State
              <input value={company.state} onChange={(e) => setCompanyField("state", e.target.value)} />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              Zip
              <input value={company.zip} onChange={(e) => setCompanyField("zip", e.target.value)} />
            </label>
            <label className="form-field">
              Phone
              <input value={company.phone} onChange={(e) => setCompanyField("phone", e.target.value)} />
            </label>
          </div>
          <div className="inline-actions">
            <button type="submit" className="primary-btn">
              Save Company Profile
            </button>
            {companySaved && <span className="muted">Saved.</span>}
          </div>
        </form>
      </div>

      <div className="import-panel">
        <h3>Order Defaults</h3>
        <div className="form-row">
          <label className="form-field">
            Lead Time (business days)
            <input
              id="setting-lead-time"
              type="number"
              min={0}
              max={60}
              step={1}
              value={leadTimeText}
              onChange={(e) => setLeadTimeText(e.target.value)}
              onBlur={commitLeadTime}
            />
          </label>
          <label className="form-field">
            Warehouse Capacity Lookback (days)
            <input
              id="setting-capacity-lookback"
              type="number"
              min={1}
              max={MAX_LOOKBACK_DAYS}
              step={1}
              value={lookbackText}
              onChange={(e) => setLookbackText(e.target.value)}
              onBlur={commitLookback}
            />
          </label>
        </div>
        {defaultsError && <p className="login-error">{defaultsError}</p>}
        <p className="muted">
          Lead time is applied to every new order at entry - see Order Entry. The capacity lookback
          is the default window Warehouse Capacity uses for throughput and dwell time.
        </p>
      </div>

      <div className="import-panel">
        <h3>BOL and Label Defaults</h3>
        <p className="muted">
          Generate BOL and the shipping label start from these: the staged quantities become package and
          handling-unit counts, and the weight comes from each item's weight. Everything stays editable on
          the form.
        </p>
        <form onSubmit={saveBolDefaults}>
          <div className="form-row">
            <label className="form-field">
              Units per package
              <input type="number" min={1} step={1} value={bolText.unitsPerPackage} onChange={(e) => setBolText((t) => ({ ...t, unitsPerPackage: e.target.value }))} />
            </label>
            <label className="form-field">
              Packages per handling unit
              <input type="number" min={1} step={1} value={bolText.packagesPerHandlingUnit} onChange={(e) => setBolText((t) => ({ ...t, packagesPerHandlingUnit: e.target.value }))} />
            </label>
            <label className="form-field">
              Handling unit type
              <input value={bolDefaults.handlingUnitType} onChange={(e) => setBolField("handlingUnitType", e.target.value)} />
            </label>
            <label className="form-field">
              Package type
              <input value={bolDefaults.packageType} onChange={(e) => setBolField("packageType", e.target.value)} />
            </label>
            <label className="form-field">
              Freight class
              <input value={bolDefaults.freightClass} onChange={(e) => setBolField("freightClass", e.target.value)} />
            </label>
            <label className="form-field">
              NMFC #
              <input value={bolDefaults.nmfcNumber} onChange={(e) => setBolField("nmfcNumber", e.target.value)} />
            </label>
          </div>
          {bolError && <p className="login-error">{bolError}</p>}
          <div className="inline-actions">
            <button type="submit" className="primary-btn">
              Save BOL Defaults
            </button>
            {bolSaved && <span className="muted">Saved.</span>}
          </div>
        </form>
      </div>

      <div className="import-panel">
        <h3>Document Numbering</h3>
        <p className="muted">
          Override the next number a new sales order or purchase order will be assigned. Existing
          documents are never renumbered.
        </p>
        <div className="form-row">
          <form onSubmit={saveSoNumber}>
            <label className="form-field">
              Next S.O. #
              <div className="inline-actions">
                <input type="number" min={1} value={nextSo} onChange={(e) => setNextSo(e.target.value)} />
                <button type="submit" className="secondary-btn">
                  Save
                </button>
              </div>
            </label>
            {soError && <p className="login-error">{soError}</p>}
          </form>
          <form onSubmit={savePoNumber}>
            <label className="form-field">
              Next Vendor PO # (after "PO-")
              <div className="inline-actions">
                <input type="number" min={1} value={nextPo} onChange={(e) => setNextPo(e.target.value)} />
                <button type="submit" className="secondary-btn">
                  Save
                </button>
              </div>
            </label>
            {poError && <p className="login-error">{poError}</p>}
          </form>
        </div>
      </div>

      <QuickBooksPanel />
    </div>
  );
}
