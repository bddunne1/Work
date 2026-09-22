export interface BarListItem {
  label: string;
  value: number;
  sublabel?: string;
}

interface Props {
  items: BarListItem[];
  colorFor?: (item: BarListItem, index: number) => string;
  valueFormatter?: (value: number) => string;
  emptyMessage?: string;
}

export default function BarList({ items, colorFor, valueFormatter, emptyMessage }: Props) {
  if (items.length === 0) {
    return <p className="muted">{emptyMessage ?? "No data yet."}</p>;
  }

  const max = Math.max(...items.map((i) => i.value), 1);
  const format = valueFormatter ?? ((v: number) => String(v));

  return (
    <div className="bar-list" role="img" aria-label="Bar chart">
      {items.map((item, idx) => (
        <div
          className="bar-list-row"
          key={`${item.label}-${idx}`}
          title={`${item.label}: ${format(item.value)}`}
        >
          <div className="bar-list-label">
            {item.label}
            {item.sublabel && <span className="bar-list-sublabel"> · {item.sublabel}</span>}
          </div>
          <div className="bar-list-track">
            <div
              className="bar-list-fill"
              style={{
                width: `${Math.max(2, (item.value / max) * 100)}%`,
                background: colorFor ? colorFor(item, idx) : "var(--chart-seq-1)",
              }}
            />
          </div>
          <div className="bar-list-value">{format(item.value)}</div>
        </div>
      ))}
    </div>
  );
}
