import { addDays, fromISO, toISO } from "./dates";
import { billKey } from "./bills";
import { withDefaults } from "./profile";
import { nextOccurrence } from "./recur";
import { addLog, choreKey, removeLog, sessionKey, sessionTitle } from "./sessions";
import type { AppData, DayEntry, ISODate, Task } from "./types";

/**
 * Ticking something off, ONE set of rules for every route: the Calendar sheet, the Today list, typed phrases
 * ("grocery done", "guitar kiya") and the timer all end up in `applyDone`. It works the same for every area, chore, bill
 * and task, including ones you add later, because it only looks at ids and dates, never at names.
 *
 *   when "on-its-day"  the item's own day (today's item, or an item whose day has come)
 *   when "today"       "I did this early / now": counts today. A future occurrence is used up (no slot, no reminder);
 *                      repeating chores restart from today.
 *   when "backdate"    a missed day, filled in afterwards: a session is logged on THAT date.
 */
export type DoneTarget =
  | { kind: "session"; areaId: string; date: ISODate }
  | { kind: "rhythm"; id: string; date: ISODate }
  | { kind: "bill"; id: string; due: ISODate }
  | { kind: "task"; id: string };

export type DoneWhen = "on-its-day" | "today" | "backdate";

/** Everything needed to take a tick back exactly (and nothing else that changed in the meantime). */
export interface DoneReceipt {
  target: DoneTarget;
  /** Session: the log that was added. */
  logId?: string;
  /** Log entries as they were before the tick: key → previous entry (undefined = there was none). */
  entries: Array<{ key: string; prev?: DayEntry }>;
  /** Bill / chore: when it was last done before. */
  billPrev?: { id: string; lastDone?: ISODate };
  /** Task: the one that was completed, and the next occurrence it spawned. */
  taskId?: string;
}

