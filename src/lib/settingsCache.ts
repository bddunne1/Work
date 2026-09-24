import { api } from "./apiClient";

// App-wide settings (company profile, lead time, capacity lookback) live in
// Postgres, but are read synchronously in a lot of places - including the
// page header on every single navigation - so a per-read fetch would mean
// a loading flicker on every page. Instead: warm this in-memory cache once
// per session (see preloadSettings, called right after login) and read
// from it synchronously after that. This is a runtime cache, not
// localStorage - it holds nothing across reloads or browsers, and every
// write goes straight to the database.
let cache: Record<string, unknown> | null = null;
let loading: Promise<Record<string, unknown>> | null = null;

async function load(): Promise<Record<string, unknown>> {
  if (cache) return cache;
  if (!loading) {
    loading = api
      .get<Record<string, unknown>>("/api/settings")
      .then((s) => {
        cache = s;
        return s;
      })
      .catch(() => {
        // Don't cache the failure: an expired session or a brief outage on
        // first load used to pin every setting to its fallback for the rest
        // of the session (and the Settings page would then save those
        // fallbacks over the real values). Next load() tries again.
        loading = null;
        return {} as Record<string, unknown>;
      });
  }
  return loading;
}

// Called right after login/auth-check, and awaited before the app renders
// anything - see authContext.tsx. Populating `cache` alone can't trigger a
// re-render (it's a plain module variable, not React state), so a
// component reading getSetting() before this resolves would otherwise be
// stuck showing the fallback forever, even after the cache warms up.
// Gating render on this instead means every consumer always sees a warm
// cache on first read.
export function preloadSettings(): Promise<void> {
  return load().then(() => undefined);
}

// Forget everything on sign-in/sign-out so one account's session never
// reads settings loaded under another's.
export function clearSettingsCache(): void {
  cache = null;
  loading = null;
}

export function getSetting<T>(key: string, fallback: T): T {
  const value = cache?.[key];
  return value === undefined ? fallback : (value as T);
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await api.put(`/api/settings/${key}`, { value });
  cache = { ...(cache ?? {}), [key]: value };
}
