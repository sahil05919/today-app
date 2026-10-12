import { LATEST_END, planningBusy } from "./busy";
import { addDays, fromISO, toISO, weekdayShort } from "./dates";
import { upcomingEvents } from "./events";
import { newEvent } from "./history";
import { behindAreaRows } from "./pileup";
import { withDefaults } from "./profile";
import { applyReschedule } from "./reschedule";
import { isOccId, applyOccTask, findTask, withRepeats } from "./series";
import { sessionKey } from "./sessions";
import { weekStart } from "./stats";
import { buildTimeline, type TLItem, type Timeline } from "./timeline";
import type { AppData, HistoryEvent, ISODate, Task } from "./types";

/**
 * "All done for today" and "Lighten my week".
 *
 * When today's list is finished and there is time left in the evening, the app can offer to PULL work forward from the next
 * days (it moves, it is not copied): "Waiting for room" items first, then areas behind their weekly target, then important
 * tasks, then flexible sessions from the busiest upcoming day. Nothing moves until it is confirmed. A pulled session keeps its
 * number and its place in the weekly count; the day it left is lighter.
 */

/** The free time that makes the offer worth making (minutes before ~22:30). */
export const MIN_FREE_TO_OFFER = 30;
const DAY_END = LATEST_END;
const MAX_CANDIDATES = 12;

const ceil5 = (n: number) => Math.ceil(n / 5) * 5;

// ---- Free time today ------------------------------------------------------------------------------------------------------

/** Minutes between now and ~22:30 that nothing open or booked is using (gaps under 10 minutes do not count). */
export function freeMinutesToday(data: AppData, now: Date, tl?: Timeline): number {
  const today = toISO(now);
  const t = tl ?? buildTimeline(data, today, now);
  const from = ceil5(now.getHours() * 60 + now.getMinutes() + 5);
  if (from >= DAY_END) return 0;
  const spans: Array<[number, number]> = t.items.filter((x) => !x.done && !x.skipped && !x.allDay && x.end > from).map((x) => [Math.max(from, x.start), x.end]);
  for (const s of planningBusy(withRepeats(data, today))(today)) if (s[1] > from) spans.push([Math.max(from, s[0]), s[1]]);
  spans.sort((a, b) => a[0] - b[0]);
  let free = 0;
  let cursor = from;
  for (const [s, e] of spans) {
    if (s - cursor >= 10) free += s - cursor;
    cursor = Math.max(cursor, e);
  }
  if (DAY_END - cursor >= 10) free += DAY_END - cursor;
  return free;
}

// ---- "All done for today" ------------------------------------------------------------------------------------------------------

/** What is still on today's to-do list: flexible and untimed things, and anything waiting for room (carried-over included). */
export function openTodos(tl: Timeline): number {
  const items = tl.items.filter((x) => !x.done && !x.skipped && !x.muted && !x.allDay && !x.fixed && ["task", "session", "chore", "bill"].includes(x.kind)).length;
  return items + tl.overflow.length + tl.stillTodo.filter((s) => !tl.items.some((x) => x.key === s.key)).length;
}

export interface DayDone {
  /** All of today's to-do items are done (only fixed-time things later today may remain). */
  done: boolean;
  /** Done AND there is time left to make an offer of. */
  offer: boolean;
  free: number;
}

