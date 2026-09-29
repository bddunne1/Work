import type { SyncInfo } from "../types";

// How far a document has got on its way to QuickBooks.
const LABELS: Record<string, string> = {
  SYNCED: "In QuickBooks",
  DONE: "Done",
  PENDING: "Queued",
  PROCESSING: "Sending…",
  FAILED: "Retrying",
  DEAD: "Failed",
  NOT_QUEUED: "Not queued",
};

export default function SyncPill({ sync }: { sync?: SyncInfo | null }) {
  if (!sync) return <span className="muted">—</span>;
  const status = sync.status.toUpperCase();
  return (
    <span className={`sync-pill sync-pill-${status.toLowerCase()}`} title={sync.lastError ?? (sync.externalId ? `QuickBooks id ${sync.externalId}` : undefined)}>
      {LABELS[status] ?? status}
    </span>
  );
}
