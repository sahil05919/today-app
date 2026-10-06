import { taskKey, type DurationModel } from "./stats";
import type { Task } from "./types";

const DEFAULT_STEP_MIN = 15;

const QUICK = /\b(call|phone|text|email|reply|pay|renew|cancel|book|order|send|post|check|remind|print|water|buy)\b/i;
const MEDIUM = /\b(write|draft|plan|research|clean|tidy|organi[sz]e|fix|update|review|prepare|sort|read)\b/i;
const BIG = /\b(project|trip|essay|report|application|presentation|move|taxes|tax|budget|wedding|party|decorate)\b/i;

/** Sensible guess for a task with no estimate: roughly 10 / 15 / 25 / 45 / 90 minutes. */
export function guessMinutes(title: string): number {
  // A leading action verb ("Pay council tax", "Email the landlord") says more than the nouns after it.
  if (QUICK.test(title.split(/\s+/)[0] ?? "")) return 10;
  if (BIG.test(title)) return 90;
  if (MEDIUM.test(title)) return 45;
  if (QUICK.test(title)) return 10;
  return title.split(/\s+/).length <= 3 ? 15 : 25;
}

export function nextStep(task: Task) {
  return task.steps.find((s) => !s.done);
}

export interface Remaining {
  minutes: number;
  /** A rough guess (no estimate on the task). */
  guessed: boolean;
  /** Adjusted using what the focus timer has learned about you. */
  learned?: boolean;
}

/**
 * Minutes of work left.
 * - Steps all have estimates: their sum.
 * - Some don't, but the task has its own estimate: that estimate, scaled by the share of steps still open.
 * - Otherwise: sum, with a default for un-timed steps.
 * An open task never drops below 5 minutes (there's always a "wrap it up").
 *
 * With a `model` (built from timer logs): your own estimates are scaled by how much you usually
 * over/under-run them, and un-timed tasks use your real average for similar tasks.
 */
export function remainingMinutes(task: Task, model?: DurationModel): Remaining {
  const base = baseMinutes(task);
  if (!model) return base;

  if (!base.guessed && model.multiplier && Math.abs(model.multiplier - 1) > 0.1) {
    return { minutes: Math.max(5, Math.round((base.minutes * model.multiplier) / 5) * 5), guessed: false, learned: true };
  }
  const known = model.byKey[taskKey(task)];
  if (base.guessed && known && !task.steps.length) return { minutes: Math.max(5, known.avg), guessed: false, learned: true };
  return base;
}

function baseMinutes(task: Task): Remaining {
  if (task.steps.length) {
    const open = task.steps.filter((s) => !s.done);
    if (open.every((s) => s.estimateMin != null)) {
      return { minutes: Math.max(5, open.reduce((n, s) => n + (s.estimateMin ?? 0), 0)), guessed: false };
    }
    if (task.estimateMin != null) {
      const share = open.length / task.steps.length;
      return { minutes: Math.max(5, Math.round(task.estimateMin * share)), guessed: false };
    }
    return { minutes: open.reduce((n, s) => n + (s.estimateMin ?? DEFAULT_STEP_MIN), 0), guessed: true };
  }
  if (task.estimateMin != null) return { minutes: task.estimateMin, guessed: false };
  return { minutes: guessMinutes(task.title), guessed: true };
}

export function stepProgress(task: Task) {
  const total = task.steps.length;
  const done = task.steps.filter((s) => s.done).length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}
