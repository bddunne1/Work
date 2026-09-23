// Frontend wrapper for the generic /api/counters/:key endpoints (see
// server/src/routes/counters.ts) - backs any human-facing document number
// (vendor PO #, eventually S.O. #, return RA #) that used to be a per-browser
// localStorage counter.
//
// The server stores the *last issued* value (null/absent if the counter has
// never been used). `POST /next` atomically bumps and returns the newly
// issued value directly - callers use that number as-is. Peeking or setting
// "the next number that will be issued" therefore means reading/writing
// (last issued) and (next - 1) respectively; that translation lives here so
// callers only ever think in terms of "next".
import { api } from "./apiClient";

// Next number that will be issued, without reserving it - for display only
// (e.g. Settings' "next PO #" field before anyone saves).
export async function peekNextCounterValue(key: string, start: number): Promise<number> {
  const { value } = await api.get<{ key: string; value: number | null }>(`/api/counters/${key}`);
  return value === null ? start : value + 1;
}

// Atomically reserves and returns the next number for `key`, seeding the
// series at `start` the first time it's ever called. Two concurrent callers
// can never get the same number back.
export async function reserveNextCounterValue(key: string, start: number): Promise<number> {
  const { value } = await api.post<{ key: string; value: number }>(`/api/counters/${key}/next`, { start });
  return value;
}

// Admin override: makes `next` the next number that will be issued.
export async function setNextCounterValue(key: string, next: number): Promise<void> {
  await api.put<{ key: string; value: number }>(`/api/counters/${key}`, { value: next - 1 });
}
