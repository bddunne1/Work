// A small bounded cache that answers from the last computed value while a
// fresh one is computed in the background (D-13): aggregates are for
// trend-watching, so a minute of staleness beats fifteen people each waiting
// on the same six-second query. Shared by Analytics and the report engine.
export class StaleWhileRefresh<T> {
  private entries = new Map<string, { at: number; value: Promise<T> }>();
  constructor(
    private ttlMs: number,
    private maxEntries: number
  ) {}
  get(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at <= this.ttlMs) return hit.value;
    const fresh = compute();
    if (hit) {
      // Stale: hand back what we have; the fresh answer takes over when it lands.
      fresh.then(() => this.entries.set(key, { at: Date.now(), value: fresh })).catch(() => {});
      return hit.value;
    }
    this.entries.set(key, { at: Date.now(), value: fresh });
    fresh.catch(() => {
      if (this.entries.get(key)?.value === fresh) this.entries.delete(key);
    });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    return fresh;
  }
  clear(): void {
    this.entries.clear();
  }
}
