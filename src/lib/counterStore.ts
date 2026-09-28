// Frontend wrapper for the /api/counters/:key endpoints (see
// server/src/routes/counters.ts) - backs the human-facing document numbers
// (S.O. #, vendor PO #, return RA #).
//
// The server stores the *last issued* value (null/absent if the counter has
// never been used) and assigns the next one itself inside each document's
// create transaction. Peeking or setting "the next number that will be
// issued" therefore means reading/writing (last issued) and (next - 1)
// respectively; that translation lives here so callers only ever think in
// terms of "next".
import { api } from "./apiClient";

// Next number that will be issued, without reserving it - for display only
// (e.g. Settings' "next PO #" field before anyone saves).
export async function peekNextCounterValue(key: string, start: number): Promise<number> {
  const { value } = await api.get<{ key: string; value: number | null }>(`/api/counters/${key}`);
  return value === null ? start : value + 1;
}

// Admin override: makes `next` the next number that will be issued.
export async function setNextCounterValue(key: string, next: number): Promise<void> {
  await api.put<{ key: string; value: number }>(`/api/counters/${key}`, { value: next - 1 });
}
