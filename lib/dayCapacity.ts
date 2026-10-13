import { addDays, fromISO, toISO } from "./dates";
import { cached } from "./memo";
import { withDefaults } from "./profile";
import type { AppData, HistoryEvent, ISODate } from "./types";

/**
 * Plan to what I really finish. From the history log of the last 28 days: how many flexible things I actually complete in a day, and
 * how many minutes of them, separately for weekdays and weekends (the median, so one huge or empty day does not rule). The planner
 * (sessions and tasks) caps a day's flexible load at that, with a floor of 2 items and never above the older fixed caps.
 *
 *  - "flexible" = what the planner chooses to put in a day: sessions, my own tasks and repeats, logged time, ticked calendar events.
 *    Not routine blocks (lunch, commute), not bills / chores / life admin (they have their own days and are never held back), not
 *    things I timed myself.
 *  - off days and days with a cleared window are ignored
 *  - until there are 14 days of history nothing is learned and the old caps apply
 *  - a number set in Settings (instead of Auto) is used for every day
 */
export const WINDOW_DAYS = 28;
export const MIN_HISTORY_DAYS = 14;
const MIN_DAYS_IN_CLASS = 3;
export const FLOOR_ITEMS = 2;
const FLOOR_MINUTES = 90;

const DEFAULT_MIN = { session: 30, task: 20, repeat: 15, bill: 10, routine: 15, event: 30 };

export interface DayCap {
  items: number;
  minutes: number;
  /** Days this was learned from. */
  days: number;
}

