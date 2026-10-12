import { LATEST_END, planningBusy, timedDuration, type Span } from "./busy";
import { billKey, dueDates } from "./bills";
import { addDays, fromISO, toISO, weekdayShort } from "./dates";
import { isOffDay, OFF_DAY_MAX_MIN } from "./offday";
import { toHHMM, toMin, withDefaults } from "./profile";
import { plannedForDay, SESSION_CAP } from "./schedule";
import { applyOccTask, findTask, isOccId, recordOf, withRepeats } from "./series";
import { choreKey, entryFor, sessionKey } from "./sessions";
import { weekStart } from "./stats";
import { buildTimeline, type TLItem } from "./timeline";
import type { AppData, DayEntry, ISODate, Occurrence, Task } from "./types";

/**
 * Reschedule: the one way to move something. It replaces Snooze everywhere.
 *
 *   +1 hour          now + 60 minutes, rounded up to 5
 *   This evening     the first free slot from 18:00 (not offered after about 21:00)
 *   Tomorrow morning the first free slot in the morning window (8 to 9)
 *   Pick date & time a fixed time you choose (and its reminder)
 *   Not sure         the planner decides: tomorrow, else the next free day, up to 7 days
 *
 * Everything that is moved ends up as a task with a day and maybe a time, so the timeline, planner, reminders and review
 * already know how to treat it. A session, chore or bill from the planner becomes a one-off task that remembers where it
 * came from (`origin`): finishing the task finishes the original, a session keeps its weekly count.
 */
export type RescheduleTarget = { kind: "task"; taskId: string } | { kind: "item"; item: TLItem; date: ISODate };
export type RescheduleChoice = { kind: "hour" } | { kind: "evening" } | { kind: "tomorrow" } | { kind: "pick"; date: ISODate; time: string } | { kind: "not-sure" };

export interface Dest {
  date: ISODate;
  /** "HH:mm". Omitted = no fixed time: the timeline places it in the best gap that day. */
  time?: string;
}

export const EVENING_FROM = 18 * 60;
/** "This evening" is not offered once it is this late. */
export const EVENING_HIDE_AFTER = 21 * 60;
export const MORNING_WINDOW: Span = [11 * 60, 13 * 60];
/** "Not sure" looks at tomorrow and then up to a week ahead. */
export const NOT_SURE_DAYS = 7;

const ceil5 = (n: number) => Math.ceil(n / 5) * 5;
const isWeekend = (d: ISODate) => [0, 6].includes(fromISO(d).getDay());
const uid = () => crypto.randomUUID();
const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

// ---- What is being moved ---------------------------------------------------------------------------------------------

export interface Subject {
  kind: "task" | "session" | "chore" | "bill";
  title: string;
  minutes: number;
  /** The task (an ordinary one, or a repeat's occurrence). */
  task?: Task;
  item?: TLItem;
  /** The day it is on now. */
  date: ISODate;
  /** Counts as a session of this area (so the weekly rules apply). */
  areaId?: string;
}

export function subjectOf(data: AppData, target: RescheduleTarget): Subject | null {
  if (target.kind === "task") {
    const t = findTask(data, target.taskId);
    if (!t) return null;
    return { kind: "task", title: t.title, minutes: timedDuration(t), task: t, date: t.due ?? toISO(new Date()), areaId: t.countsFor };
  }
  const it = target.item;
  const minutes = Math.max(10, it.end - it.start || 20);
  if (it.kind === "session") return { kind: "session", title: it.title, minutes, item: it, date: target.date, areaId: it.areaId };
  if (it.kind === "chore") return { kind: "chore", title: it.title, minutes, item: it, date: target.date };
  if (it.kind === "bill") return { kind: "bill", title: it.title, minutes, item: it, date: target.date };
  return null;
}

// ---- Free time -------------------------------------------------------------------------------------------------------

/**
 * The first start (minutes after midnight, on a 5-minute grid) at or after `from` where `minutes` fit without touching
 * anything fixed that day: events, timed tasks, the tea break, the commute. `ignoreTaskId` is the thing being moved.
 */
