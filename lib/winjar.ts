import { addDays, fromISO, toISO } from "./dates";
import { isOffDay } from "./offday";
import { otherEntriesBetween } from "./other";
import { plannedForDay } from "./schedule";
import { weekStart } from "./stats";
import { withDefaults } from "./profile";
import type { AppData, HistoryEvent, ISODate } from "./types";

/**
 * The win jar: what you have actually done, collected from what is already stored (the session logs and the history log: no extra
 * storage). A slow day gets a quiet card with your three strongest numbers; the Win jar screen (Menu) has this month against last month,
 * your best streaks and your biggest week.
 */
export interface JarStats {
  from: ISODate;
  to: ISODate;
  /** Finished sessions per area id. */
  sessions: Record<string, number>;
  /** Your own tasks and repeats done (not Gmail tasks, not life admin). */
  ownTasks: number;
  gmailTasks: number;
  lifeAdmin: number;
  /** Things pulled forward with "Lighten my week". */
  pulled: number;
  /** Minutes of Other work. */
  otherMinutes: number;
}

const dayOf = (ms: number) => toISO(new Date(ms));

/** The "done" events in [from, to] that still stand (a done that was undone does not count), one per item per day. */
function doneEvents(data: AppData, from: ISODate, to: ISODate): HistoryEvent[] {
  const latest = new Map<string, HistoryEvent>();
  for (const e of [...(data.history ?? [])].sort((a, b) => a.at - b.at)) {
    if (e.kind !== "done" && e.kind !== "reopened") continue;
    latest.set(`${e.key}|${dayOf(e.at)}`, e);
  }
  return [...latest.values()].filter((e) => e.kind === "done" && dayOf(e.at) >= from && dayOf(e.at) <= to);
}

export function jarBetween(data: AppData, from: ISODate, to: ISODate): JarStats {
  const sessions: Record<string, number> = {};
  for (const l of data.sessions ?? []) if (l.date >= from && l.date <= to) sessions[l.areaId] = (sessions[l.areaId] ?? 0) + 1;
  const life = new Set((data.series ?? []).filter((s) => s.lifeId).map((s) => s.id));
  const gmail = new Set(data.tasks.filter((t) => t.notes?.startsWith("From Gmail:")).map((t) => `task:${t.id}`));
  let ownTasks = 0;
  let gmailTasks = 0;
  let lifeAdmin = 0;
  for (const e of doneEvents(data, from, to)) {
    if (e.type === "session" || e.type === "bill" || e.type === "routine" || e.type === "event") continue;
    if (e.key.startsWith("occ:") && life.has(e.key.slice(4).split("@")[0])) lifeAdmin++;
    else if (gmail.has(e.key)) gmailTasks++;
    else ownTasks++;
  }
  const pulled = new Set((data.history ?? []).filter((e) => e.kind === "pulled" && e.date >= from && e.date <= to).map((e) => `${e.key}|${e.date}`)).size;
  const otherMinutes = otherEntriesBetween(data, from, to).reduce((n, e) => n + e.minutes, 0);
  return { from, to, sessions, ownTasks, gmailTasks, lifeAdmin, pulled, otherMinutes };
}

export const tasksDone = (s: JarStats) => s.ownTasks + s.gmailTasks + s.lifeAdmin;

