/**
 * A small dev-only timing log (nothing is kept or printed in the release build). It answers three questions:
 * how long did the app take to open, how long does the planner take, and how long does a sync take.
 * In the browser console: `__todayTiming()` prints the table.
 */
const dev = typeof process !== "undefined" && process.env.NODE_ENV !== "production";

export interface TimingRow {
  label: string;
  ms: number;
  at: number;
}

const rows: TimingRow[] = [];
const MAX_ROWS = 200;

export function record(label: string, ms: number) {
  if (!dev) return;
  rows.push({ label, ms: Math.round(ms * 10) / 10, at: Date.now() });
  if (rows.length > MAX_ROWS) rows.shift();
}

/** Times a synchronous call. */
export function timed<T>(label: string, fn: () => T): T {
  if (!dev) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    record(label, performance.now() - t0);
  }
}

/** Times an async call. */
export async function timedAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!dev) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    record(label, performance.now() - t0);
  }
}

export function timingRows(): TimingRow[] {
  return [...rows];
}

/** Milliseconds from the page starting to "Today is usable" (the first render with data). Recorded once. */
let openDone = false;
export function markOpen() {
  if (openDone) return;
  openDone = true;
  if (typeof performance !== "undefined") record("open (page start → usable Today)", performance.now());
}

if (dev && typeof window !== "undefined") {
  (window as unknown as { __todayTiming?: () => TimingRow[] }).__todayTiming = () => {
    console.table(rows);
    return rows;
  };
}
