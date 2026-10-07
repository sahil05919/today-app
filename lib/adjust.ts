import { addDays, diffDays, toISO } from "./dates";
import { priorityScore } from "./rescue";
import { buildTimeline, type TLItem } from "./timeline";
import type { AppData, ISODate, Task } from "./types";

/**
 * "Adjust my day": tell it how much time and energy you have, and it rebuilds today around that.
 * (This replaces Rescue my day, Plan my tasks and Pick my 3.)
 *
 * Booked things (events, anything with its own time) always stay. The rest compete for the time you have:
 * overdue and important things first, bills due today, then sessions, then everything else. Low energy prefers
 * short, restorative things (a walk, meditation, a quick call) over long deep work; high energy fills the time well.
 * What doesn't make it moves off today: tasks to tomorrow, sessions and chores skipped for today (the week re-plans).
 */
export type Energy = "low" | "ok" | "high";

export interface Deferred {
  item: TLItem;
  /** Where it goes. */
  to: "tomorrow" | "skip";
}

export interface AdjustPlan {
  /** Booked things that stay as they are. */
  booked: TLItem[];
  /** Flexible things kept for today, in the order they'll be placed. */
  keep: TLItem[];
  defer: Deferred[];
  /** Minutes the kept things take, out of the minutes you have. */
  used: number;
  minutes: number;
}

const RESTORATIVE = new Set(["meditation", "walking", "english"]);

function score(it: TLItem, task: Task | undefined, date: ISODate, energy: Energy): number {
  let s: number;
  if (it.kind === "bill") s = 95;
  else if (it.kind === "task" && task) {
    s = priorityScore(task, date) + 10; // overdue ~110, due today ~100, important +25
    if (task.important) s += 5;
  } else if (it.kind === "session") s = 70 + (energy === "low" && it.areaId && RESTORATIVE.has(it.areaId) ? 15 : 0);
  else s = 40; // chores
  const len = it.end - it.start;
  if (energy === "low" && len > 45) s -= 30;
  return s;
}

export function planAdjust(data: AppData, now: Date, opts: { minutes: number; energy: Energy }): AdjustPlan {
  const today = toISO(now);
  const tl = buildTimeline(data, today, now);
  const tasks = new Map(data.tasks.map((t) => [t.id, t]));
  const booked = tl.items.filter((x) => x.fixed && !x.done && !x.skipped && !x.muted && !x.allDay);
  // Everything flexible that's still to do, including tasks that didn't even fit.
  const pool: TLItem[] = tl.items.filter((x) => !x.fixed && !x.done && !x.skipped && !x.muted);
  for (const o of tl.overflow) {
    pool.push({ key: `task:${o.task.id}`, kind: "task", title: o.task.title, start: 0, end: Math.max(10, o.task.estimateMin ?? 20), fixed: false, done: false, skipped: false, taskId: o.task.id, areaId: o.task.area, carried: o.carried || undefined });
  }

  const ranked = [...pool].sort((a, b) => {
    const d = score(b, b.taskId ? tasks.get(b.taskId) : undefined, today, opts.energy) - score(a, a.taskId ? tasks.get(a.taskId) : undefined, today, opts.energy);
    if (d) return d;
    const la = a.end - a.start;
    const lb = b.end - b.start;
    return opts.energy === "low" ? la - lb : lb - la;
  });

  const keep: TLItem[] = [];
  const defer: Deferred[] = [];
  let used = 0;
  for (const it of ranked) {
    const len = Math.max(5, it.end - it.start);
    // A bill that's due isn't optional, however short the day.
    const must = it.kind === "bill";
    if (must || used + len <= opts.minutes) {
      keep.push(it);
      used += len;
    } else defer.push({ item: it, to: it.kind === "task" ? "tomorrow" : "skip" });
  }
  return { booked, keep, defer, used, minutes: opts.minutes };
}

/** Applies the plan: tasks move to tomorrow (overdue ones are parked, staying first in line), the rest are skipped for today. */
export function applyAdjust(plan: AdjustPlan, apply: { moveTasks: (m: Array<{ taskId: string; to: ISODate }>) => void; parkTasks: (ids: string[], until: ISODate) => void; skip: (it: TLItem) => void }, data: AppData, now: Date) {
  const today = toISO(now);
  const tomorrow = addDays(today, 1);
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const move: Array<{ taskId: string; to: ISODate }> = [];
  const park: string[] = [];
  for (const d of plan.defer) {
    if (d.item.kind === "task" && d.item.taskId) {
      const t = byId.get(d.item.taskId);
      if (!t) continue;
      if (t.due && diffDays(t.due, today) < 0) park.push(t.id);
      else move.push({ taskId: t.id, to: tomorrow });
    } else apply.skip(d.item);
  }
  if (move.length) apply.moveTasks(move);
  if (park.length) apply.parkTasks(park, tomorrow);
}