export function dayDoneState(data: AppData, now: Date, tl?: Timeline): DayDone {
  const today = toISO(now);
  const t = tl ?? buildTimeline(data, today, now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const finishedSomething = t.summary.done > 0;
  const laterFixed = t.items.some((x) => x.fixed && !x.done && !x.skipped && !x.muted && !x.allDay && x.end > nowMin);
  void laterFixed; // a fixed-time thing later today does not hold the offer back
  const done = finishedSomething && openTodos(t) === 0;
  const free = done ? freeMinutesToday(data, now, t) : 0;
  return { done, offer: done && free >= MIN_FREE_TO_OFFER, free };
}

// ---- The calm card ---------------------------------------------------------------------------------------------------------

const RELAXED = ["Put a film on you've been saving", "Take a walk somewhere you haven't been", "Call a friend you've been meaning to", "Make something nice to eat", "Read something just for fun"];

/** What was done today, in the person's own words: "Power BI, Walk and Job Apply". */
export function didToday(data: AppData, today: ISODate): string[] {
  const p = withDefaults(data.profile);
  const names: string[] = [];
  for (const l of (data.sessions ?? []).filter((x) => x.date === today)) {
    const a = p.areas.find((x) => x.id === l.areaId);
    const n = a?.name === "Walking" ? "Walk" : (a?.name ?? l.areaId);
    if (!names.includes(n)) names.push(n);
  }
  for (const t of data.tasks) {
    if (t.status === "done" && t.completedAt && toISO(new Date(t.completedAt)) === today && !t.countsFor && names.length < 5) names.push(t.title);
  }
  const occ = withRepeats(data, today).tasks.filter((t) => t.seriesId && t.status === "done" && t.completedAt && toISO(new Date(t.completedAt)) === today);
  for (const t of occ) if (names.length < 5 && !names.includes(t.title)) names.push(t.title);
  return names;
}

export const listOf = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export interface Calm {
  title: string;
  line: string;
  suggestion: string;
}

/** "Calm evening ahead 🙌 You did Power BI, Walk and Job Apply today." plus one relaxed idea (a London event tonight if there is one). */
export function calmCard(data: AppData, now: Date): Calm {
  const today = toISO(now);
  const did = didToday(data, today).slice(0, 4);
  const tonight = upcomingEvents(today, { leadDays: 0, hidden: data.settings.hiddenEvents }).find((e) => e.state === "now");
  const day = Math.floor(Date.parse(today) / 86_400_000);
  return {
    title: "Calm evening ahead 🙌",
    line: did.length ? `You did ${listOf(did)} today. That's a proper day.` : "You've cleared today. That's a proper day.",
    suggestion: tonight ? `${tonight.event.title} is on in ${tonight.event.where} right now, if you fancy going out.` : RELAXED[day % RELAXED.length],
  };
}

// ---- Lighten my week -------------------------------------------------------------------------------------------------------------

export type PullReason = "waiting" | "behind" | "important" | "busiest";

export interface PullCandidate {
  /** Stable key: the task id, or the session's own key. */
  key: string;
  title: string;
  minutes: number;
  /** The day it is on now. */
  from: ISODate;
  reason: PullReason;
  taskId?: string;
  /** A planned session: the timeline item it is (so it can be moved). */
  item?: TLItem;
  areaId?: string;
}

const clean = (t: string) => t.replace(/ · session \d+$| session \d+$/, "");
const REASON_RANK: Record<PullReason, number> = { waiting: 0, behind: 1, important: 2, busiest: 3 };

/**
 * What could come forward into today, best first. Only things from the next 7 days (sessions only from the rest of THIS week,
 * so another week's plan is never raided), never anything booked at a time, never a session of an area already done today.
 */
export function pullCandidates(raw: AppData, now: Date): PullCandidate[] {
  const today = toISO(now);
  const data = withRepeats(raw, today);
  const sunday = addDays(weekStart(today), 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));
  const out: PullCandidate[] = [];
  const seen = new Set<string>();
  const add = (c: PullCandidate) => {
    if (seen.has(c.key)) return;
    seen.add(c.key);
    out.push(c);
  };
  const doneToday = new Set((data.sessions ?? []).filter((l) => l.date === today).map((l) => l.areaId));
  const timelines = new Map<ISODate, Timeline>();
  const tlOf = (d: ISODate) => {
    let t = timelines.get(d);
    if (!t) timelines.set(d, (t = buildTimeline(data, d, d === today ? now : fromISO(d), { today })));
    return t;
  };
  const minutesOf = (x: TLItem) => Math.max(10, x.end - x.start || 20);
  const taskMinutes = (t: Task) => Math.max(10, t.estimateMin ?? 30);

  // 1. Waiting for room: tasks that did not fit their own day.
  for (const d of [today, ...days]) {
    for (const o of tlOf(d).overflow) {
      if (o.carried || o.task.dueTime) continue;
      add({ key: o.task.id, title: o.task.title, minutes: taskMinutes(o.task), from: o.task.due ?? d, reason: "waiting", taskId: o.task.id });
    }
  }

  // 2. Areas behind their weekly target: their sessions planned for the days still to come this week.
  const behind = behindAreaRows(data, today);
  for (const row of behind) {
    if (doneToday.has(row.id)) continue;
    for (const d of days.filter((x) => x <= sunday)) {
      const it = tlOf(d).items.find((x) => x.kind === "session" && x.areaId === row.id && !x.done && !x.skipped);
      if (it) {
        add({ key: it.sessionKey ?? sessionKey(row.id, d), title: clean(it.title), minutes: minutesOf(it), from: d, reason: "behind", item: it, areaId: row.id });
        break; // one a time for each area: the next one
      }
    }
  }

  // 3. Important tasks (and focus ones) due in the next 7 days, with no time of their own.
  for (const d of days) {
    for (const t of data.tasks.filter((x) => x.status === "open" && x.due === d && !x.dueTime && (x.important || x.focus) && !x.hideUntil)) {
      add({ key: t.id, title: t.title, minutes: taskMinutes(t), from: d, reason: "important", taskId: t.id });
    }
  }

  // 4. Flexible sessions (and untimed tasks) from the BUSIEST upcoming day: that is the day that gains most from being lighter.
  const load = (d: ISODate) => tlOf(d).items.filter((x) => !x.done && !x.skipped && !x.muted && !x.allDay && !x.fixed).reduce((n, x) => n + minutesOf(x), 0);
  const busiest = [...days].sort((a, b) => load(b) - load(a) || a.localeCompare(b))[0];
  if (busiest) {
    for (const it of tlOf(busiest).items.filter((x) => !x.done && !x.skipped && !x.muted && !x.allDay && !x.fixed && (x.kind === "session" || x.kind === "task"))) {
      if (it.kind === "session" && (!it.areaId || doneToday.has(it.areaId) || busiest > sunday)) continue;
      if (it.kind === "task" && !it.taskId) continue;
      add({ key: it.kind === "task" ? it.taskId! : (it.sessionKey ?? it.key), title: clean(it.title), minutes: minutesOf(it), from: busiest, reason: "busiest", taskId: it.kind === "task" ? it.taskId : undefined, item: it.kind === "session" ? it : undefined, areaId: it.areaId });
    }
  }

  return out.sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || a.from.localeCompare(b.from)).slice(0, MAX_CANDIDATES);
}

