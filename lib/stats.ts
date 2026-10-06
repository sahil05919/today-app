import { addDays, diffDays, fromISO, toISO } from "./dates";
import type { ISODate, Task } from "./types";

const DAY = 86_400_000;

/** Minutes actually logged with the focus timer. */
export const actualMinutes = (t: Task) => (t.sessions ?? []).reduce((n, s) => n + s.min, 0);

/** Groups similar tasks: the first tag, else the first word ("call", "email"…). */
export function taskKey(t: Task): string {
  return (t.tags[0] ?? t.title.split(/\s+/)[0] ?? "").toLowerCase();
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** What the timer has taught us about how long things really take. */
export interface DurationModel {
  /** Typical actual ÷ estimate (needs 3+ samples). */
  multiplier?: number;
  /** Average real minutes for similar tasks (needs 2+ samples). */
  byKey: Record<string, { avg: number; n: number }>;
  samples: number;
}

export function buildDurationModel(tasks: Task[]): DurationModel {
  const done = tasks.filter((t) => t.status === "done" && actualMinutes(t) > 0);
  const ratios = done.filter((t) => (t.estimateMin ?? 0) > 0).map((t) => actualMinutes(t) / t.estimateMin!);
  const groups: Record<string, number[]> = {};
  for (const t of done) (groups[taskKey(t)] ??= []).push(actualMinutes(t));
  const byKey: DurationModel["byKey"] = {};
  for (const [k, xs] of Object.entries(groups)) {
    if (xs.length >= 2) byKey[k] = { avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), n: xs.length };
  }
  return {
    multiplier: ratios.length >= 3 ? Math.min(3, Math.max(0.5, median(ratios))) : undefined,
    byKey,
    samples: done.length,
  };
}

/** Monday of the week containing `d`. */
export function weekStart(d: ISODate): ISODate {
  return addDays(d, -((fromISO(d).getDay() + 6) % 7));
}

const isoOfStamp = (ms: number) => toISO(new Date(ms));

export function weekSummary(tasks: Task[], today: ISODate) {
  const start = weekStart(today);
  const done = tasks.filter((t) => t.status === "done" && t.completedAt && isoOfStamp(t.completedAt) >= start);
  const slipped = tasks.filter((t) => t.status === "open" && t.due != null && t.due < today);
  const minutes = done.reduce((n, t) => n + actualMinutes(t), 0);
  return { start, done, slipped, minutes };
}

/** Last `days` days: tasks finished vs. tasks that were due in that window and are still open and late. */
export function completionRate(tasks: Task[], today: ISODate, days = 30) {
  const from = addDays(today, -days);
  const done = tasks.filter((t) => t.status === "done" && t.completedAt && isoOfStamp(t.completedAt) >= from).length;
  const missed = tasks.filter((t) => t.status === "open" && t.due != null && t.due < today && t.due >= from).length;
  return { done, missed, rate: done + missed > 0 ? done / (done + missed) : null };
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The weekday you finish the most on (last `weeks` weeks). Needs at least 5 completions. */
export function bestDay(tasks: Task[], today: ISODate, weeks = 8) {
  const cutoff = Date.now() - weeks * 7 * DAY;
  const counts = Array(7).fill(0) as number[];
  let total = 0;
  for (const t of tasks) {
    if (t.status === "done" && t.completedAt && t.completedAt >= cutoff && diffDays(today, isoOfStamp(t.completedAt)) >= 0) {
      counts[new Date(t.completedAt).getDay()]++;
      total++;
    }
  }
  if (total < 5) return null;
  const max = Math.max(...counts);
  // A tie, or a single stray completion, isn't a pattern.
  if (max < 2 || counts.filter((c) => c === max).length > 1) return null;
  const dow = counts.indexOf(max);
  return { dow, name: DOW[dow], count: max, total };
}

/** Actual vs. estimated time on finished tasks that have both. Needs 3+. */
export function estimateAccuracy(tasks: Task[]) {
  const pairs = tasks
    .filter((t) => t.status === "done" && (t.estimateMin ?? 0) > 0 && actualMinutes(t) > 0)
    .map((t) => actualMinutes(t) / t.estimateMin!);
  if (pairs.length < 3) return null;
  const withinQuarter = pairs.filter((r) => r >= 0.75 && r <= 1.25).length;
  return { n: pairs.length, ratio: median(pairs), within: Math.round((withinQuarter / pairs.length) * 100) };
}
