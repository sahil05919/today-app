import { addDays, isISO, toISO } from "./dates";
import { eventMarkKey } from "./fixed";
import { withDefaults } from "./profile";
import { sessionTitle } from "./sessions";
import { weekStart } from "./stats";
import type { AppData, HistoryEvent, Task } from "./types";

/**
 * The history log: an append-only record of what was done, skipped, missed and rescheduled, with when it happened, what it
 * was (session, your own task, calendar event, bill, routine) and who made it (you, or the app). The weekly review
 * (lib/weekly.ts) is computed from it, so it can say "You added 5, finished 4" and tell your own tasks from the sessions
 * and reminders the app generates.
 *
 * Nothing writes to it by hand: `withHistory` compares the data before and after every change and appends what happened.
 * Taking something back (an undo) appends a "reopened" entry; nothing is ever edited or removed, so the latest entry for a
 * key says where that item stands.
 */
export const MAX_HISTORY = 20_000;
const FORTNIGHT = 14 * 86_400_000;

export function newEvent(e: Omit<HistoryEvent, "id" | "at"> & { at?: number }): HistoryEvent {
  return { id: crypto.randomUUID(), at: e.at ?? Date.now(), ...e };
}

/** The history type of a task: a rescheduled session is still a session, a carried bill is still a bill. */
export function typeOfTask(t: Pick<Task, "origin">): HistoryEvent["type"] {
  const k = t.origin?.kind;
  return k === "session" ? "session" : k === "bill" ? "bill" : k === "chore" ? "routine" : "task";
}

/** The key an event is filed under: the same item always has the same key, so the latest event says where it stands. */
export function keyOfTask(t: Pick<Task, "id" | "origin">): string {
  return t.origin ? t.origin.key : t.id.includes("@") ? `occ:${t.id}` : `task:${t.id}`;
}

export function taskEvent(t: Task, kind: HistoryEvent["kind"], at: number, date: string, to?: HistoryEvent["to"]): HistoryEvent {
  return newEvent({ at, date, kind, type: typeOfTask(t), key: keyOfTask(t), title: t.title, area: t.area ?? t.countsFor, createdByMe: !t.generated, to });
}

const BLOCK_NAME: Record<string, string> = { work: "Work hours", "commute-to": "Commute to work", "commute-from": "Commute home", lunch: "Lunch", tea: "Tea & food break" };

/** What a `data.log` key is about: the type, and a name for it. null = not something worth recording (wrap-up, nudges). */
function describeKey(data: AppData, key: string): { type: HistoryEvent["type"]; title: string; area?: string; date: string } | null {
  const [kind, id] = key.split(":");
  const date = key.split(":").find((p) => isISO(p));
  if (!date) return null;
  const p = withDefaults(data.profile);
  if (kind === "session") {
    const a = p.areas.find((x) => x.id === id);
    return { type: "session", title: a ? a.name : id, area: id, date };
  }
  if (kind === "chore") return { type: "routine", title: p.rhythm.find((r) => r.id === id)?.label ?? id, date };
  if (kind === "bill") return { type: "bill", title: data.bills?.find((b) => b.id === id)?.name ?? id, date };
  if (kind === "block") return { type: "routine", title: BLOCK_NAME[id] ?? id, date };
  return null;
}

/**
 * What happened between two versions of the data, as history entries. Cheap: each part is only looked at when its array or
 * object actually changed (the store replaces them on every change).
 */
