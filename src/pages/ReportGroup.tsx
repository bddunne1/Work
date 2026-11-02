import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import BackLink from "../components/BackLink";
import ReportGrid from "../components/ReportGrid";
import { getCompanyInfo } from "../lib/companyStore";
import { listSources } from "../lib/reports/engineClient";
import { describeRange } from "../lib/reports/format";
import type { ReportSourceInfo } from "../lib/reports/spec";
import { runReportGroup, type GroupRun } from "../lib/reportStore";

// Print group: every memorized report in a group, run together and laid
// out one after another for one print job.
export default function ReportGroup() {
  const { name = "" } = useParams<{ name: string }>();
  const [run, setRun] = useState<GroupRun | null>(null);
  const [sources, setSources] = useState<ReportSourceInfo[]>([]);
  const [error, setError] = useState<string | undefined>();
  const company = getCompanyInfo();

  useEffect(() => {
    runReportGroup(name)
      .then(setRun)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    listSources().then(setSources).catch(() => {});
  }, [name]);

  return (
    <div className="page report-page report-page--numbered">
      <div className="page-header no-print">
        <BackLink fallback="/reports" label="Report Center" />
        <h1>{name}</h1>
        <p className="muted">{run ? `${run.reports.length} report${run.reports.length === 1 ? "" : "s"} in this group, run ${new Date(run.generatedAt).toLocaleTimeString()}.` : error ?? "Running the group…"}</p>
      </div>
      <div className="report-toolbar no-print">
        <span className="spacer" />
        <button type="button" className="primary-btn print-btn" onClick={() => window.print()} disabled={!run}>
          Print group
        </button>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {run?.reports.map((r) => {
        const source = sources.find((s) => s.key === r.spec.source);
        const rowDims = (r.spec.rows ?? []).map((k) => ({ key: k, label: source?.dimensions.find((d) => d.key === k)?.label ?? k }));
        return (
          <section key={r.id} className="report-group-item">
            <div className="report-header-print">
              {r.spec.presentation?.showCompany !== false && <p>{company.name}</p>}
            </div>
            <h2>{r.spec.presentation?.title || r.name}</h2>
            <p className="muted">{r.result ? r.spec.presentation?.subtitle || describeRange(r.result, r.spec) : r.error}</p>
            {r.result && <ReportGrid result={r.result} rowDims={rowDims} presentation={r.spec.presentation} collapsedAll={false} />}
          </section>
        );
      })}
    </div>
  );
}