export function freeSlot(data: AppData, date: ISODate, from: number, minutes: number, opts: { until?: number; ignoreTaskId?: string; today?: ISODate } = {}): number | null {
  const eff = withRepeats(data, opts.today ?? toISO(new Date()));
  const trial = opts.ignoreTaskId ? { ...eff, tasks: eff.tasks.filter((t) => t.id !== opts.ignoreTaskId) } : eff;
  const spans = planningBusy(trial)(date);
  const limit = opts.until ?? LATEST_END;
  let s = ceil5(from);
  while (s + minutes <= limit) {
    const hit = spans.filter(([a, b]) => s < b && a < s + minutes);
    if (!hit.length) return s;
    s = ceil5(Math.max(...hit.map(([, b]) => b)));
  }
  return null;
}

/** "Tomorrow morning": the first free slot from the earliest auto-planning time (11:00), within the next two hours. */
const morningWindow = (data: AppData): Span => {
  const from = toMin(withDefaults(data.profile).earliestAuto);
  return [from, from + 120];
};

// ---- Not sure: let the planner decide ---------------------------------------------------------------------------------

/** The task a subject would be as a one-off, untouched by where it goes (a session/chore/bill becomes one). */
export function taskFromItem(item: TLItem, date: ISODate, now: Date, over: Partial<Task> = {}): Task {
  const base: Task = {
    id: uid(),
    title: item.title,
    estimateMin: Math.max(10, item.end - item.start || 20),
    important: false,
    tags: [],
    steps: [],
    focus: false,
    status: "open",
    createdAt: now.getTime(),
    generated: true,
  };
  if (item.kind === "session" && item.areaId) {
    return { ...base, area: item.areaId, countsFor: item.areaId, origin: { kind: "session", key: item.sessionKey ?? sessionKey(item.areaId, date), date, areaId: item.areaId }, ...over };
  }
  if (item.kind === "chore" && item.choreId) return { ...base, origin: { kind: "chore", key: choreKey(item.choreId, date), date, choreId: item.choreId }, ...over };
  if (item.kind === "bill" && item.bill) return { ...base, origin: { kind: "bill", key: item.bill.key, date, billId: item.bill.id, due: item.bill.due }, ...over };
  return { ...base, ...over };
}

/** Why a day cannot take one more session of this area (weekend-light, one a day, off days, a full day). null = it can. */
function sessionBlocker(data: AppData, areaId: string, day: ISODate, minutes: number, ignoreTaskId?: string): string | null {
  const area = withDefaults(data.profile).areas.find((a) => a.id === areaId);
  if (!area?.target) return null;
  if (isWeekend(day) && !area.target.weekends) return "weekend";
  if (isOffDay(data, day) && area.target.minutes > OFF_DAY_MAX_MIN) return "off day";
  const planned = plannedForDay(data, day);
  if (planned.some((s) => s.areaId === areaId)) return "already has one";
  const eff = withRepeats(data, toISO(new Date()));
  const taskSessions = eff.tasks.filter((t) => t.status === "open" && t.countsFor && t.due === day && t.id !== ignoreTaskId);
  if (taskSessions.some((t) => t.countsFor === areaId)) return "already has one";
  const used = planned.reduce((n, s) => n + s.minutes, 0) + taskSessions.reduce((n, t) => n + timedDuration(t), 0);
  return used + minutes > SESSION_CAP(day) ? "full" : null;
}

export interface Placement {
  date: ISODate;
  /** Where the timeline put it that day (minutes after midnight), for the message. */
  start: number;
}

/**
 * "Not sure": tomorrow if it has room, else the next day that does, up to a week. Uses the real timeline (nothing
 * overflows the evening) and, for a session, the weekly rules: weekends stay light, one session of an area a day.
 */
