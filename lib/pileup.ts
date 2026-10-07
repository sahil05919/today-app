import { addDays, diffDays, toISO } from "./dates";
import { paceStatus } from "./pace";
import { planSessions } from "./schedule";
import { weekProgress } from "./sessions";
import type { Move } from "./settle";
import { buildTimeline } from "./timeline";
import type { AppData, ISODate, Task } from "./types";

/**
 * Pending work must not pile up. When three or more things are overdue, or the week's session targets are behind pace,
 * the morning card says so plainly and offers a catch-up plan you accept with one tap.
 */
export const PILE_UP_OVERDUE = 3;
const HORIZON_DAYS = 7;

/** Open tasks whose day has passed (and that "Adjust my day" hasn't parked for later). */
export function overdueTasks(data: AppData, today: ISODate): Task[] {
  return data.tasks
    .filter((t) => t.status === "open" && t.due != null && t.due < today && !(t.hideUntil && t.hideUntil > today))
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
}

export interface PileUp {
  piling: boolean;
  overdue: Task[];
  /** Names of areas whose weekly target is behind pace. */
  behind: string[];
  /** One plain sentence. */
  message: string;
}

export function pileUp(data: AppData, today: ISODate): PileUp {
  const overdue = overdueTasks(data, today);
  const pace = paceStatus(data, today);
  const behind = pace.status === "behind" ? behindAreas(data, today) : [];
  const piling = overdue.length >= PILE_UP_OVERDUE || behind.length > 0;
  const bits: string[] = [];
  if (overdue.length) bits.push(`${overdue.length} ${overdue.length === 1 ? "thing is" : "things are"} overdue`);
  if (behind.length) bits.push(`${behind.slice(0, 2).join(" and ")} ${behind.length === 1 ? "is" : "are"} behind`);
  return { piling, overdue, behind, message: piling ? `This week is piling up: ${bits.join(" and ")}.` : "" };
}

/** Areas that are further behind than pace allows (by at least one session). */
function behindAreas(data: AppData, today: ISODate): string[] {
  const dow = (new Date(today + "T00:00:00").getDay() + 6) % 7; // Mon = 0
  const rows = weekProgress(data, today);
  return rows
    .filter((r) => {
      const days = r.area.target!.weekends ? 7 : 5;
      const elapsed = Math.min(days, dow);
      return r.target * (elapsed / days) - Math.min(r.done, r.target) >= 1;
    })
    .map((r) => r.area.name);
}

export interface CatchUpPlan {
  /** Overdue tasks, each given a day that has room for it. */
  moves: Move[];
  /** Overdue tasks that don't fit anywhere in the next week: you decide. */
  stuck: Task[];
  /** Plain lines about the sessions ("Power BI: 2 left this week, both planned"). */
  notes: string[];
}

/**
 * Spreads overdue tasks over the days that have room (today first), one day at a time, judged by the real timeline,
 * so the plan is one you can actually do. Nothing is dropped: whatever can't fit comes back in `stuck` for you to decide.
 */
export function catchUpPlan(data: AppData, now: Date = new Date()): CatchUpPlan {
  const today = toISO(now);
  const moves: Move[] = [];
  const stuck: Task[] = [];
  let work = data;

  for (const t of overdueTasks(data, today)) {
    let placed = false;
    for (let i = 0; i <= HORIZON_DAYS && !placed; i++) {
      const day = addDays(today, i);
      const trial: AppData = { ...work, tasks: work.tasks.map((x) => (x.id === t.id ? { ...x, due: day, dueTime: undefined, hideUntil: undefined } : x)) };
      // Today is judged from now; later days from their morning.
      const tl = buildTimeline(trial, day, i === 0 ? now : new Date(day + "T00:00:00"));
      // It must fit, and must not push out anything already moved to that day.
      const mine = new Set(moves.filter((m) => m.to === day).map((m) => m.taskId));
      if (!tl.overflow.some((o) => o.task.id === t.id || mine.has(o.task.id))) {
        work = trial;
        // Staying on today is still a decision: the task stops being "overdue" and gets a real place.
        moves.push({ taskId: t.id, title: t.title, from: t.due ?? today, to: day });
        placed = true;
      }
    }
    if (!placed) stuck.push(t);
  }

  const notes: string[] = [];
  const plan = planSessions(data, now).filter((s) => !s.done);
  for (const r of weekProgress(data, today)) {
    const left = Math.max(0, r.target - r.done);
    if (!left) continue;
    const planned = plan.filter((s) => s.areaId === r.area.id).length;
    if (planned >= left) continue;
    notes.push(`${r.area.name}: ${left} to go this week, ${planned} fit${planned === 1 ? "s" : ""}. ${left - planned} will slip unless you free up time.`);
  }
  return { moves, stuck, notes };
}

/** "Mon 5 Oct" style label for a move, relative to today. */
export const moveWhen = (to: ISODate, today: ISODate) => {
  const d = diffDays(to, today);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  return new Date(to + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long" });
};

/** The first day from `from` (up to a week) whose real timeline has room for this task. Falls back to `from`. */
export function firstDayWithRoom(data: AppData, task: Task, from: ISODate): ISODate {
  for (let i = 0; i < 7; i++) {
    const day = addDays(from, i);
    const trial: AppData = { ...data, tasks: data.tasks.map((x) => (x.id === task.id ? { ...x, due: day, dueTime: undefined, hideUntil: undefined } : x)) };
    if (!buildTimeline(trial, day, new Date(day + "T00:00:00")).overflow.some((o) => o.task.id === task.id)) return day;
  }
  return from;
}

/** Everything still open that was meant for today or earlier: what the Sunday review makes you decide on. */
export const pendingForReview = (data: AppData, today: ISODate): Task[] =>
  data.tasks.filter((t) => t.status === "open" && t.due != null && t.due <= today).sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
