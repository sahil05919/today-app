import { withDefaults } from "./profile";
import type { TLItem } from "./timeline";
import type { AppData, Settings, Task } from "./types";

/**
 * The focus timer's rules, pure. A timer with a goal counts DOWN and stops itself at zero; one without a goal counts up,
 * asks "Still going?" after an hour and stops by itself after three.
 */
export type TimerState = NonNullable<Settings["timer"]>;

export const EXTEND_MIN = 5;
export const STILL_GOING_MIN = 60;
export const AUTO_STOP_MIN = 180;

const MIN = 60_000;

/** The goal in minutes for a task: its estimate, if it has one. */
export const taskGoal = (t: Pick<Task, "estimateMin">): number | undefined => (t.estimateMin && t.estimateMin > 0 ? Math.round(t.estimateMin) : undefined);

/**
 * How long a timer started on this timeline item should run:
 * a session → its area's planned minutes (Meditation 15, Power BI 60…), a task → its estimate,
 * a chore or bill → the minutes the timeline gave it.
 */
export function timerGoal(data: AppData, it: Pick<TLItem, "kind" | "areaId" | "taskId" | "start" | "end">): number | undefined {
  const block = it.end - it.start;
  if (it.kind === "session") {
    const area = withDefaults(data.profile).areas.find((a) => a.id === it.areaId);
    return area?.target?.minutes ?? (block > 0 ? block : undefined);
  }
  if (it.kind === "task") {
    const t = data.tasks.find((x) => x.id === it.taskId);
    return t ? taskGoal(t) : undefined;
  }
  return block > 0 ? block : undefined;
}

/** When a timer with a goal runs out (epoch ms), or null when it has none. */
export const timerEndsAt = (t: TimerState): number | null => (t.goalMin ? t.startedAt + t.goalMin * MIN : null);

/** "+5 min": if the time is already up, the five minutes start from now, so the extension is never swallowed. */
export function extendedGoal(t: TimerState, now: number, by = EXTEND_MIN): number {
  const elapsedMin = Math.ceil(Math.max(0, now - t.startedAt) / MIN);
  return Math.max(t.goalMin ?? 0, elapsedMin) + by;
}

export type TimerPhase =
  | { phase: "running"; elapsedMs: number; leftMs?: number; progress?: number }
  | { phase: "finished"; elapsedMs: number }
  | { phase: "still-going"; elapsedMs: number }
  | { phase: "auto-stop"; elapsedMs: number };

/** Where a timer stands at `now`. */
export function timerPhase(t: TimerState, now: number): TimerPhase {
  const elapsedMs = Math.max(0, now - t.startedAt);
  if (t.goalMin) {
    const goalMs = t.goalMin * MIN;
    if (elapsedMs >= goalMs) return { phase: "finished", elapsedMs };
    return { phase: "running", elapsedMs, leftMs: goalMs - elapsedMs, progress: elapsedMs / goalMs };
  }
  if (elapsedMs >= AUTO_STOP_MIN * MIN) return { phase: "auto-stop", elapsedMs };
  if (elapsedMs >= STILL_GOING_MIN * MIN) return { phase: "still-going", elapsedMs };
  return { phase: "running", elapsedMs };
}

/** "12:41 left" style clock. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
