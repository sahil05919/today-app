import { addDays, toISO, weekdayShort } from "./dates";
import { withDefaults } from "./profile";
import { planWeek, type PlannedSession, type Shortfall } from "./schedule";
import { weekProgress } from "./sessions";
import { withRepeats } from "./series";
import { weekStart } from "./stats";
import type { AppData, ISODate } from "./types";

/**
 * Weekly targets are a hard rule. This is the one place that says where each area stands this week: what is done, what is
 * already waiting as a task, what the planner has placed, and what (if anything) truly does not fit. Pure.
 */
export interface TargetRow {
  areaId: string;
  name: string;
  emoji: string;
  target: number;
  done: number;
  /** Open tasks that count for the area this week (a rescheduled or carried session). */
  pending: number;
  /** Planned and not yet done, by day. */
  planned: Record<ISODate, number>;
  plannedCount: number;
  /** done + pending + planned. */
  fit: number;
  /** target - fit when positive: what could not be placed. */
  missing: number;
}

export interface WeekTargets {
  week: ISODate;
  rows: TargetRow[];
  short: Shortfall[];
  sessions: PlannedSession[];
}

export function weekTargets(raw: AppData, now: Date = new Date()): WeekTargets {
  const today = toISO(now);
  const week = weekStart(today);
  const { sessions, short } = planWeek(raw, now);
  const data = withRepeats(raw, today);
  const progress = new Map(weekProgress(data, today).map((r) => [r.area.id, r]));
  const rows: TargetRow[] = withDefaults(data.profile)
    .areas.filter((a) => a.target)
    .map((a) => {
      const mine = sessions.filter((s) => s.areaId === a.id && !s.done);
      const planned: Record<ISODate, number> = {};
      for (const s of mine) planned[s.date] = (planned[s.date] ?? 0) + 1;
      const pending = data.tasks.filter((t) => t.status === "open" && t.countsFor === a.id && t.due != null && t.due >= week && t.due <= addDays(week, 6)).length;
      const done = progress.get(a.id)?.done ?? 0;
      const fit = done + pending + mine.length;
      return { areaId: a.id, name: a.name, emoji: a.emoji, target: a.target!.perWeek, done, pending, planned, plannedCount: mine.length, fit, missing: Math.max(0, a.target!.perWeek - fit) };
    });
  return { week, rows, short, sessions };
}

/** "Power BI: 2 of 4 fit this week. Tap to choose" */
export const shortLine = (s: Pick<Shortfall, "name" | "fit" | "target">) => `${s.name}: ${s.fit} of ${s.target} fit this week. Tap to choose`;

export interface DayChoice {
  date: ISODate;
  label: string;
}

/** Days where one more session of this area can still be added by hand (today only while there is time to do it). */
export function dayChoices(raw: AppData, areaId: string, now: Date = new Date()): DayChoice[] {
  const today = toISO(now);
  const data = withRepeats(raw, today);
  const end = addDays(weekStart(today), 6);
  const late = now.getHours() * 60 + now.getMinutes() > 21 * 60;
  const out: DayChoice[] = [];
  for (let d = late ? addDays(today, 1) : today; d <= end; d = addDays(d, 1)) {
    const has = data.tasks.filter((t) => t.status === "open" && t.countsFor === areaId && t.due === d).length;
    if (has) continue;
    out.push({ date: d, label: d === today ? "today" : weekdayShort(d) });
  }
  return out;
}