export function placeNotSure(data: AppData, subject: Subject, now: Date): Placement | null {
  const today = toISO(now);
  const eff = withRepeats(data, today);
  const made = subject.item ? taskFromItem(subject.item, subject.date, now) : null;
  const base: AppData = made ? { ...eff, tasks: [made, ...eff.tasks], log: withEntry(eff.log, made.origin!.key, "moved", now.getTime()) } : eff;
  const id = made?.id ?? subject.task!.id;
  for (let i = 1; i <= NOT_SURE_DAYS; i++) {
    const day = addDays(today, i);
    if (subject.areaId && sessionBlocker(base, subject.areaId, day, subject.minutes, id)) continue;
    const trial: AppData = { ...base, tasks: base.tasks.map((t) => (t.id === id ? { ...t, due: day, dueTime: undefined, remindAt: undefined, hideUntil: undefined } : t)) };
    // The day as it will be that morning (nothing before "now" is lost).
    const tl = buildTimeline(trial, day, fromISO(day));
    if (tl.overflow.some((o) => o.task.id === id)) continue;
    const placed = tl.items.find((x) => x.taskId === id);
    if (placed) return { date: day, start: placed.start };
  }
  return null;
}

/**
 * A timeline item rebuilt from a notification's reference ("session:powerbi:2026-10-12", "chore:emails:…", "bill:rent:…")
 * for when the item is not on that day's timeline (a chore with no room that evening still has its reminder).
 */
export function itemFromRef(data: AppData, ref: string): { item: TLItem; date: ISODate } | null {
  const [kind, id] = ref.split(":");
  const date = ref.split(":").find((p) => /^\d{4}-\d{2}-\d{2}$/.test(p));
  if (!date) return null;
  const p = withDefaults(data.profile);
  const base = { fixed: false, done: false, skipped: false } as const;
  if (kind === "session") {
    const a = p.areas.find((x) => x.id === id);
    if (!a?.target) return null;
    const start = toMin(a.target.at ?? "18:30");
    return { date, item: { ...base, key: `session:${id}`, kind: "session", title: a.name + " session", start, end: start + a.target.minutes, areaId: id, sessionKey: ref } };
  }
  if (kind === "chore") {
    const c = p.rhythm.find((x) => x.id === id);
    if (!c) return null;
    return { date, item: { ...base, key: `chore:${id}`, kind: "chore", title: c.label, start: toMin(c.time), end: toMin(c.time) + 15, choreId: id } };
  }
  if (kind === "bill") {
    const b = (data.bills ?? []).find((x) => x.id === id);
    if (!b) return null;
    const start = toMin(b.time);
    return { date, item: { ...base, key: ref, kind: "bill", title: b.name, start, end: start + 10, bill: { id, due: date, key: ref, offset: 0, label: "" } } };
  }
  return null;
}

// ---- The options the sheet shows ---------------------------------------------------------------------------------------

export interface Option {
  kind: RescheduleChoice["kind"];
  label: string;
  sub: string;
  dest: Dest | null;
  /** For "Not sure": where the planner would put it. */
  start?: number;
}

/** "today 19:30", "Tomorrow 08:15", "Wed 19:30" */
export function whenText(d: ISODate, time: string | undefined, today: ISODate): string {
  const day = d === today ? "today" : d === addDays(today, 1) ? "Tomorrow" : weekdayShort(d);
  return time ? `${day} ${time}` : day;
}

export function destFor(data: AppData, subject: Subject, choice: RescheduleChoice, now: Date): { dest: Dest | null; start?: number } {
  const today = toISO(now);
  const nowMin = minutesOfDay(now);
  const ignore = subject.task?.id;
  const morning = (): Dest | null => {
    const tomorrow = addDays(today, 1);
    const [a, b] = morningWindow(data);
    const s = freeSlot(data, tomorrow, a, subject.minutes, { until: b, ignoreTaskId: ignore, today }) ?? freeSlot(data, tomorrow, a, subject.minutes, { ignoreTaskId: ignore, today });
    return s == null ? { date: tomorrow, time: toHHMM(a) } : { date: tomorrow, time: toHHMM(s) };
  };
  switch (choice.kind) {
    case "hour": {
      const m = ceil5(nowMin + 60);
      return m + subject.minutes <= LATEST_END ? { dest: { date: today, time: toHHMM(m) } } : { dest: morning() };
    }
    case "evening": {
      if (nowMin >= EVENING_HIDE_AFTER) return { dest: null };
      const s = freeSlot(data, today, Math.max(EVENING_FROM, nowMin + 15), subject.minutes, { ignoreTaskId: ignore, today });
      return { dest: s == null ? null : { date: today, time: toHHMM(s) } };
    }
    case "tomorrow":
      return { dest: morning() };
    case "pick":
      return { dest: { date: choice.date, time: choice.time } };
    case "not-sure": {
      const p = placeNotSure(data, subject, now);
      return p ? { dest: { date: p.date }, start: p.start } : { dest: { date: addDays(today, 1) } };
    }
  }
}

