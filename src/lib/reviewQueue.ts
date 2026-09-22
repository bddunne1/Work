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

export function nextQueueSoNumber(state?: ReviewQueueState): string | null {
  if (!state) return null;
  const nextPos = state.pos + 1;
  return nextPos < state.queue.length ? state.queue[nextPos] : null;
}