/** This calendar month so far, and the whole month before it. */
export function monthCompare(data: AppData, today: ISODate): { thisMonth: JarStats; lastMonth: JarStats; thisLabel: string; lastLabel: string } {
  const d = fromISO(today);
  const first = toISO(new Date(d.getFullYear(), d.getMonth(), 1));
  const lastFirst = toISO(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const lastEnd = addDays(first, -1);
  const name = (iso: ISODate) => fromISO(iso).toLocaleDateString("en-GB", { month: "long" });
  return { thisMonth: jarBetween(data, first, today), lastMonth: jarBetween(data, lastFirst, lastEnd), thisLabel: name(first), lastLabel: name(lastFirst) };
}

/** Longest run of days in a row with a finished session (any area, and each area on its own), over the last year. */
export function bestStreaks(data: AppData, today: ISODate): { overall: number; byArea: Record<string, number> } {
  const from = addDays(today, -365);
  const days = new Map<string, Set<ISODate>>();
  const all = new Set<ISODate>();
  for (const l of data.sessions ?? []) {
    if (l.date < from || l.date > today) continue;
    all.add(l.date);
    if (!days.has(l.areaId)) days.set(l.areaId, new Set());
    days.get(l.areaId)!.add(l.date);
  }
  const best = (set: Set<ISODate>) => {
    let top = 0;
    for (const d of set) {
      if (set.has(addDays(d, -1))) continue; // only count from the start of a run
      let n = 1;
      while (set.has(addDays(d, n))) n++;
      top = Math.max(top, n);
    }
    return top;
  };
  return { overall: best(all), byArea: Object.fromEntries([...days].map(([id, set]) => [id, best(set)])) };
}

/** The week (Monday–Sunday, in the last 12) with the most finished: sessions plus tasks. null when nothing at all was done. */
export function biggestWeek(data: AppData, today: ISODate): { week: ISODate; sessions: number; tasks: number; otherMinutes: number } | null {
  let best: { week: ISODate; sessions: number; tasks: number; otherMinutes: number; score: number } | null = null;
  for (let i = 0; i < 12; i++) {
    const week = addDays(weekStart(today), -7 * i);
    const s = jarBetween(data, week, addDays(week, 6));
    const sessions = Object.values(s.sessions).reduce((n, x) => n + x, 0);
    const tasks = tasksDone(s);
    const score = sessions + tasks;
    if (score > 0 && (!best || score > best.score)) best = { week, sessions, tasks, otherMinutes: s.otherMinutes, score };
  }
  return best ? { week: best.week, sessions: best.sessions, tasks: best.tasks, otherMinutes: best.otherMinutes } : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How a count of one area's sessions reads: "14 Power BI sessions", "9 walks". */
function areaPhrase(areaId: string, name: string, n: number): string {
  if (areaId === "walking") return plural(n, "walk", "walks");
  if (areaId === "meditation") return plural(n, "meditation", "meditations");
  return plural(n, `${name} session`, `${name} sessions`);
}

/** "Last 30 days: 14 Power BI sessions, 22 tasks done, 9 walks. You're moving 💪": the three strongest numbers. null with nothing to show. */
export function winLine(data: AppData, today: ISODate): string | null {
  const s = jarBetween(data, addDays(today, -29), today);
  const areas = withDefaults(data.profile).areas;
  const cands: Array<{ n: number; text: string }> = [];
  for (const [id, n] of Object.entries(s.sessions)) if (n > 0) cands.push({ n, text: areaPhrase(id, areas.find((a) => a.id === id)?.name ?? id, n) });
  const t = tasksDone(s);
  if (t > 0) cands.push({ n: t, text: plural(t, "task done", "tasks done") });
  if (s.pulled > 0) cands.push({ n: s.pulled, text: plural(s.pulled, "item pulled forward", "items pulled forward") });
  const top = cands.sort((a, b) => b.n - a.n).slice(0, 3);
  return top.length ? `Last 30 days: ${top.map((c) => c.text).join(", ")}. You're moving 💪` : null;
}

export interface SlowDay {
  reason: "evening" | "yesterday" | "rest";
}

/** Share of what was due on a past day that got done (sessions planned that day and tasks due then). null when too little was planned to say. */
export function dayShare(data: AppData, day: ISODate): number | null {
  const sessions = plannedForDay(data, day);
  const tasks = data.tasks.filter((t) => t.due === day && !t.dueTime && !t.seriesId);
  const planned = sessions.length + tasks.length;
  if (planned < 2) return null;
  const done = sessions.filter((s) => s.done).length + tasks.filter((t) => t.status === "done").length;
  return done / planned;
}

/**
 * When the slow-day card shows: after 18:00 with less than half of today done, or yesterday was under half, or an off day or a skipped
 * session today. Never twice on the same day (it can be dismissed), never a notification.
 */
export function slowDay(data: AppData, now: Date, today: { done: number; total: number }): SlowDay | null {
  const day = toISO(now);
  if (data.settings.winJarDismissed === day) return null;
  if (!winLine(data, day)) return null; // nothing to cheer with yet
  const skippedToday = (data.log ?? []).some((e) => e.status === "skip" && e.key.startsWith("session:") && e.key.endsWith(`:${day}`));
  if (isOffDay(data, day) || skippedToday) return { reason: "rest" };
  if (now.getHours() >= 18 && today.total > 0 && today.done / today.total < 0.5) return { reason: "evening" };
  const y = dayShare(data, addDays(day, -1));
  if (y != null && y < 0.5) return { reason: "yesterday" };
  return null;
}
