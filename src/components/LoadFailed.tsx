// A list page whose data didn't load says so, with a retry, instead of
// showing an empty table that looks like "nothing here" (C-01).
export default function LoadFailed({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return (
    <div className="load-failed" role="alert">
      <span>Couldn't load {what}. Check the connection and try again.</span>
      {onRetry && (
        <button type="button" className="secondary-btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
