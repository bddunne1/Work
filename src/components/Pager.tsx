const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  loading?: boolean;
}

// "Prev / Page X of Y / Next" + page size, for lists paged on the server.
export default function Pager({ page, pageSize, total, onPageChange, onPageSizeChange, loading }: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="toolbar no-print" style={{ alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
      <span className="muted">
        {total === 0 ? "No results" : `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`}
        {loading ? " · Loading…" : ""}
      </span>
      <div className="inline-actions" style={{ alignItems: "center" }}>
        <button
          type="button"
          className="secondary-btn"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(page - 1)}
        >
          Prev
        </button>
        <span>
          Page {page.toLocaleString()} of {pageCount.toLocaleString()}
        </span>
        <button
          type="button"
          className="secondary-btn"
          disabled={page >= pageCount || loading}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
        {onPageSizeChange && (
          <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            Per page
            <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
