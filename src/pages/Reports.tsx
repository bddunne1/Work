import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listCatalog, REPORT_AREAS, type ReportArea, type StandardReport } from "../lib/reports/engineClient";
import { DATE_PRESET_LABELS, DATE_PRESETS, encodeSpec, type DatePreset } from "../lib/reports/spec";
import type { SavedReport } from "../lib/reports/types";
import { deleteSavedReport, listSavedReports } from "../lib/reportStore";

// The Report Center: the standard reports by area, each a card with its
// date range and Run, and the memorized reports below.
export default function Reports() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<StandardReport[]>([]);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [area, setArea] = useState<ReportArea | null>(null);
  const [presets, setPresets] = useState<Record<string, DatePreset>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listCatalog()
      .then((c) => {
        setCatalog(c);
        setArea((a) => a ?? REPORT_AREAS.find((x) => c.some((r) => r.area === x)) ?? null);
      })
      .catch(() => setFailed(true));
    listSavedReports().then(setSaved).catch(() => {});
  }, []);

  const areas = useMemo(() => REPORT_AREAS.filter((a) => catalog.some((r) => r.area === a)), [catalog]);
  const shown = catalog.filter((r) => r.area === area);

  function runStandard(r: StandardReport) {
    const preset = presets[r.key] ?? r.defaultPreset;
    const spec = { ...r.spec, dateRange: { preset } };
    navigate(`/reports/preset/${r.key}?spec=${encodeSpec(spec)}`);
  }

  async function handleDelete(r: SavedReport) {
    if (!confirm(`Delete the memorized report "${r.name}"?`)) return;
    await deleteSavedReport(r.id);
    setSaved(await listSavedReports());
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Report Center</h1>
        <p className="muted">Standard reports by area, each run on the server over the period you pick. Memorized reports keep a report's setup for next time.</p>
      </div>

      {failed && (
        <div className="form-error" role="alert">
          The report catalog did not load. Reload to try again.
        </div>
      )}

      <div className="release-tabs report-center-areas" role="tablist">
        {areas.map((a) => (
          <button key={a} type="button" role="tab" aria-selected={area === a} className={`release-tab${area === a ? " is-active" : ""}`} onClick={() => setArea(a)}>
            {a}
          </button>
        ))}
      </div>

      <section className="lane-section">
        <div className="module-grid">
          {shown.map((r) => (
            <div key={r.key} className="module-card active" data-testid={`report-card-${r.key}`}>
              <div className="module-name">{r.name}</div>
              <div className="module-desc">{r.description}</div>
              <div className="report-card-actions">
                <select aria-label={`${r.name} date range`} value={presets[r.key] ?? r.defaultPreset} onChange={(e) => setPresets((p) => ({ ...p, [r.key]: e.target.value as DatePreset }))}>
                  {DATE_PRESETS.filter((p) => p !== "custom").map((p) => (
                    <option key={p} value={p}>
                      {DATE_PRESET_LABELS[p]}
                    </option>
                  ))}
                </select>
                <button type="button" className="primary-btn" onClick={() => runStandard(r)}>
                  Run
                </button>
              </div>
            </div>
          ))}
          {catalog.length > 0 && shown.length === 0 && <p className="muted">Nothing in this area yet.</p>}
        </div>
      </section>

      <section className="lane-section">
        <h3 className="item-profile-heading">Memorized Reports</h3>
        {saved.length === 0 ? (
          <p className="muted">No memorized reports yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {saved.map((r) => (
                <tr key={r.id} className="clickable-row" onClick={() => navigate(`/reports/saved/${r.id}`)}>
                  <td>{r.name}</td>
                  <td>{r.spec?.source ?? r.dataSourceKey}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="row-action-outline danger-link" onClick={() => handleDelete(r)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