/** The quick options for the sheet, each with where it would land. */
export function rescheduleOptions(data: AppData, target: RescheduleTarget, now: Date): { subject: Subject; options: Option[] } | null {
  const subject = subjectOf(data, target);
  if (!subject) return null;
  const today = toISO(now);
  const row = (kind: Exclude<RescheduleChoice["kind"], "pick">, label: string): Option => {
    const r = destFor(data, subject, { kind }, now);
    const when = r.dest ? whenText(r.dest.date, r.dest.time ?? (r.start != null ? toHHMM(r.start) : undefined), today) : "";
    return { kind, label, sub: when, dest: r.dest, start: r.start };
  };
  const options = [row("hour", "+1 hour"), row("evening", "This evening"), row("tomorrow", "Tomorrow morning"), row("not-sure", "Not sure")];
  return { subject, options: options.filter((o) => o.kind !== "evening" || o.dest) };
}

// ---- Doing it -----------------------------------------------------------------------------------------------------------

/** Everything the move changed, so Undo can put it back exactly. */
export interface RescheduleReceipt {
  taskPrev?: Task;
  createdTaskId?: string;
  occ?: { key: string; prev?: Occurrence };
  entries: Array<{ key: string; prev?: DayEntry }>;
}

function withEntry(log: DayEntry[] | undefined, key: string, status: DayEntry["status"], at: number): DayEntry[] {
  return [...(log ?? []).filter((e) => e.key !== key), { key, status, at }];
}

export interface Moved {
  data: AppData;
  receipt: RescheduleReceipt;
  /** "Moved to Wed 19:30" */
  message: string;
  dest: Dest;
}

/** Moves the thing to `dest`. `shown` = the time to mention when `dest` has none (Not sure). */
export function applyReschedule(data: AppData, target: RescheduleTarget, dest: Dest, now: Date, shown?: number): Moved | null {
  const subject = subjectOf(data, target);
  if (!subject) return null;
  const today = toISO(now);
  const receipt: RescheduleReceipt = { entries: [] };
  const message = `Moved to ${whenText(dest.date, dest.time ?? (shown != null ? toHHMM(shown) : undefined), today)}`;
  const patch = (t: Task): Task => ({ ...t, due: dest.date, dueTime: dest.time, remindAt: undefined, hideUntil: undefined, snoozeCount: 0, alarmAck: undefined });

  if (subject.task) {
    const t = subject.task;
    if (isOccId(t.id) && !data.tasks.some((x) => x.id === t.id)) {
      receipt.occ = { key: t.id, prev: recordOf(data, t.id) };
      return { data: applyOccTask(data, t.id, t, patch(t)), receipt, message, dest };
    }
    receipt.taskPrev = t;
    return { data: { ...data, tasks: data.tasks.map((x) => (x.id === t.id ? patch(x) : x)) }, receipt, message, dest };
  }

  // A session / chore / bill from the planner becomes a one-off task, and the original is marked "moved".
  const item = subject.item!;
  const task = patch(taskFromItem(item, target.kind === "item" ? target.date : today, now));
  const key = task.origin!.key;
  receipt.createdTaskId = task.id;
  receipt.entries.push({ key, prev: entryFor(data.log, key) });
  return { data: { ...data, tasks: [task, ...data.tasks], log: withEntry(data.log, key, "moved", now.getTime()) }, receipt, message, dest };
}

