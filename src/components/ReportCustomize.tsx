import { useId, useState } from "react";
import { useDismissable } from "../lib/useDismissable";
import { getCompanyInfo } from "../lib/companyStore";
import {
  DATE_PRESET_LABELS,
  DATE_PRESETS,
  FILTER_OPS,
  SUB_COLUMN_LABELS,
  SUB_COLUMNS,
  type DatePreset,
  type FilterOp,
  type ReportFieldInfo,
  type ReportFilter,
  type ReportSourceInfo,
  type ReportSpec,
  type SubColumn,
} from "../lib/reports/spec";

interface Props {
  spec: ReportSpec;
  source: ReportSourceInfo;
  onApply: (spec: ReportSpec) => void;
  onClose: () => void;
}

type Tab = "display" | "filters" | "header" | "numbers";
const TABS: { key: Tab; label: string }[] = [
  { key: "display", label: "Display" },
  { key: "filters", label: "Filters" },
  { key: "header", label: "Header/Footer" },
  { key: "numbers", label: "Numbers" },
];

const OP_LABELS: Record<FilterOp, string> = {
  equals: "is",
  contains: "contains",
  in: "is one of",
  between: "is between",
  gte: "is at least",
  lte: "is at most",
  isEmpty: "is blank",
};

// QuickBooks' Customize Report dialog as a drawer: Display (date range,
// display columns by, total by, measures, sort, sub-columns), Filters,
// Header/Footer and Numbers. Nothing runs until Apply.
export default function ReportCustomize({ spec, source, onApply, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("display");
  const [draft, setDraft] = useState<ReportSpec>(spec);
  const [newFilterField, setNewFilterField] = useState("");
  const titleId = useId();
  // A modal drawer: focus moves in, Tab stays in, Escape closes, focus returns.
  const drawerRef = useDismissable<HTMLElement>(true, onClose, { trap: true });

  const filterFields: ReportFieldInfo[] = [...source.dimensions, ...source.fields.filter((f) => !source.dimensions.some((d) => d.key === f.key))];
  const detail = draft.kind === "detail";
  const set = (patch: Partial<ReportSpec>) => setDraft((d) => ({ ...d, ...patch }));
  const setPresentation = (patch: Partial<ReportSpec["presentation"]>) => setDraft((d) => ({ ...d, presentation: { ...d.presentation, ...patch } }));

  function toggleIn(list: string[], key: string): string[] {
    return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  }
  function setRow(index: number, key: string) {
    const rows = [...draft.rows];
    if (!key) rows.splice(index, 1);
    else rows[index] = key;
    set({ rows: [...new Set(rows)].slice(0, 4) });
  }
  function addFilter() {
    if (!newFilterField) return;
    const field = filterFields.find((f) => f.key === newFilterField);
    if (!field) return;
    const op: FilterOp = field.options ? "equals" : field.kind === "text" ? "contains" : "gte";
    set({ filters: [...draft.filters, { field: field.key, op, value: field.options?.[0]?.value ?? "" }] });
    setNewFilterField("");
  }
  function updateFilter(i: number, patch: Partial<ReportFilter>) {
    set({ filters: draft.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  }
  function removeFilter(i: number) {
    set({ filters: draft.filters.filter((_, j) => j !== i) });
  }
  const fieldLabel = (key: string) => filterFields.find((f) => f.key === key)?.label ?? key;
  const valueLabel = (key: string, value: string) => filterFields.find((f) => f.key === key)?.options?.find((o) => o.value === value)?.label ?? value;
  const company = getCompanyInfo();

  function filterValueInput(f: ReportFilter, i: number) {
    const field = filterFields.find((x) => x.key === f.field);
    if (f.op === "isEmpty") return null;
    if (f.op === "between") {
      return (
        <>
          <input aria-label="From" value={f.values?.[0] ?? ""} onChange={(e) => updateFilter(i, { values: [e.target.value, f.values?.[1] ?? ""] })} />
          <span className="muted">and</span>
          <input aria-label="To" value={f.values?.[1] ?? ""} onChange={(e) => updateFilter(i, { values: [f.values?.[0] ?? "", e.target.value] })} />
        </>
      );
    }
    if (f.op === "in") {
      if (field?.options) {
        return (
          <div className="report-filter-options">
            {field.options.map((o) => (
              <label key={o.value} className="checkbox-line">
                <input type="checkbox" checked={(f.values ?? []).includes(o.value)} onChange={() => updateFilter(i, { values: toggleIn(f.values ?? [], o.value) })} />
                {o.label}
              </label>
            ))}
          </div>
        );
      }
      return <input aria-label="Values" placeholder="one, two, three" value={(f.values ?? []).join(", ")} onChange={(e) => updateFilter(i, { values: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} />;
    }
    if (field?.options && f.op === "equals") {
      return (
        <select aria-label="Value" value={f.value ?? ""} onChange={(e) => updateFilter(i, { value: e.target.value })}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    return <input aria-label="Value" value={f.value ?? ""} onChange={(e) => updateFilter(i, { value: e.target.value })} />;
  }

  return (
    <div className="report-drawer-backdrop" onClick={onClose}>
      <aside className="report-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={drawerRef} onClick={(e) => e.stopPropagation()}>
        <div className="report-drawer-head">
          <h2 id={titleId}>Customize Report</h2>
          <button type="button" className="row-action-outline" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="release-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`release-tab${tab === t.key ? " is-active" : ""}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="report-drawer-body">
          {tab === "display" && (
            <>
              <h4>Report date range</h4>
              <div className="form-row">
                <select aria-label="Date range preset" value={draft.dateRange.preset} onChange={(e) => set({ dateRange: { ...draft.dateRange, preset: e.target.value as DatePreset } })}>
                  {DATE_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {DATE_PRESET_LABELS[p]}
                    </option>
                  ))}
                </select>
                {draft.dateRange.preset === "custom" && (
                  <>
                    <input type="date" aria-label="From date" value={draft.dateRange.from ?? ""} onChange={(e) => set({ dateRange: { ...draft.dateRange, from: e.target.value || undefined } })} />
                    <input type="date" aria-label="To date" value={draft.dateRange.to ?? ""} onChange={(e) => set({ dateRange: { ...draft.dateRange, to: e.target.value || undefined } })} />
                  </>
                )}
              </div>
              {source.dateField && <p className="muted">Dates apply to the {source.dateField}.</p>}

              <h4>Report type</h4>
              <div className="form-row">
                <label className="checkbox-line">
                  <input type="radio" name="kind" checked={!detail} onChange={() => set({ kind: "summary" })} /> Summary
                </label>
                <label className="checkbox-line">
                  <input type="radio" name="kind" checked={detail} onChange={() => set({ kind: "detail", columns: null, subColumns: [] })} /> Detail
                </label>
              </div>

              <h4>{detail ? "Group by" : "Total by"}</h4>
              {[0, 1, 2, 3].slice(0, Math.min(4, draft.rows.length + 1)).map((i) => (
                <select key={i} aria-label={`${detail ? "Group" : "Total"} by level ${i + 1}`} value={draft.rows[i] ?? ""} onChange={(e) => setRow(i, e.target.value)}>
                  <option value="">{i === 0 ? (detail ? "(no grouping)" : "Total only") : "(none)"}</option>
                  {source.dimensions.map((d) => (
                    <option key={d.key} value={d.key} disabled={draft.rows.includes(d.key) && draft.rows[i] !== d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              ))}

              {!detail && (
                <>
                  <h4>Display columns by</h4>
                  <select aria-label="Display columns by" value={draft.columns?.by ?? ""} onChange={(e) => set({ columns: e.target.value ? { by: e.target.value } : null })}>
                    <option value="">Total only</option>
                    {source.dimensions
                      .filter((d) => !draft.rows.includes(d.key))
                      .map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.label}
                        </option>
                      ))}
                  </select>

                  <h4>Measures</h4>
                  <div className="report-check-grid">
                    {source.measures.map((m) => (
                      <label key={m.key} className="checkbox-line">
                        <input type="checkbox" checked={draft.measures.includes(m.key)} onChange={() => set({ measures: toggleIn(draft.measures, m.key) })} />
                        {m.label}
                      </label>
                    ))}
                  </div>

                  <h4>Sub-columns</h4>
                  <div className="report-check-grid">
                    {SUB_COLUMNS.map((sc) => (
                      <label key={sc} className="checkbox-line">
                        <input type="checkbox" checked={draft.subColumns.includes(sc)} onChange={() => set({ subColumns: toggleIn(draft.subColumns, sc) as SubColumn[] })} />
                        {SUB_COLUMN_LABELS[sc]}
                      </label>
                    ))}
                  </div>
                </>
              )}

              {detail && (
                <>
                  <h4>Columns</h4>
                  <div className="report-check-grid">
                    {source.fields.map((f) => {
                      const shown = draft.fields && draft.fields.length > 0 ? draft.fields : source.fields.map((x) => x.key);
                      return (
                        <label key={f.key} className="checkbox-line">
                          <input type="checkbox" checked={shown.includes(f.key)} onChange={() => set({ fields: toggleIn(shown, f.key) })} />
                          {f.label}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}

              <h4>Sort by</h4>
              <div className="form-row">
                <select aria-label="Sort by" value={draft.sort?.by ?? ""} onChange={(e) => set({ sort: e.target.value ? { by: e.target.value, dir: draft.sort?.dir ?? "asc" } : null })}>
                  <option value="">Default</option>
                  {(detail ? source.fields : [...draft.rows.map((k) => source.dimensions.find((d) => d.key === k)).filter((d): d is ReportFieldInfo => Boolean(d)), ...source.measures.filter((m) => draft.measures.includes(m.key))]).map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select aria-label="Sort direction" value={draft.sort?.dir ?? "asc"} disabled={!draft.sort} onChange={(e) => set({ sort: draft.sort ? { ...draft.sort, dir: e.target.value as "asc" | "desc" } : null })}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </div>
            </>
          )}

          {tab === "filters" && (
            <>
              <h4>Current filters</h4>
              {draft.filters.length === 0 ? (
                <p className="muted">No filters: every record in the date range.</p>
              ) : (
                <div className="report-filter-strip">
                  {draft.filters.map((f, i) => (
                    <span key={i} className="report-filter-chip">
                      {fieldLabel(f.field)} {OP_LABELS[f.op]} {f.op === "isEmpty" ? "" : f.op === "in" || f.op === "between" ? (f.values ?? []).map((v) => valueLabel(f.field, v)).join(f.op === "between" ? " – " : ", ") : valueLabel(f.field, f.value ?? "")}
                      <button type="button" aria-label={`Remove ${fieldLabel(f.field)} filter`} onClick={() => removeFilter(i)}>
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <h4>Add a filter</h4>
              <div className="form-row">
                <select aria-label="Filter field" value={newFilterField} onChange={(e) => setNewFilterField(e.target.value)}>
                  <option value="">Choose a field…</option>
                  {filterFields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="secondary-btn" onClick={addFilter} disabled={!newFilterField}>
                  Add
                </button>
              </div>
              {draft.filters.map((f, i) => (
                <div key={i} className="report-filter-row">
                  <b>{fieldLabel(f.field)}</b>
                  <select aria-label={`${fieldLabel(f.field)} operator`} value={f.op} onChange={(e) => updateFilter(i, { op: e.target.value as FilterOp, values: [], value: f.value })}>
                    {FILTER_OPS.map((op) => (
                      <option key={op} value={op}>
                        {OP_LABELS[op]}
                      </option>
                    ))}
                  </select>
                  {filterValueInput(f, i)}
                </div>
              ))}
            </>
          )}

          {tab === "header" && (
            <>
              <label className="form-field">
                Report title
                <input value={draft.presentation.title ?? ""} onChange={(e) => setPresentation({ title: e.target.value || undefined })} />
              </label>
              <label className="form-field">
                Subtitle
                <input value={draft.presentation.subtitle ?? ""} placeholder="The date range when blank" onChange={(e) => setPresentation({ subtitle: e.target.value || undefined })} />
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={draft.presentation.showCompany !== false} onChange={(e) => setPresentation({ showCompany: e.target.checked })} />
                Company name ({company.name})
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={draft.presentation.showDatePrepared !== false} onChange={(e) => setPresentation({ showDatePrepared: e.target.checked })} />
                Date prepared
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={draft.presentation.showPageNumbers !== false} onChange={(e) => setPresentation({ showPageNumbers: e.target.checked })} />
                Page numbers (print)
              </label>
              <label className="form-field">
                Footer line
                <input value={draft.presentation.footer ?? ""} onChange={(e) => setPresentation({ footer: e.target.value || undefined })} />
              </label>
            </>
          )}

          {tab === "numbers" && (
            <>
              <label className="checkbox-line">
                <input type="checkbox" checked={Boolean(draft.presentation.hideZeroRows)} onChange={(e) => setPresentation({ hideZeroRows: e.target.checked })} />
                Hide rows that are all zero
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={Boolean(draft.presentation.divideBy1000)} onChange={(e) => setPresentation({ divideBy1000: e.target.checked })} />
                Divide by 1,000
              </label>
              <h4>Show negative numbers</h4>
              {(["minus", "parens", "red"] as const).map((style) => (
                <label key={style} className="checkbox-line">
                  <input type="radio" name="negativeStyle" checked={(draft.presentation.negativeStyle ?? "minus") === style} onChange={() => setPresentation({ negativeStyle: style })} />
                  {style === "minus" ? "Normally: -300.00" : style === "parens" ? "In parentheses: (300.00)" : "In bright red"}
                </label>
              ))}
            </>
          )}
        </div>

        <div className="report-drawer-foot">
          <button type="button" className="secondary-btn" onClick={() => setDraft(spec)}>
            Revert
          </button>
          <span className="spacer" />
          <button type="button" className="secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-btn" onClick={() => onApply(draft)} disabled={!detail && draft.measures.length === 0}>
            Apply
          </button>
        </div>
      </aside>
    </div>
  );
}
