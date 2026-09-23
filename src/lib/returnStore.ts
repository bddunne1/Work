import { api } from "./apiClient";
import { peekNextCounterValue } from "./counterStore";
import type { ReturnAuthorization } from "../types";

const RETURN_COUNTER_KEY = "return";
const RETURN_START = 3001;

// The server's decimal fields serialize over JSON as strings - convert back
// so every consumer keeps working with the number shapes it always has.
function mapReturn(ra: ReturnAuthorization): ReturnAuthorization {
  return {
    ...ra,
    requestDate: ra.requestDate.slice(0, 10),
    lines: ra.lines.map((l) => ({ ...l, rate: Number(l.rate) })),
  };
}

// Next RA # that will be assigned, for display only (the form's disabled
// "RA No." preview field before anyone saves) - doesn't reserve anything.
export async function nextReturnNumber(): Promise<string> {
  const next = await peekNextCounterValue(RETURN_COUNTER_KEY, RETURN_START);
  return `RA-${next}`;
}

export async function listReturns(): Promise<ReturnAuthorization[]> {
  const returns = await api.get<ReturnAuthorization[]>("/api/returns");
  return returns.map(mapReturn);
}

export async function getReturn(raNumber: string): Promise<ReturnAuthorization | undefined> {
  try {
    const ra = await api.get<ReturnAuthorization>(`/api/returns/${encodeURIComponent(raNumber)}`);
    return mapReturn(ra);
  } catch {
    return undefined;
  }
}

// Creates a new return - the server assigns the real RA # atomically, so
// this takes everything except that field and returns the saved record
// (with its real raNumber) to the caller.
export async function saveReturn(ra: Omit<ReturnAuthorization, "raNumber">): Promise<ReturnAuthorization> {
  return mapReturn(await api.post<ReturnAuthorization>("/api/returns", ra));
}

export async function updateReturn(ra: ReturnAuthorization): Promise<void> {
  await api.put(`/api/returns/${encodeURIComponent(ra.raNumber)}`, ra);
}
