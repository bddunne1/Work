import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import BackLink from "../components/BackLink";
import Pager from "../components/Pager";
import ReportGrid from "../components/ReportGrid";
import { ApiError } from "../lib/apiClient";
import { getCompanyInfo } from "../lib/companyStore";
import { csvCell } from "../lib/csv";
import { describeRange } from "../lib/reports/format";
import { listCatalog, listSources, runReport, type StandardReport } from "../lib/reports/engineClient";
import { DATE_PRESET_LABELS, DATE_PRESETS, decodeSpec, encodeSpec, type DatePreset, type ReportResult, type ReportSourceInfo, type ReportSpec } from "../lib/reports/spec";
import { getSavedReport } from "../lib/reportStore";

const PAGE_SIZE = 200;

function resultToCsv(result: ReportResult, rowDims: { key: string; label: string }[]): string {
  const head = [...(result.kind === "summary" ? rowDims.map((d) => d.label) : []), ...result.columns.map((c) => c.label)];
  const lines = [head.map(csvCell).join(",")];
  const label = (dim: string, v: string | null) => (v === null ? "" : (result.labels[dim]?.[v] ?? v));
  for (const r of result.rows) {
    const dims = result.kind === "summary" ? rowDims.map((d) => label(d.key, r.dims[d.key] ?? null)) : [];
    lines.push([...dims, ...result.columns.map((c) => String(r.cells[c.key] ?? ""))].map(csvCell).join(","));
  }
  if (result.rows.length > 0) {
    lines.push([...(result.kind === "summary" ? ["Total", ...rowDims.slice(1).map(() => "")] : []), ...result.columns.map((c) => String(result.total[c.key] ?? ""))].map(csvCell).join(","));
  }
  return lines.join("\n");
}

