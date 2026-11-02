import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatCell, isNumericKind, isZeroRow } from "../lib/reports/format";
import type { ReportCell, ReportPresentation, ReportResult, ReportResultColumn, ReportResultRow, ValueKind } from "../lib/reports/spec";

interface Props {
  result: ReportResult;
  // Dimension keys in row order, with their labels, so group headers and
  // subtotal rows can name what they total.
  rowDims: { key: string; label: string }[];
  presentation?: ReportPresentation;
  // QuickZoom: a summary cell or a detail group header links here.
  zoomTo?: (dims: Record<string, string | null>, column: ReportResultColumn | null) => string | null;
  collapsedAll?: boolean;
}

// Renders any engine result: a summary grid with pivot column groups,
// subtotal rows and a grand total, or a detail grid grouped by the row
// dimension with collapsible groups. Numbers are right-aligned, negatives
// styled as the report's Numbers tab says, dimension values labeled
// (statuses read "Released", not "PICK_PACKED").
export default function ReportGrid({ result, rowDims, presentation = {}, zoomTo, collapsedAll }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [allCollapsed, setAllCollapsed] = useState(false);
  const kinds = useMemo(() => Object.fromEntries(result.columns.map((c) => [c.key, c.kind])) as Record<string, ValueKind>, [result.columns]);
  const label = (dim: string, value: string | null) => (value === null || value === "" ? "(none)" : (result.labels[dim]?.[value] ?? value));
  const rows = presentation.hideZeroRows ? result.rows.filter((r) => !isZeroRow(r.cells, kinds)) : result.rows;

  const effectiveCollapsedAll = collapsedAll ?? allCollapsed;
  const isCollapsed = (key: string) => (effectiveCollapsedAll ? !collapsed.has(key) : collapsed.has(key));
  const toggle = (key: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const subtotalFor = (dims: Record<string, string | null>, depth: number) =>
    result.subtotals.find((st) => Object.keys(st.dims).length === depth && rowDims.slice(0, depth).every((d) => st.dims[d.key] === dims[d.key]));

  const cell = (c: ReportResultColumn, value: ReportCell, dims?: Record<string, string | null>, key?: string) => {
    const f = formatCell(c.kind, value, presentation);
    const numeric = isNumericKind(c.kind);
    const cls = [numeric ? "amount-cell" : "", f.negative && presentation.negativeStyle === "red" ? "report-negative" : ""].filter(Boolean).join(" ") || undefined;
    const href = dims && zoomTo && result.kind === "summary" && numeric && value !== null ? zoomTo(dims, c) : null;
    return (
      <td key={key ?? c.key} className={cls}>
        {href ? (
          <Link to={href} className="report-zoom">
            {f.text}
          </Link>
        ) : (
          f.text
        )}
      </td>
    );
  };

  // Columns grouped by measure for the two-row header a pivot needs.
  const pivoted = result.kind === "summary" && result.columns.some((c) => c.pivot !== null && c.pivot !== undefined);
  const groups: { label: string; columns: ReportResultColumn[] }[] = [];
  if (pivoted) {
    for (const c of result.columns) {
      const last = groups[groups.length - 1];
      if (last && last.columns[0].measure === c.measure) last.columns.push(c);
      else groups.push({ label: c.measure ?? "", columns: [c] });
    }
  }
  const measureLabel = (key: string) => result.columns.find((c) => c.measure === key)?.measureLabel ?? key;
  const subLabel = (c: ReportResultColumn) => (c.sub === "previousPeriod" ? "Prev. Period" : c.sub === "previousYear" ? "Prev. Year" : c.sub === "pctOfRow" ? "% of Row" : c.sub === "pctOfColumn" ? "% of Column" : "");
  const headerText = (c: ReportResultColumn) => (c.sub ? `${pivoted ? c.label + " " : ""}${subLabel(c)}` : c.label);

  const depth = rowDims.length;
  const dimCols = result.kind === "summary" ? Math.max(1, depth) : 0;

  // Summary rows nest by leading dimension: a header when a prefix starts,
  // a subtotal when it ends.
  const body: React.ReactNode[] = [];
  if (result.kind === "summary") {
    let prev: (string | null)[] = [];
    const closeFrom = (level: number, dims: (string | null)[]) => {
      for (let k = depth - 1; k >= level; k--) {
        if (k === 0) continue;
        const stDims = Object.fromEntries(rowDims.slice(0, k).map((d, i) => [d.key, dims[i]]));
        const st = subtotalFor(stDims, k);
        body.push(
          <tr key={`st-${k}-${dims.slice(0, k).join("|")}-${body.length}`} className="report-subtotal">
            <td colSpan={dimCols} style={{ paddingLeft: `${(k - 1) * 18 + 10}px` }}>
              Total {label(rowDims[k - 1].key, dims[k - 1])}
            </td>
            {result.columns.map((c) => cell(c, st?.cells[c.key] ?? null, stDims, c.key))}
          </tr>
        );
      }
    };
    rows.forEach((r, idx) => {
      const vals = rowDims.map((d) => r.dims[d.key] ?? null);
      let firstDiff = 0;
      while (firstDiff < depth - 1 && prev.length > 0 && prev[firstDiff] === vals[firstDiff]) firstDiff++;
      if (prev.length > 0 && depth > 1) closeFrom(firstDiff + 1, prev);
      for (let k = firstDiff; k < depth - 1; k++) {
        if (prev.length > 0 && k < firstDiff) continue;
        body.push(
          <tr key={`hd-${k}-${vals.slice(0, k + 1).join("|")}-${idx}`} className="report-group-header">
            <td colSpan={dimCols + result.columns.length} style={{ paddingLeft: `${k * 18 + 10}px` }}>
              {label(rowDims[k].key, vals[k])}
            </td>
          </tr>
        );
      }
      const leafDims = Object.fromEntries(rowDims.map((d, i) => [d.key, vals[i]]));
      const leafHref = zoomTo && depth > 0 ? zoomTo(leafDims, null) : null;
      body.push(
        <tr key={`r-${vals.join("|")}-${idx}`}>
          {depth === 0 ? (
            <td>Total</td>
          ) : (
            <td colSpan={dimCols} style={{ paddingLeft: `${(depth - 1) * 18 + 10}px` }}>
              {leafHref ? (
                <Link to={leafHref} className="report-zoom">
                  {label(rowDims[depth - 1].key, vals[depth - 1])}
                </Link>
              ) : (
                label(rowDims[depth - 1].key, vals[depth - 1])
              )}
            </td>
          )}
          {result.columns.map((c) => cell(c, r.cells[c.key] ?? null, leafDims, c.key))}
        </tr>
      );
      prev = vals;
    });
    if (prev.length > 0 && depth > 1) closeFrom(1, prev);
  } else {
    // Detail rows grouped by the row dimension(s), collapsible per group.
    let prevKey: string | null = null;
    const groupKey = (r: ReportResultRow) => JSON.stringify(rowDims.map((d) => r.dims[d.key] ?? null));
    const textCol = result.columns.find((c) => !isNumericKind(c.kind));
    rows.forEach((r, idx) => {
      const key = groupKey(r);
      if (depth > 0 && key !== prevKey) {
        if (prevKey !== null) {
          const prevDims = JSON.parse(prevKey) as (string | null)[];
          const stDims = Object.fromEntries(rowDims.map((d, i) => [d.key, prevDims[i]]));
          const st = subtotalFor(stDims, depth);
          if (st && !isCollapsed(prevKey)) {
            body.push(
              <tr key={`st-${prevKey}-${idx}`} className="report-subtotal">
                <td>Total {rowDims.map((d, i) => label(d.key, prevDims[i])).join(" · ")}</td>
                {result.columns.map((c) => cell(c, c.sum ? (st.cells[c.key] ?? null) : null, undefined, c.key))}
              </tr>
            );
          }
        }
        const vals = rowDims.map((d) => r.dims[d.key] ?? null);
        const dims = Object.fromEntries(rowDims.map((d, i) => [d.key, vals[i]]));
        const st = subtotalFor(dims, depth);
        const count = st?.cells._count;
        body.push(
          <tr key={`hd-${key}-${idx}`} className="report-group-header">
            <td colSpan={result.columns.length + 1}>
              <button type="button" className="report-group-toggle" aria-expanded={!isCollapsed(key)} onClick={() => toggle(key)}>
                {isCollapsed(key) ? "▸" : "▾"} {rowDims.map((d, i) => label(d.key, vals[i])).join(" · ")}
                {typeof count === "number" ? <span className="muted"> ({count.toLocaleString()})</span> : null}
              </button>
            </td>
          </tr>
        );
        prevKey = key;
      }
      if (depth > 0 && isCollapsed(key)) return;
      body.push(
        <tr key={`r-${idx}`}>
          <td className="report-row-index">{r.link ? <Link to={r.link} className="report-zoom" aria-label="Open document">↗</Link> : null}</td>
          {result.columns.map((c) => {
            const v = r.cells[c.key] ?? null;
            if (c === textCol && r.link) {
              return (
                <td key={c.key}>
                  <Link to={r.link} className="report-zoom">
                    {c.dimension ? label(c.dimension, v === null ? null : String(v)) : formatCell(c.kind, v, presentation).text}
                  </Link>
                </td>
              );
            }
            if (c.dimension && !isNumericKind(c.kind)) return <td key={c.key}>{label(c.dimension, v === null ? null : String(v))}</td>;
            return cell(c, v, undefined, c.key);
          })}
        </tr>
      );
    });
    if (prevKey !== null) {
      const prevDims = JSON.parse(prevKey) as (string | null)[];
      const stDims = Object.fromEntries(rowDims.map((d, i) => [d.key, prevDims[i]]));
      const st = subtotalFor(stDims, depth);
      if (st && !isCollapsed(prevKey)) {
        body.push(
          <tr key={`st-${prevKey}-end`} className="report-subtotal">
            <td>Total {rowDims.map((d, i) => label(d.key, prevDims[i])).join(" · ")}</td>
            {result.columns.map((c) => cell(c, c.sum ? (st.cells[c.key] ?? null) : null, undefined, c.key))}
          </tr>
        );
      }
    }
  }

  const hasTotal = result.kind === "summary" ? depth > 0 : true;
  const groupCount = result.kind === "detail" && depth > 0 ? new Set(rows.map((r) => JSON.stringify(rowDims.map((d) => r.dims[d.key] ?? null)))).size : 0;

  return (
    <div className="report-grid-wrap">
      {result.kind === "detail" && depth > 0 && groupCount > 0 && collapsedAll === undefined && (
        <div className="inline-actions no-print report-grid-tools">
          <button type="button" className="row-action-outline" onClick={() => { setAllCollapsed(true); setCollapsed(new Set()); }}>
            Collapse all
          </button>
          <button type="button" className="row-action-outline" onClick={() => { setAllCollapsed(false); setCollapsed(new Set()); }}>
            Expand all
          </button>
        </div>
      )}
      <table className={`data-table report-grid${result.kind === "detail" ? " report-grid-detail" : ""}`}>
        <thead>
          {pivoted && (
            <tr className="report-pivot-header">
              <th colSpan={dimCols} />
              {groups.map((g) => (
                <th key={g.label} colSpan={g.columns.length} className="report-pivot-group">
                  {measureLabel(g.label)}
                </th>
              ))}
            </tr>
          )}
          <tr>
            {result.kind === "summary" ? <th colSpan={dimCols}>{rowDims.map((d) => d.label).join(" / ") || ""}</th> : <th className="report-row-index" />}
            {result.columns.map((c) => (
              <th key={c.key} className={isNumericKind(c.kind) ? "amount-cell" : undefined}>
                {headerText(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body}
          {rows.length === 0 && (
            <tr>
              <td colSpan={result.columns.length + Math.max(1, dimCols)} className="muted">
                Nothing in this period for these filters.
              </td>
            </tr>
          )}
        </tbody>
        {hasTotal && rows.length > 0 && (
          <tfoot>
            <tr className="report-total">
              <td colSpan={result.kind === "summary" ? dimCols : 1}>Total</td>
              {result.columns.map((c) => (
                <Fragment key={c.key}>{cell(c, result.kind === "detail" && !c.sum ? null : (result.total[c.key] ?? null), result.kind === "summary" ? {} : undefined, c.key)}</Fragment>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
