/**
 * Results that depend only on the data are remembered per data snapshot. Every change to the data makes a new snapshot (the store
 * never edits one in place), so the snapshot is its version: a planner, timeline or stats result is computed once per version and
 * handed back on every later render. Nothing recomputes just because a component re-rendered.
 *
 * `key` must include everything else the result depends on (the day, the minute…).
 */
const caches = new WeakMap<object, Map<string, unknown>>();

export const memoStats = { hits: 0, misses: 0 };

export function cached<T>(data: object, key: string, compute: () => T): T {
  let m = caches.get(data);
  if (!m) caches.set(data, (m = new Map()));
  if (m.has(key)) {
    memoStats.hits++;
    return m.get(key) as T;
  }
  memoStats.misses++;
  const v = compute();
  // A snapshot holds a handful of results; if a bug ever feeds it endless keys, start over instead of growing.
  if (m.size > 400) m.clear();
  m.set(key, v);
  return v;
}