export interface DoneOutcome {
  data: AppData;
  receipt: DoneReceipt;
  /** Nothing changed (it was already counted). */
  noop: boolean;
  /** "Grocery run done early. No reminder tomorrow 👍" */
  message: string;
  /** What it was: "Power BI session 15", "Grocery run". */
  title: string;
  /** The day the thing was due or planned for, when that is not the day it was ticked. */
  forDate?: ISODate;
  early: boolean;
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "today", "tomorrow", "yesterday" or "Thursday". */
export function dayWord(date: ISODate, today: ISODate): string {
  const diff = Math.round((fromISO(date).getTime() - fromISO(today).getTime()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return WEEKDAY[fromISO(date).getDay()];
}

const cleanName = (t: string) => t.replace(/ · session \d+$| session \d+$/, "");

/** Puts back the entries a tick changed. */
function restoreEntries(log: DayEntry[] | undefined, entries: DoneReceipt["entries"]): DayEntry[] {
  const keys = new Set(entries.map((e) => e.key));
  return [...(log ?? []).filter((e) => !keys.has(e.key)), ...entries.flatMap((e) => (e.prev ? [e.prev] : []))];
}

/** Sets (or, with null, clears) entries, remembering what was there. Entries older than 60 days are dropped. */
function setEntries(data: AppData, changes: Array<[string, DayEntry["status"]]>, now: number, receipt: DoneReceipt): AppData {
  const cutoff = now - 60 * 86_400_000;
  const keys = new Set(changes.map(([k]) => k));
  for (const [key] of changes) receipt.entries.push({ key, prev: (data.log ?? []).find((e) => e.key === key) });
  const rest = (data.log ?? []).filter((e) => !keys.has(e.key) && e.at > cutoff);
  return { ...data, log: [...rest, ...changes.map(([key, status]) => ({ key, status, at: now }))] };
}

// ---- Tasks (shared with the store's toggleDone) -----------------------------------------------------------------

/**
 * Completes a task. A repeating one spawns its next occurrence; a task that counts as a session (a freed slot filled with
 * an "extra session") logs it. Returns the new data and the spawned task.
 */
export function completeTaskIn(d: AppData, id: string, now: Date): { data: AppData; next: Task | null } | null {
  const t = d.tasks.find((x) => x.id === id);
  if (!t || t.status === "done") return null;
  const today = toISO(now);
  let next: Task | null = null;
  if (t.recur) {
    // If it's overdue, count from today so we don't spawn a pile of missed occurrences.
    const base = t.due && t.due > today ? t.due : today;
    next = {
      ...t,
      id: crypto.randomUUID(),
      due: nextOccurrence(t.recur, base),
      steps: t.steps.map((s) => ({ ...s, id: crypto.randomUUID(), done: false })),
      status: "open",
      completedAt: undefined,
      nextId: undefined,
      focus: false,
      lastCheckIn: undefined,
      sessionLogId: undefined,
      createdAt: now.getTime(),
    };
  }
  let data = d;
  let sessionLogId: string | undefined;
  if (t.countsFor) {
    const r = addLog(d, t.countsFor, today, "manual", now);
    if (r) {
      data = r.data;
      sessionLogId = r.log.id;
    }
  }
  const done: Task = { ...t, status: "done", completedAt: now.getTime(), focus: false, nextId: next?.id, sessionLogId };
  return { data: { ...data, tasks: [...(next ? [next] : []), ...d.tasks.map((x) => (x.id === id ? done : x))] }, next };
}

/** Reopens a completed task: removes the occurrence it spawned (if still untouched) and the session it logged. */
export function reopenTaskIn(d: AppData, id: string): AppData | null {
  const t = d.tasks.find((x) => x.id === id);
  if (!t || t.status !== "done") return null;
  const tasks = d.tasks
    .filter((x) => !(t.nextId && x.id === t.nextId && x.status === "open"))
    .map((x) => (x.id === id ? { ...x, status: "open" as const, completedAt: undefined, nextId: undefined, sessionLogId: undefined } : x));
  const base = { ...d, tasks };
  return t.sessionLogId ? removeLog(base, t.sessionLogId) : base;
}

// ---- The shared tick ---------------------------------------------------------------------------------------------

export interface DoneOptions {
  when: DoneWhen;
  now?: Date;
  /** Add another session even if that day already has one ("+1 more"). */
  extra?: boolean;
}

export function applyDone(d: AppData, target: DoneTarget, opts: DoneOptions): DoneOutcome {
  const now = opts.now ?? new Date();
  const today = toISO(now);
  const p = withDefaults(d.profile);
  const receipt: DoneReceipt = { target, entries: [] };
  const out = (o: Partial<DoneOutcome> & Pick<DoneOutcome, "data" | "message" | "title">): DoneOutcome => ({ receipt, noop: false, early: false, ...o });

  if (target.kind === "session") {
    const area = p.areas.find((a) => a.id === target.areaId);
    if (!area?.target) return out({ data: d, message: "That isn't an area with a weekly target", title: target.areaId, noop: true });
    // Which day the session counts on: today for "early" (and for anything not yet due), else the day itself.
    const logDate = opts.when === "today" || target.date > today ? today : target.date;
    const has = (d.sessions ?? []).some((l) => l.areaId === area.id && l.date === logDate);
    if (has && !opts.extra && logDate === target.date) {
      return out({ data: d, noop: true, message: `${area.name} is already counted ${dayWord(logDate, today)}`, title: area.name });
    }
    const key = sessionKey(area.id, logDate);
    receipt.entries.push({ key, prev: (d.log ?? []).find((e) => e.key === key) });
    const added = addLog(d, area.id, logDate, "manual", now);
    if (!added) return out({ data: d, noop: true, message: "Could not count that", title: area.name });
    receipt.logId = added.log.id;
    let data = added.data;
    // The occurrence that was planned for another day is used up: no slot, no reminder, no re-planning.
    const elsewhere = target.date !== logDate;
    if (elsewhere) data = setEntries(data, [[sessionKey(area.id, target.date), "early"]], now.getTime(), receipt);
    const title = sessionTitle(area, added.log.n, added.log.variant);
    const early = target.date > today;
    const message = early
      ? `${cleanName(title)} done early. No reminder ${dayWord(target.date, today)} 👍`
      : elsewhere
        ? `${title} counted today. ${dayWord(target.date, today) === "yesterday" ? "Yesterday's is cleared" : `${dayWord(target.date, today)}'s is cleared`} 👍`
        : logDate < today
          ? `${title} logged for ${dayWord(logDate, today)} 👍`
          : has
            ? `${title} counted: another one ${dayWord(logDate, today)}`
            : `${title} counted`;
    return out({ data, title, message, early, forDate: elsewhere ? target.date : undefined });
  }

  if (target.kind === "rhythm") {
    const c = p.rhythm.find((r) => r.id === target.id);
    if (!c) return out({ data: d, noop: true, message: "That check-in is gone", title: target.id });
    const key = choreKey(c.id, target.date);
    const existing = (d.log ?? []).find((e) => e.key === key);
    if (existing?.status === "done") return out({ data: d, noop: true, message: `${c.label} is already done`, title: c.label });
    const data = setEntries(d, [[key, "done"]], now.getTime(), receipt);
    const early = target.date > today;
    return out({
      data,
      title: c.label,
      early,
      forDate: target.date !== today ? target.date : undefined,
      message: early ? `${c.label} done early. No reminder ${dayWord(target.date, today)} 👍` : target.date < today ? `${c.label} marked done for ${dayWord(target.date, today)} 👍` : `${c.label} done`,
    });
  }

  if (target.kind === "bill") {
    const bill = (d.bills ?? []).find((b) => b.id === target.id);
    if (!bill) return out({ data: d, noop: true, message: "That item is gone", title: target.id });
    const key = billKey(bill.id, target.due);
    if ((d.log ?? []).find((e) => e.key === key)?.status === "done") return out({ data: d, noop: true, message: `${bill.name} is already done`, title: bill.name });
    // "every N days" restarts from the day it was really done; a bill paid before its date is simply paid.
    const doneOn = opts.when === "today" || target.due > today ? today : target.due;
    receipt.billPrev = { id: bill.id, lastDone: bill.lastDone };
    const data0 = setEntries(d, [[key, "done"]], now.getTime(), receipt);
    const lastDone = bill.lastDone && bill.lastDone > doneOn ? bill.lastDone : doneOn;
    const data = { ...data0, bills: (data0.bills ?? []).map((b) => (b.id === bill.id ? { ...b, lastDone } : b)) };
    const early = target.due > today;
    const verb = bill.kind === "bill" ? "paid" : "done";
    const next = bill.schedule.type === "every" ? ` Next one ${dayWord(addDays(lastDone, bill.schedule.days), today)}.` : "";
    return out({
      data,
      title: bill.name,
      early,
      forDate: target.due !== today ? target.due : undefined,
      message: early
        ? `${bill.name} ${verb}${opts.when === "today" ? " early" : ""}. No reminder ${dayWord(target.due, today)} 👍${next}`
        : target.due < today
          ? `${bill.name} ${verb} 👍${next}`
          : `${bill.name} ${verb}${next}`,
    });
  }

  // task
  const t = d.tasks.find((x) => x.id === target.id);
  if (!t) return out({ data: d, noop: true, message: "That task is gone", title: target.id });
  if (t.status === "done") return out({ data: d, noop: true, message: `${t.title} is already done`, title: t.title });
  const r = completeTaskIn(d, t.id, now)!;
  receipt.taskId = t.id;
  const early = !!t.due && t.due > today;
  return out({
    data: r.data,
    title: t.title,
    early,
    forDate: t.due && t.due !== today ? t.due : undefined,
    message: early ? `${t.title} done early 👍${r.next ? ` Next: ${dayWord(r.next.due!, today)}.` : ""}` : `${t.title} done${r.next ? `. Next: ${dayWord(r.next.due!, today)}` : ""}`,
  });
}

/** Takes a tick back: removes exactly the session it added, puts back the entries and the last-done date it changed. */
export function revertDone(d: AppData, receipt: DoneReceipt): AppData {
  let out = d;
  if (receipt.logId) out = removeLog(out, receipt.logId);
  if (receipt.entries.length) out = { ...out, log: restoreEntries(out.log, receipt.entries) };
  if (receipt.billPrev) {
    const { id, lastDone } = receipt.billPrev;
    out = { ...out, bills: (out.bills ?? []).map((b) => (b.id === id ? { ...b, lastDone } : b)) };
  }
  if (receipt.taskId) out = reopenTaskIn(out, receipt.taskId) ?? out;
  return out;
}

/** What a tap on an item means for the day it is shown on: its own day, early, or catching up. */
export function whenFor(date: ISODate, today: ISODate): DoneWhen {
  return date === today ? "on-its-day" : date > today ? "today" : "backdate";
}