export function diffHistory(prev: AppData, next: AppData, now: number): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  const add = (e: Omit<HistoryEvent, "id" | "at"> & { at?: number }) => out.push(newEvent({ at: now, ...e }));
  const p = withDefaults(next.profile);

  // Sessions you counted ("Power BI session 14").
  if (prev.sessions !== next.sessions) {
    const before = new Map((prev.sessions ?? []).map((l) => [l.id, l]));
    const after = new Map((next.sessions ?? []).map((l) => [l.id, l]));
    for (const l of next.sessions ?? []) {
      if (before.has(l.id)) continue;
      const a = p.areas.find((x) => x.id === l.areaId);
      add({ kind: "done", type: "session", key: `session:${l.areaId}:${l.date}`, title: a ? sessionTitle(a, l.n, l.variant) : l.areaId, area: l.areaId, date: l.date, createdByMe: false });
    }
    for (const l of prev.sessions ?? []) {
      if (after.has(l.id)) continue;
      const a = p.areas.find((x) => x.id === l.areaId);
      add({ kind: "reopened", type: "session", key: `session:${l.areaId}:${l.date}`, title: a ? a.name : l.areaId, area: l.areaId, date: l.date, createdByMe: false });
    }
  }

  // Sessions, chores, bills and routine blocks that were ticked or skipped.
  if (prev.log !== next.log) {
    const before = new Map((prev.log ?? []).map((e) => [e.key, e]));
    const after = new Map((next.log ?? []).map((e) => [e.key, e]));
    for (const e of next.log ?? []) {
      const b = before.get(e.key);
      if (b?.status === e.status) continue;
      const d = describeKey(next, e.key);
      if (!d) continue;
      if (e.status === "skip") add({ kind: "skipped", ...d, key: e.key, createdByMe: false });
      else if (e.status === "done" && d.type !== "session") add({ kind: "done", ...d, key: e.key, createdByMe: false });
    }
    for (const b of prev.log ?? []) {
      // Only a take-back counts: old entries disappear by themselves after a while.
      if (after.has(b.key) || !(b.status === "skip" || b.status === "done") || now - b.at > FORTNIGHT) continue;
      const d = describeKey(next, b.key);
      if (d && !(b.status === "done" && d.type === "session")) add({ kind: "reopened", ...d, key: b.key, createdByMe: false });
    }
  }

  // Tasks: finished, taken back, moved, or made by the app (a carried / rescheduled session, chore or bill).
  if (prev.tasks !== next.tasks) {
    const before = new Map(prev.tasks.map((t) => [t.id, t]));
    for (const t of next.tasks) {
      const b = before.get(t.id);
      if (!b) {
        if (t.origin) {
          add({ kind: t.origin.carried ? "missed" : "rescheduled", type: typeOfTask(t), key: t.origin.key, title: t.title, area: t.area ?? t.countsFor, date: t.origin.date, createdByMe: false, to: t.origin.carried || !t.due ? undefined : { date: t.due, time: t.dueTime } });
        }
        continue;
      }
      if (b.status === "open" && t.status === "done") out.push(taskEvent(t, "done", t.completedAt ?? now, t.due ?? toISO(new Date(now))));
      else if (b.status === "done" && t.status === "open") out.push(taskEvent(t, "reopened", now, t.due ?? toISO(new Date(now))));
      else if (t.status === "open" && t.due && (b.due !== t.due || b.dueTime !== t.dueTime)) out.push(taskEvent(t, "rescheduled", now, b.due ?? t.due, { date: t.due, time: t.dueTime }));
    }
  }

  // Repeating tasks: each day is its own.
  if (prev.occurrences !== next.occurrences) {
    const before = new Map((prev.occurrences ?? []).map((r) => [r.key, r]));
    const after = new Map((next.occurrences ?? []).map((r) => [r.key, r]));
    const title = (r: { seriesId: string; over?: { title?: string } }) => r.over?.title ?? next.series?.find((s) => s.id === r.seriesId)?.title ?? "Task";
    const area = (r: { seriesId: string }) => next.series?.find((s) => s.id === r.seriesId)?.area;
    const ev = (kind: HistoryEvent["kind"], r: { key: string; seriesId: string; date: string; over?: { title?: string } }, at: number, to?: HistoryEvent["to"]) =>
      add({ kind, type: "task", key: `occ:${r.key}`, title: title(r), area: area(r), date: r.date, createdByMe: true, at, to });
    for (const r of next.occurrences ?? []) {
      const b = before.get(r.key);
      if (r.status !== b?.status) {
        if (r.status === "done") ev("done", r, r.doneAt ?? now);
        else if (r.status === "skipped") ev("skipped", r, now);
        else if (r.status === "missed") ev("missed", r, now);
        else if (b?.status === "done" || b?.status === "skipped") ev("reopened", r, now);
      }
      if (r.movedTo && (r.movedTo.date !== b?.movedTo?.date || r.movedTo.time !== b?.movedTo?.time)) ev("rescheduled", r, now, r.movedTo);
    }
    for (const b of prev.occurrences ?? []) if (!after.has(b.key) && b.status === "done") ev("reopened", b, now);
  }

  // Calendar and own events you ticked off (stored on this phone only).
  if (prev.eventMarks !== next.eventMarks) {
    const names = new Map([...(next.events ?? []), ...(next.calendarEvents ?? [])].map((e) => [eventMarkKey(e), e.title]));
    for (const [k, m] of Object.entries(next.eventMarks ?? {})) {
      if (m.done && !prev.eventMarks?.[k]?.done) add({ kind: "done", type: "event", key: `event:${k}`, title: names.get(k) ?? "Event", date: k.slice(k.lastIndexOf("@") + 1), createdByMe: true });
    }
    for (const [k, m] of Object.entries(prev.eventMarks ?? {})) {
      if (m.done && !next.eventMarks?.[k]?.done) add({ kind: "reopened", type: "event", key: `event:${k}`, title: names.get(k) ?? "Event", date: k.slice(k.lastIndexOf("@") + 1), createdByMe: true });
    }
  }

  // One entry per (what happened, which item) in a single change.
  const seen = new Set<string>();
  return out.filter((e) => {
    const id = `${e.kind}|${e.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** `next` with whatever happened since `prev` appended to its history. */
export function withHistory(prev: AppData, next: AppData, now: number = Date.now()): AppData {
  const added = diffHistory(prev, next, now);
  if (!added.length) return next;
  return { ...next, history: [...(next.history ?? []), ...added].slice(-MAX_HISTORY) };
}

/**
 * The history for the current week, rebuilt from what the older data already holds (sessions you counted, ticked chores
 * and bills, skips, tasks you finished), so the first review is not empty. Run once, when the data is upgraded.
 */
export function backfillHistory(d: AppData, now: Date = new Date()): HistoryEvent[] {
  const start = weekStart(toISO(now));
  const end = addDays(start, 6);
  const p = withDefaults(d.profile);
  const out: HistoryEvent[] = [];
  const inWeek = (day: string) => day >= start && day <= end;
  for (const l of d.sessions ?? []) {
    if (!inWeek(l.date)) continue;
    const a = p.areas.find((x) => x.id === l.areaId);
    out.push(newEvent({ at: Math.min(l.at, now.getTime()), date: l.date, kind: "done", type: "session", key: `session:${l.areaId}:${l.date}`, title: a ? sessionTitle(a, l.n, l.variant) : l.areaId, area: l.areaId, createdByMe: false }));
  }
  for (const e of d.log ?? []) {
    const info = describeKey(d, e.key);
    if (!info || !inWeek(info.date)) continue;
    if (e.status === "skip") out.push(newEvent({ at: e.at, kind: "skipped", key: e.key, createdByMe: false, ...info }));
    else if (e.status === "done" && info.type !== "session") out.push(newEvent({ at: e.at, kind: "done", key: e.key, createdByMe: false, ...info }));
  }
  for (const t of d.tasks) {
    if (t.status !== "done" || !t.completedAt || !inWeek(toISO(new Date(t.completedAt)))) continue;
    out.push(taskEvent(t, "done", t.completedAt, t.due ?? toISO(new Date(t.completedAt))));
  }
  for (const r of d.occurrences ?? []) {
    if (r.status !== "done" || !r.doneAt || !inWeek(toISO(new Date(r.doneAt)))) continue;
    out.push(newEvent({ at: r.doneAt, date: r.date, kind: "done", type: "task", key: `occ:${r.key}`, title: r.over?.title ?? d.series?.find((s) => s.id === r.seriesId)?.title ?? "Task", area: d.series?.find((s) => s.id === r.seriesId)?.area, createdByMe: true }));
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The latest entry for each key among `events` (so a done that was undone counts as not done). */
export function latestByKey(events: HistoryEvent[]): Map<string, HistoryEvent> {
  const out = new Map<string, HistoryEvent>();
  for (const e of [...events].sort((a, b) => a.at - b.at)) out.set(e.key, e);
  return out;
}