export interface DailyCapacity {
  /** 14+ days of history exist (or a number was set by hand): the caps are in force. */
  ready: boolean;
  /** Days of history so far (for "learning… 6 of 14 days"). */
  historyDays: number;
  weekday: DayCap | null;
  weekend: DayCap | null;
  /** A number set in Settings (0/undefined = Auto). */
  override: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const dayOf = (ms: number) => toISO(new Date(ms));
const isWeekendDay = (d: ISODate) => [0, 6].includes(fromISO(d).getDay());

/** What one finished thing counts as, in minutes (history entries carry no length: it is looked up). */
function minutesOf(data: AppData, e: HistoryEvent): number {
  if (e.type === "session") return (withDefaults(data.profile).areas.find((a) => a.id === e.area)?.target?.minutes ?? DEFAULT_MIN.session);
  if (e.key.startsWith("log:")) return (data.worklog ?? []).find((w) => `log:${w.id}` === e.key)?.minutes ?? DEFAULT_MIN.task;
  if (e.key.startsWith("task:")) {
    const t = data.tasks.find((x) => `task:${x.id}` === e.key);
    return (t?.sessions?.reduce((n, s) => n + s.min, 0) || t?.estimateMin) ?? DEFAULT_MIN.task;
  }
  if (e.key.startsWith("occ:")) {
    const seriesId = e.key.slice(4).split("@")[0];
    return (data.series ?? []).find((s) => s.id === seriesId)?.estimateMin ?? DEFAULT_MIN.repeat;
  }
  return e.type === "bill" ? DEFAULT_MIN.bill : e.type === "event" ? DEFAULT_MIN.event : DEFAULT_MIN.routine;
}

/** Per day: the flexible things that stand finished at the end of it (a done that was undone does not count). */
function finishedPerDay(data: AppData, from: ISODate, to: ISODate): Map<ISODate, { items: number; minutes: number }> {
  const lifeSeries = new Set((data.series ?? []).filter((s) => s.lifeId).map((s) => s.id));
  const latest = new Map<string, HistoryEvent>();
  for (const e of [...(data.history ?? [])].sort((a, b) => a.at - b.at)) {
    if (e.kind !== "done" && e.kind !== "reopened") continue;
    if (e.type === "routine" || e.type === "bill") continue; // lunch, commute, tea, chores, bills: they keep their own days
    if (e.key.startsWith("occ:") && lifeSeries.has(e.key.slice(4).split("@")[0])) continue; // life admin has its own day too
    latest.set(`${e.key}|${dayOf(e.at)}`, e);
  }
  const out = new Map<ISODate, { items: number; minutes: number }>();
  for (const e of latest.values()) {
    if (e.kind !== "done") continue;
    const d = dayOf(e.at);
    if (d < from || d > to) continue;
    const c = out.get(d) ?? { items: 0, minutes: 0 };
    c.items++;
    c.minutes += minutesOf(data, e);
    out.set(d, c);
  }
  return out;
}

export function dailyCapacity(data: AppData, today: ISODate): DailyCapacity {
  return cached(data, `dailyCapacity:${today}`, () => {
    const override = Math.round(withDefaults(data.profile).capacityItems ?? 0);
    const history = data.history ?? [];
    const first = history.reduce<ISODate | undefined>((m, e) => (!m || dayOf(e.at) < m ? dayOf(e.at) : m), undefined);
    const historyDays = first ? Math.max(0, Math.round((Date.parse(today) - Date.parse(first)) / 86_400_000)) : 0;
    const from = addDays(today, -WINDOW_DAYS);
    const to = addDays(today, -1);
    const start = first && first > from ? first : from;
    const per = finishedPerDay(data, from, to);
    const skip = new Set<ISODate>([...(data.offDays ?? []), ...(data.cleared ?? []).map((c) => c.date)]);
    const weekday: number[][] = [];
    const weekend: number[][] = [];
    if (first) {
      for (let d = start; d <= to; d = addDays(d, 1)) {
        if (skip.has(d)) continue;
        const c = per.get(d) ?? { items: 0, minutes: 0 };
        (isWeekendDay(d) ? weekend : weekday).push([c.items, c.minutes]);
      }
    }
    const cap = (rows: number[][]): DayCap | null =>
      rows.length < MIN_DAYS_IN_CLASS ? null : { items: Math.max(FLOOR_ITEMS, Math.round(median(rows.map((r) => r[0])))), minutes: Math.max(FLOOR_MINUTES, Math.round(median(rows.map((r) => r[1])))), days: rows.length };
    return { ready: override > 0 || historyDays >= MIN_HISTORY_DAYS, historyDays, weekday: cap(weekday), weekend: cap(weekend), override };
  });
}

/**
 * The cap for one day, or null when there is none (still learning, or not enough days of that kind). The planner takes the lower
 * of this and its older fixed caps, so it never goes above them.
 */
export function capFor(data: AppData, date: ISODate, today: ISODate): { items: number; minutes: number } | null {
  const c = dailyCapacity(data, today);
  if (c.override > 0) return { items: c.override, minutes: Number.POSITIVE_INFINITY };
  if (!c.ready) return null;
  const learned = isWeekendDay(date) ? c.weekend : c.weekday;
  return learned ? { items: learned.items, minutes: learned.minutes } : null;
}

/** The one quiet line in Settings → Planning. */
export function capacityLine(data: AppData, today: ISODate): string {
  const c = dailyCapacity(data, today);
  if (c.override > 0) return `Planning ${c.override} ${c.override === 1 ? "item" : "items"} a day (your setting).`;
  if (!c.ready) return `Still learning how much you finish in a day (${Math.min(c.historyDays, MIN_HISTORY_DAYS)} of ${MIN_HISTORY_DAYS} days). Until then the usual limits apply.`;
  const wd = c.weekday?.items;
  const we = c.weekend?.items;
  const weeks = Math.max(1, Math.round(Math.min(c.historyDays, WINDOW_DAYS) / 7));
  const part = (n: number | undefined, label: string) => (n ? `${n} ${n === 1 ? "item" : "items"} on ${label}` : "");
  const text = [part(wd, "weekdays"), part(we, "weekends")].filter(Boolean).join(", ");
  return text ? `Planning about ${text} (based on your last ${weeks} ${weeks === 1 ? "week" : "weeks"}).` : "Planning with the usual limits (not enough days of history yet).";
}
