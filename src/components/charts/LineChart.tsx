export interface LinePoint {
  label: string;
  value: number;
}

interface Props {
  points: LinePoint[];
  color?: string;
  valueFormatter?: (value: number) => string;
  height?: number;
}

const WIDTH = 640;
const PADDING = { top: 24, right: 32, bottom: 26, left: 32 };

export default function LineChart({ points, color, valueFormatter, height = 200 }: Props) {
  const format = valueFormatter ?? ((v: number) => String(v));

  if (points.length === 0) {
    return <p className="muted">No data yet.</p>;
  }

  const innerW = WIDTH - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const xFor = (i: number) => PADDING.left + i * stepX;
  const yFor = (v: number) => PADDING.top + innerH - ((v - min) / range) * innerH;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p.value).toFixed(1)}`)
    .join(" ");
  const stroke = color ?? "var(--chart-seq-1)";
  const showAllLabels = points.length <= 8;
  // With many points, an axis label per point overlaps into unreadable
  // mush - thin them out to roughly 8 evenly-spaced labels instead, always
  // keeping the first and last.
  const axisLabelStep = showAllLabels ? 1 : Math.ceil(points.length / 8);
  const showAxisLabel = (i: number) => showAllLabels || i === 0 || i === points.length - 1 || i % axisLabelStep === 0;

  return (
    <div className="line-chart-wrap">
      <svg
        className="line-chart"
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label="Line chart"
      >
        <line
          x1={PADDING.left}
          y1={PADDING.top + innerH}
          x2={WIDTH - PADDING.right}
          y2={PADDING.top + innerH}
          className="line-chart-axis"
        />
        <path d={path} className="line-chart-path" style={{ stroke }} fill="none" />
        {points.map((p, i) => (
          <g key={`${p.label}-${i}`}>
            <circle cx={xFor(i)} cy={yFor(p.value)} r={10} className="line-chart-hit" fill="transparent">
              <title>{`${p.label}: ${format(p.value)}`}</title>
            </circle>
            <circle cx={xFor(i)} cy={yFor(p.value)} r={4} className="line-chart-dot" style={{ fill: stroke }} />
            {(showAllLabels || i === 0 || i === points.length - 1) && (
              <text
                x={xFor(i)}
                y={Math.max(12, yFor(p.value) - 10)}
                textAnchor="middle"
                className="line-chart-value-label"
              >
                {format(p.value)}
              </text>
            )}
          </g>
        ))}
        {points.map(
          (p, i) =>
            showAxisLabel(i) && (
              <text
                key={`label-${p.label}-${i}`}
                x={xFor(i)}
                y={height - 8}
                textAnchor="middle"
                className="line-chart-axis-label"
              >
                {p.label}
              </text>
            )
        )}
      </svg>
      <details className="chart-table-toggle">
        <summary>View as table</summary>
        <table className="data-table chart-data-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={`row-${p.label}-${i}`}>
                <td>{p.label}</td>
                <td>{format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
