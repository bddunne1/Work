// Drives the "Review Queue" flow shared by Validation, Allocation, and
// Pick & Pack: the list page snapshots the current queue of S.O. numbers
// once, and each decision page steps to the next one in that snapshot
// after its action completes, via router state rather than re-querying
// the live list (which would also pick up newly-arrived orders mid-review).
export interface ReviewQueueState {
  queue: string[];
  pos: number;
}

export function queueProgressLabel(state?: ReviewQueueState): string | null {
  if (!state) return null;
  return `Reviewing ${state.pos + 1} of ${state.queue.length}`;
}

// "Skip" on a decision page parks the order for the rest of this browser
// session (R4-19): it drops out of the list and the queue, so two analysts
// working the same queue stop colliding on the one order neither wants.
export type QueueKind = "validation" | "allocation";

function skipKey(kind: QueueKind): string {
  return `erp.reviewQueue.skipped.${kind}`;
}

export function skippedSoNumbers(kind: QueueKind): Set<string> {
  try {
    const raw = sessionStorage.getItem(skipKey(kind));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function skipSoNumber(kind: QueueKind, soNumber: string): void {
  const next = skippedSoNumbers(kind);
  next.add(String(soNumber));
  try {
    sessionStorage.setItem(skipKey(kind), JSON.stringify([...next]));
  } catch {
    // Storage unavailable: the skip just does not persist.
  }
}

export function clearSkipped(kind: QueueKind): void {
  try {
    sessionStorage.removeItem(skipKey(kind));
  } catch {
    // ignore
  }
}

// Oldest first: the order that has waited longest is the one to review,
// by due date and then by order date (R4-19). Newest-first starved the
// backlog.
export function byOldestFirst<T extends { dueDate?: string; orderDate: string; soNumber: string }>(a: T, b: T): number {
  return (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.orderDate.localeCompare(b.orderDate) || Number(a.soNumber) - Number(b.soNumber);
}

export function nextQueueSoNumber(state?: ReviewQueueState): string | null {
  if (!state) return null;
  const nextPos = state.pos + 1;
  return nextPos < state.queue.length ? state.queue[nextPos] : null;
}