/** Which of these can be pulled into today without anything overflowing the evening? Greedy in order, within `free` minutes. */
export function preTicked(data: AppData, now: Date, cands: PullCandidate[], free: number): Set<string> {
  const picked = new Set<string>();
  let used = 0;
  for (const c of cands) {
    if (used + c.minutes > free) continue;
    const trial = new Set([...picked, c.key]);
    const moved = applyPull(data, cands.filter((x) => trial.has(x.key)), now).data;
    const tl = buildTimeline(moved, toISO(now), now);
    const ids = new Set(cands.filter((x) => trial.has(x.key)).map((x) => x.taskId).filter(Boolean));
    if (tl.overflow.some((o) => ids.has(o.task.id))) continue;
    picked.add(c.key);
    used += c.minutes;
  }
  return picked;
}

export interface PullResult {
  data: AppData;
  /** Per source day, how many items left it. */
  byDay: Record<ISODate, number>;
  /** The log of what was pulled (kind "pulled"), to append to the history. */
  events: HistoryEvent[];
}

/**
 * Moves the picked items to today. A task simply changes its day (no snooze is counted); a planned session becomes a task of
 * its area that remembers the session it was ("origin"), so finishing it counts as that session with its number, and the day
 * it left no longer has it.
 */
export function applyPull(data: AppData, picks: PullCandidate[], now: Date): PullResult {
  const today = toISO(now);
  let d = data;
  const byDay: Record<ISODate, number> = {};
  const events: HistoryEvent[] = [];
  const at = now.getTime();
  for (const c of picks) {
    if (c.taskId) {
      const t = findTask(d, c.taskId);
      if (!t) continue;
      const next: Task = { ...t, due: today, dueTime: undefined, remindAt: undefined, slot: undefined, hideUntil: undefined };
      if (isOccId(t.id) && !d.tasks.some((x) => x.id === t.id)) d = applyOccTask(d, t.id, t, next);
      else d = { ...d, tasks: d.tasks.map((x) => (x.id === t.id ? next : x)) };
      events.push(newEvent({ at, date: c.from, kind: "pulled", type: t.origin ? (t.origin.kind === "session" ? "session" : t.origin.kind === "bill" ? "bill" : "routine") : "task", key: t.origin?.key ?? (isOccId(t.id) ? `occ:${t.id}` : `task:${t.id}`), title: t.title, area: t.area ?? t.countsFor, createdByMe: !t.generated, to: { date: today } }));
    } else if (c.item) {
      const moved = applyReschedule(d, { kind: "item", item: c.item, date: c.from }, { date: today }, now);
      if (!moved) continue;
      d = moved.data;
      events.push(newEvent({ at, date: c.from, kind: "pulled", type: "session", key: c.item.sessionKey ?? sessionKey(c.areaId ?? "", c.from), title: c.title, area: c.areaId, createdByMe: false, to: { date: today } }));
    } else continue;
    byDay[c.from] = (byDay[c.from] ?? 0) + 1;
  }
  return { data: d, byDay, events };
}

/** "Thu is now 2 items lighter." */
export function lighterLine(byDay: Record<ISODate, number>, today: ISODate): string {
  const parts = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, n]) => `${d === addDays(today, 1) ? "Tomorrow" : weekdayShort(d)} is now ${n} ${n === 1 ? "item" : "items"} lighter`);
  return parts.length ? `${parts.slice(0, 2).join(". ")}${parts.length > 2 ? ` (and ${parts.length - 2} more)` : ""}.` : "Nothing to move.";
}

/** "1h 20m", "45m" */
export const minutesText = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : `${min}m`);
