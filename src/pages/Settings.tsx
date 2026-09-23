import { useEffect, useState } from "react";
import type { CompanyInfo } from "../lib/companyStore";
import { getCompanyInfo, setCompanyInfo } from "../lib/companyStore";
import { maxExistingSalesOrderNumber, nextSalesOrderNumber, setNextSalesOrderNumber } from "../lib/orderStore";
import {
  getCapacityLookbackDays,
  getLeadTimeDays,
  setCapacityLookbackDays,
  setLeadTimeDays,
} from "../lib/settingsStore";
import { maxExistingVendorPoNumber, nextVendorPoNumber, setNextVendorPoNumber } from "../lib/vendorPoStore";

export default function Settings() {
  const [company, setCompany] = useState<CompanyInfo>(() => getCompanyInfo());
  const [companySaved, setCompanySaved] = useState(false);

  const [leadTime, setLeadTime] = useState(() => getLeadTimeDays());
  const [lookback, setLookback] = useState(() => getCapacityLookbackDays());

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

  function handleLeadTimeChange(value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    setLeadTime(value);
    setLeadTimeDays(value);
  }

  function handleLookbackChange(value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
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
              type="number"
              min={0}
              value={leadTime}
              onChange={(e) => handleLeadTimeChange(Number(e.target.value))}
            />
          </label>
          <label className="form-field">
            Warehouse Capacity Lookback (days)
            <input
              type="number"
              min={1}
              value={lookback}
              onChange={(e) => handleLookbackChange(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="muted">
          Lead time is applied to every new order at entry - see Order Entry. The capacity lookback
          is the default window Warehouse Capacity uses for throughput and dwell time.
        </p>
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
    </div>
  );
}
