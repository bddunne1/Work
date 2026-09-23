import type { ReturnAuthorization } from "../types";

const RETURNS_KEY = "erp_returns";
const RETURN_COUNTER_KEY = "erp_return_counter";
const RETURN_START = 3001;

function readReturns(): ReturnAuthorization[] {
  try {
    const raw = localStorage.getItem(RETURNS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ReturnAuthorization[];
  } catch {
    return [];
  }
}

function writeReturns(returns: ReturnAuthorization[]): void {
  try {
    localStorage.setItem(RETURNS_KEY, JSON.stringify(returns));
  } catch {
    // storage unavailable (private mode, blocked site data, etc.) - no-op
  }
}

export function nextReturnNumber(): string {
  try {
    const raw = localStorage.getItem(RETURN_COUNTER_KEY);
    const current = raw ? parseInt(raw, 10) : RETURN_START;
    return `RA-${current}`;
  } catch {
    return `RA-${RETURN_START}`;
  }
}

function commitReturnNumber(): void {
  try {
    const raw = localStorage.getItem(RETURN_COUNTER_KEY);
    const current = raw ? parseInt(raw, 10) : RETURN_START;
    localStorage.setItem(RETURN_COUNTER_KEY, String(current + 1));
  } catch {
    // storage unavailable - no-op
  }
}

export function listReturns(): ReturnAuthorization[] {
  return readReturns().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getReturn(raNumber: string): ReturnAuthorization | undefined {
  return readReturns().find((r) => r.raNumber === raNumber);
}

export function saveReturn(ra: ReturnAuthorization): void {
  const returns = readReturns();
  returns.push(ra);
  writeReturns(returns);
  commitReturnNumber();
}

export function updateReturn(ra: ReturnAuthorization): void {
  const returns = readReturns().map((r) => (r.raNumber === ra.raNumber ? ra : r));
  writeReturns(returns);
}
