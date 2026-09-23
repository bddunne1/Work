import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DATA_SOURCES, getDataSource } from "../lib/reports/dataSources";
import { getPreset } from "../lib/reports/presets";
import type { ReportDataSource, ReportFilterValues, ReportRow } from "../lib/reports/types";
import { getSavedReport, memorizeReport } from "../lib/reportStore";

function rowsToCsv(dataSource: ReportDataSource, visibleColumns: string[], rows: ReportRow[]): string {
  const cols = dataSource.columns.filter((c) => visibleColumns.includes(c.key));
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [cols.map((c) => escape(c.label)).join(",")];
  for (const row of rows) {
    lines.push(cols.map((c) => escape(String(row[c.key] ?? ""))).join(","));
  }
  return lines.join("\n");
}

export default function ReportRunner() {
  const { presetKey, savedId } = useParams<{ presetKey?: string; savedId?: string }>();

  const preset = presetKey ? getPreset(presetKey) : undefined;
  const saved = savedId ? getSavedReport(savedId) : undefined;
  const initialDataSourceKey = preset?.dataSourceKey ?? saved?.dataSourceKey ?? "";

  const [dataSourceKey, setDataSourceKey] = useState(initialDataSourceKey);
  const dataSource = getDataSource(dataSourceKey);

  const [filters, setFilters] = useState<ReportFilterValues>(() => saved?.filters ?? preset?.defaultFilters ?? {});
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    () => saved?.columns ?? preset?.defaultColumns ?? dataSource?.defaultColumns ?? []
  );
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveName, setSaveName] = useState(saved?.name ?? preset?.label ?? "");
  const [savedMessage, setSavedMessage] = useState(false);

  function selectDataSource(key: string) {
    setDataSourceKey(key);
    const next = getDataSource(key);
    setFilters({});
    setVisibleColumns(next?.defaultColumns ?? []);
    setRows([]);
  }

  function runReport() {
    if (!dataSource) return;
    setLoading(true);
    dataSource.buildRows(filters).then((r) => {
      setRows(r);
      setLoading(false);
    });
  }

  useEffect(() => {
    if (dataSource) runReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceKey]);

  function setFilter(key: string, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function toggleColumn(key: string) {
    setVisibleColumns((cols) => (cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key]));
  }

  function handleMemorize() {
    if (!dataSource || !saveName.trim()) return;
    memorizeReport(saveName.trim(), dataSource.key, filters, visibleColumns);
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 2000);
  }

  function handleExportCsv() {
    if (!dataSource) return;
    const csv = rowsToCsv(dataSource, visibleColumns, rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dataSource.label.toLowerCase().replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const orderedColumns = dataSource ? dataSource.columns.filter((c) => visibleColumns.includes(c.key)) : [];

  return (
    <div className="page">
      <div className="page-header no-print">
        <Link to="/reports" className="link-btn">
          &larr; Reports
        </Link>
        <h1>{preset?.label ?? saved?.name ?? "Custom Report"}</h1>
        <p className="muted">{preset?.description ?? dataSource?.description ?? "Pick a data source to begin."}</p>
      </div>

      <div className="no-print">
        <label className="form-field">
          Data Source
          <select value={dataSourceKey} onChange={(e) => selectDataSource(e.target.value)}>
            <option value="" disabled>
              Choose a data source...
            </option>
            {DATA_SOURCES.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        {dataSource && (
          <>
            <div className="report-filters">
              {dataSource.filterFields.map((f) =>
                f.type === "dateRange" ? (
                  <div key={f.key} className="form-field report-filter-date-range">
                    <span>{f.label}</span>
                    <div className="form-row">
                      <input
                        type="date"
                        value={filters[`${f.key}From`] ?? ""}
                        onChange={(e) => setFilter(`${f.key}From`, e.target.value)}
                      />
                      <input
                        type="date"
                        value={filters[`${f.key}To`] ?? ""}
                        onChange={(e) => setFilter(`${f.key}To`, e.target.value)}
                      />
                    </div>
                  </div>
                ) : f.type === "select" ? (
                  <label key={f.key} className="form-field">
                    {f.label}
                    <select value={filters[f.key] ?? ""} onChange={(e) => setFilter(f.key, e.target.value)}>
                      <option value="">All</option>
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label key={f.key} className="form-field">
                    {f.label}
                    <input
                      value={filters[f.key] ?? ""}
                      placeholder={f.placeholder}
                      onChange={(e) => setFilter(f.key, e.target.value)}
                    />
                  </label>
                )
              )}
            </div>

            <div className="report-column-toggles">
              <span className="muted">Columns:</span>
              {dataSource.columns.map((c) => (
                <label key={c.key} className="checkbox-line report-column-toggle">
                  <input
                    type="checkbox"
                    checked={visibleColumns.includes(c.key)}
                    onChange={() => toggleColumn(c.key)}
                  />
                  {c.label}
                </label>
              ))}
            </div>

            <div className="toolbar">
              <button type="button" className="primary-btn" onClick={runReport} disabled={loading}>
                {loading ? "Running..." : "Run Report"}
              </button>
              <div className="inline-actions">
                <input
                  className="report-save-name"
                  placeholder="Report name..."
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
                <button type="button" className="secondary-btn" disabled={!saveName.trim()} onClick={handleMemorize}>
                  Memorize This Report
                </button>
                <button type="button" className="secondary-btn" disabled={rows.length === 0} onClick={handleExportCsv}>
                  Export CSV
                </button>
                <button type="button" className="secondary-btn print-btn" onClick={() => window.print()}>
                  Print / Preview
                </button>
              </div>
            </div>
            {savedMessage && <p className="muted">Memorized.</p>}
          </>
        )}
      </div>

      {dataSource && (
        <>
          <p className="muted">
            {rows.length} row{rows.length === 1 ? "" : "s"}.
          </p>
          {rows.length === 0 ? (
            <p className="muted">No results for the current filters.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  {orderedColumns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {orderedColumns.map((c) => (
                      <td key={c.key} className={c.align === "right" ? "amount-cell" : undefined}>
                        {typeof row[c.key] === "number" ? (row[c.key] as number).toFixed(2) : row[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