// Runs one spec and draws its result. The spec travels in the URL (?spec=,
// base64 JSON) so Back returns to a report with its state; a standard
// report's key or a memorized report's id supplies the starting spec.
export default function ReportRunner() {
  const { presetKey, savedId } = useParams<{ presetKey?: string; savedId?: string }>();
  const [params, setParams] = useSearchParams();
  const [standard, setStandard] = useState<StandardReport | undefined>();
  const [savedName, setSavedName] = useState<string | undefined>();
  const [spec, setSpec] = useState<ReportSpec | null>(() => {
    const s = params.get("spec");
    return s ? decodeSpec(s) : null;
  });
  const [source, setSource] = useState<ReportSourceInfo | undefined>();
  const [result, setResult] = useState<ReportResult | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const runId = useRef(0);

  // The starting spec: from the URL, else the standard report, else the memorized one.
  useEffect(() => {
    let cancelled = false;
    if (presetKey) {
      listCatalog().then((c) => {
        if (cancelled) return;
        const r = c.find((x) => x.key === presetKey);
        setStandard(r);
        if (r && !params.get("spec")) setSpec(r.spec);
      });
    } else if (savedId) {
      getSavedReport(savedId).then((r) => {
        if (cancelled || !r) return;
        setSavedName(r.name);
        if (!params.get("spec")) setSpec(r.spec);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey, savedId]);

  useEffect(() => {
    if (!spec) return;
    listSources()
      .then((all) => setSource(all.find((s) => s.key === spec.source)))
      .catch(() => {});
  }, [spec]);

  const run = useCallback(
    (s: ReportSpec, p: number) => {
      const id = ++runId.current;
      setLoading(true);
      setError(undefined);
      runReport(s, { page: p, pageSize: PAGE_SIZE })
        .then((r) => {
          if (id !== runId.current) return;
          setResult(r);
        })
        .catch((err) => {
          if (id !== runId.current) return;
          setResult(null);
          setError(err instanceof ApiError && err.status === 403 ? `Your account can't read this data: ${err.message}` : err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (id === runId.current) setLoading(false);
        });
    },
    []
  );

  // A report runs when it opens and whenever its spec or page changes.
  useEffect(() => {
    if (spec) run(spec, page);
  }, [spec, page, run]);

  function updateSpec(next: ReportSpec) {
    setSpec(next);
    setPage(1);
    setParams((p) => {
      p.set("spec", encodeSpec(next));
      return p;
    }, { replace: true });
  }

  const rowDims = useMemo(
    () => (spec?.rows ?? []).map((k) => ({ key: k, label: source?.dimensions.find((d) => d.key === k)?.label ?? k })),
    [spec?.rows, source]
  );
  const title = spec?.presentation.title || standard?.name || savedName || "Report";
  const company = getCompanyInfo();

  function exportCsv() {
    if (!result) return;
    const csv = resultToCsv(result, rowDims);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!spec) {
    return (
      <div className="page">
        <div className="page-header">
          <BackLink fallback="/reports" label="Report Center" />
          <h1>Report</h1>
        </div>
        <p className="muted">{error ?? "Choose a report from the Report Center."}</p>
      </div>
    );
  }

  const rangeText = describeRange(result, spec);
  const rowCount = result ? (result.kind === "detail" ? (result.totalRows ?? result.rows.length) : result.rows.length) : 0;

  return (
    <div className="page report-page">
      <div className="page-header no-print">
        <BackLink fallback="/reports" label="Report Center" />
        <h1>{title}</h1>
        <p className="muted">{spec.presentation.subtitle || standard?.description || ""}</p>
      </div>

      <div className="report-header-print">
        {spec.presentation.showCompany !== false && <p>{company.name}</p>}
        <h1>{title}</h1>
        <p>{spec.presentation.subtitle || rangeText}</p>
        {spec.presentation.showDatePrepared !== false && <p className="muted">Prepared {new Date().toLocaleString()}</p>}
      </div>

      <div className="report-toolbar no-print">
        <label className="form-field" style={{ margin: 0 }}>
          <span className="sr-only">Date range</span>
          <select aria-label="Date range" value={spec.dateRange.preset} onChange={(e) => updateSpec({ ...spec, dateRange: { ...spec.dateRange, preset: e.target.value as DatePreset } })}>
            {DATE_PRESETS.map((p) => (
              <option key={p} value={p}>
                {DATE_PRESET_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        {spec.dateRange.preset === "custom" && (
          <>
            <input type="date" aria-label="From" value={spec.dateRange.from ?? ""} onChange={(e) => updateSpec({ ...spec, dateRange: { ...spec.dateRange, from: e.target.value || undefined } })} />
            <input type="date" aria-label="To" value={spec.dateRange.to ?? ""} onChange={(e) => updateSpec({ ...spec, dateRange: { ...spec.dateRange, to: e.target.value || undefined } })} />
          </>
        )}
        <span className="muted">{rangeText}</span>
        <span className="spacer" />
        <button type="button" className="secondary-btn" onClick={() => spec && run(spec, page)} disabled={loading}>
          {loading ? "Running…" : "Refresh"}
        </button>
        <button type="button" className="secondary-btn" onClick={exportCsv} disabled={!result || result.rows.length === 0}>
          Export CSV
        </button>
        <button type="button" className="secondary-btn print-btn" onClick={() => window.print()}>
          Print
        </button>
      </div>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <>
          <p className="muted no-print">
            {rowCount.toLocaleString()} row{rowCount === 1 ? "" : "s"}
            {result.hidden.length > 0 ? ` · ${result.hidden.length} column${result.hidden.length === 1 ? "" : "s"} not shown to this login` : ""}
            {` · as of ${new Date(result.generatedAt).toLocaleTimeString()}`}
          </p>
          <ReportGrid result={result} rowDims={rowDims} presentation={spec.presentation} />
          {result.kind === "detail" && (result.totalRows ?? 0) > PAGE_SIZE && (
            <Pager page={page} pageSize={PAGE_SIZE} total={result.totalRows ?? 0} onPageChange={setPage} loading={loading} />
          )}
        </>
      )}
      {spec.presentation.footer && <p className="muted report-footer">{spec.presentation.footer}</p>}
    </div>
  );
}
