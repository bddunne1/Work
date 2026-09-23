import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { REPORT_PRESETS } from "../lib/reports/presets";
import { deleteSavedReport, listSavedReports } from "../lib/reportStore";
import type { SavedReport } from "../lib/reports/types";

export default function Reports() {
  const navigate = useNavigate();
  const [saved, setSaved] = useState<SavedReport[]>(() => listSavedReports());

  function handleDelete(r: SavedReport) {
    if (!confirm(`Delete the memorized report "${r.name}"?`)) return;
    deleteSavedReport(r.id);
    setSaved(listSavedReports());
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Reports</h1>
        <p className="muted">
          Built-in reports below, or build your own: pick a data source, filter it, choose columns, and
          memorize it for later - the same idea as a QuickBooks report.
        </p>
      </div>

      <div className="button-row">
        <button type="button" className="primary-btn" onClick={() => navigate("/reports/new")}>
          + New Custom Report
        </button>
      </div>

      <section className="lane-section">
        <h3 className="item-profile-heading">Built-in Reports</h3>
        <div className="module-grid">
          {REPORT_PRESETS.map((p) => (
            <Link key={p.key} to={`/reports/preset/${p.key}`} className="module-card active">
              <div className="module-name">{p.label}</div>
              <div className="module-desc">{p.description}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="lane-section">
        <h3 className="item-profile-heading">Memorized Reports</h3>
        {saved.length === 0 ? (
          <p className="muted">
            No memorized reports yet - build a custom report and use "Memorize This Report" to save it here.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Data Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {saved.map((r) => (
                <tr key={r.id} className="clickable-row" onClick={() => navigate(`/reports/saved/${r.id}`)}>
                  <td>{r.name}</td>
                  <td>{r.dataSourceKey}</td>
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