/** Takes a move back exactly. */
export function undoReschedule(data: AppData, r: RescheduleReceipt): AppData {
  let out = data;
  if (r.taskPrev) out = { ...out, tasks: out.tasks.map((t) => (t.id === r.taskPrev!.id ? r.taskPrev! : t)) };
  if (r.createdTaskId) out = { ...out, tasks: out.tasks.filter((t) => t.id !== r.createdTaskId) };
  if (r.occ) {
    const rest = (out.occurrences ?? []).filter((o) => o.key !== r.occ!.key);
    out = { ...out, occurrences: r.occ.prev ? [...rest, r.occ.prev] : rest };
  }
  if (r.entries.length) {
    const keys = new Set(r.entries.map((e) => e.key));
    out = { ...out, log: [...(out.log ?? []).filter((e) => !keys.has(e.key)), ...r.entries.flatMap((e) => (e.prev ? [e.prev] : []))] };
  }
  return out;
}

/** One call for the UI: work out where, move it. */
export function rescheduleNow(data: AppData, target: RescheduleTarget, choice: RescheduleChoice, now: Date): Moved | null {
  const subject = subjectOf(data, target);
  if (!subject) return null;
  const r = destFor(data, subject, choice, now);
  if (!r.dest) return null;
  return applyReschedule(data, target, r.dest, now, r.start);
}

// ---- Missed things carry forward ----------------------------------------------------------------------------------------------

/**
 * Missed items never disappear. Yesterday's sessions that were neither done, skipped nor moved (this week only), and
 * bills / chores due in the last few days that were not ticked, become tasks that are still to do ("Still to do" on
 * Today). A session carried this way is the SAME session: it keeps its weekly count (the planner does not plan a second
 * one) and finishing it counts it. Idempotent: each one is carried once.
 */
export function carryMissed(data: AppData, now: Date): AppData {
  const today = toISO(now);
  const yesterday = addDays(today, -1);
  const firstRun = toISO(new Date(data.settings.firstRunAt));
  let d = data;
  const made: Task[] = [];
  const marks: Array<[string, number]> = [];
  const seen = new Set((d.tasks ?? []).map((t) => t.origin?.key).filter(Boolean) as string[]);
  const carry = (t: Task) => {
    if (seen.has(t.origin!.key)) return;
    seen.add(t.origin!.key);
    made.push(t);
    marks.push([t.origin!.key, now.getTime()]);
  };

  if (yesterday >= weekStart(today) && yesterday > firstRun) {
    const eff = withRepeats(d, today);
    for (const s of plannedForDay(eff, yesterday)) {
      if (s.done) continue;
      const key = sessionKey(s.areaId, yesterday);
      if (entryFor(d.log, key)) continue;
      const area = withDefaults(d.profile).areas.find((a) => a.id === s.areaId);
      if (!area?.target) continue;
      carry({
        id: uid(),
        title: s.title,
        due: yesterday,
        estimateMin: s.minutes,
        area: s.areaId,
        countsFor: s.areaId,
        important: false,
        tags: [],
        steps: [],
        focus: false,
        status: "open",
        createdAt: now.getTime(),
        generated: true,
        origin: { kind: "session", key, date: yesterday, areaId: s.areaId, carried: true },
      });
    }
  }

  for (const bill of d.bills ?? []) {
    if (!bill.enabled || bill.autopay) continue;
    for (const due of dueDates(bill, addDays(today, -3), yesterday, today)) {
      const key = billKey(bill.id, due);
      if (entryFor(d.log, key)) continue;
      carry({
        id: uid(),
        title: bill.name,
        due,
        estimateMin: bill.groceries ? 60 : bill.kind === "chore" ? 20 : 10,
        important: false,
        tags: [],
        steps: [],
        focus: false,
        status: "open",
        createdAt: now.getTime(),
        generated: true,
        origin: { kind: "bill", key, date: due, billId: bill.id, due, carried: true },
      });
    }
  }

  if (!made.length) return d;
  let log = d.log;
  for (const [key, at] of marks) log = withEntry(log, key, "moved", at);
  d = { ...d, tasks: [...made, ...d.tasks], log };
  return d;
}
