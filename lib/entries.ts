import { addDays } from "./dates";
import { categorise, catCtx, type CatItem } from "./categorise";
import { eventMarkKey, eventSpan } from "./fixed";
import { historyCategory } from "./catHistory";
import { latestByKey } from "./history";
import { cached } from "./memo";
import { withDefaults } from "./profile";
import { sessionTitle } from "./sessions";
import { getOccurrences } from "./series";
import type { AppData, Category, FixedEvent, HistoryEvent, ISODate, ItemSource, Task } from "./types";

/**
 * Every thing the app knows about, as one flat list: your tasks, repeats, finished sessions, calendar events, logged time, learnings,
 * app notes, and everything in the history log that nothing else still holds. Each entry has its category (lib/categorise.ts), its
 * source and its day. The search (lib/search.ts) and the "backfill" of old history read this list; nothing else computes it.
 *
 * Built once per data snapshot (memoized), so a search costs a filter, not a rebuild.
 */
export type EntryKind = "task" | "occurrence" | "session" | "event" | "logged" | "learning" | "note" | "history";
export type EntryStatus = "upcoming" | "done" | "missed" | "skipped";

export interface Entry {
  /** Unique. For items you can re-categorise it is also the key of `data.catPicks`. */
  key: string;
  kind: EntryKind;
  title: string;
  notes?: string;
  date: ISODate;
  time?: string;
  status: EntryStatus;
  minutes: number;
  cat: Category;
  src: ItemSource;
  /** What opens when the row is tapped: a task / occurrence id. */
  openId?: string;
  /** The area id when it is a session of a tracked area. */
  areaId?: string;
  /** A phone-calendar or own event. */
  event?: FixedEvent;
}

const DEFAULT_TASK_MIN = 20;
const DEFAULT_REPEAT_MIN = 15;
const sum = (xs: Array<{ min: number }> | undefined) => (xs ?? []).reduce((n, x) => n + x.min, 0);
const dayOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Where a task came from. */
export function taskSource(t: Task): ItemSource {
  if (t.src) return t.src;
  if (t.notes?.startsWith("From Gmail:")) return "gmail-task";
  if (t.seriesId) return "recurring";
  return t.generated ? "planner-move" : "me";
}

/** Where an event came from. */
export function eventSource(e: FixedEvent): ItemSource {
  if (e.src) return e.src;
  if (e.shift) return "gmail-shift";
  if (e.remind) return /interview/i.test(e.title) ? "gmail-interview" : "gmail-booking";
  if (e.source === "calendar") return "phone-calendar";
  return "me";
}

/** The input `categorise` wants, for a task or one day of a repeat. */
export function catItemOfTask(t: Task): CatItem {
  const inherited = !!(t.seriesId || t.origin || t.countsFor);
  return { key: t.seriesId ? `occ:${t.id}` : `task:${t.id}`, title: t.title, notes: t.notes, tags: t.tags, area: t.area ?? t.origin?.areaId ?? t.countsFor, how: t.catHow, inherited: inherited && !!(t.area ?? t.origin?.areaId ?? t.countsFor) };
}

export function catItemOfEvent(e: FixedEvent): CatItem {
  return { key: `event:${eventMarkKey(e)}`, title: e.title, area: e.area ?? e.countsFor, inherited: !!e.countsFor };
}

export const categoryOfTask = (data: AppData, t: Task): Category => categorise(catItemOfTask(t), catCtx(data));
export const categoryOfEvent = (data: AppData, e: FixedEvent): Category => categorise(catItemOfEvent(e), catCtx(data));

const HIST_STATUS: Partial<Record<HistoryEvent["kind"], EntryStatus>> = { done: "done", skipped: "skipped", missed: "missed" };

/** How far back repeats are expanded, and forward. */
const BACK_DAYS = 200;
const AHEAD_DAYS = 45;

export function buildEntries(data: AppData, today: ISODate): Entry[] {
  return cached(data, `entries:${today}`, () => compute(data, today));
}

function compute(data: AppData, today: ISODate): Entry[] {
  const ctx = catCtx(data);
  const p = withDefaults(data.profile);
  const out: Entry[] = [];
  const seen = new Set<string>();
  const add = (e: Omit<Entry, "cat"> & { cat?: Category; item?: CatItem }) => {
    if (seen.has(e.key)) return;
    seen.add(e.key);
    const { item, cat, ...rest } = e;
    out.push({ ...rest, cat: cat ?? categorise(item ?? { key: e.key, title: e.title, notes: e.notes }, ctx) });
  };

  // Your tasks, open and done (a repeat's days are below).
  for (const t of data.tasks) {
    const item = catItemOfTask(t);
    const done = t.status === "done";
    add({
      key: `task:${t.id}`,
      kind: "task",
      title: t.title,
      notes: t.notes,
      date: done && t.completedAt ? dayOf(t.completedAt) : (t.due ?? dayOf(t.createdAt)),
      time: t.dueTime,
      status: done ? "done" : "upcoming",
      minutes: sum(t.sessions) || t.estimateMin || DEFAULT_TASK_MIN,
      src: taskSource(t),
      openId: t.id,
      item,
      areaId: t.countsFor ?? t.origin?.areaId,
    });
  }

  // Days of repeating tasks and life admin.
  for (const o of getOccurrences(data, addDays(today, -BACK_DAYS), addDays(today, AHEAD_DAYS), today)) {
    const status: EntryStatus = o.status === "done" ? "done" : o.status === "skipped" ? "skipped" : o.status === "missed" ? "missed" : o.on < today && !o.carried ? "missed" : "upcoming";
    const t = o.task;
    add({
      key: `occ:${o.key}`,
      kind: "occurrence",
      title: t.title,
      notes: t.notes,
      date: o.record?.doneAt && o.status === "done" ? dayOf(o.record.doneAt) : o.on,
      time: o.time,
      status,
      minutes: sum(o.record?.sessions) || o.series.estimateMin || DEFAULT_REPEAT_MIN,
      src: o.series.lifeId ? "life-admin" : "recurring",
      openId: o.key,
      item: { ...catItemOfTask({ ...t, id: o.key, seriesId: o.seriesId }), inherited: !!t.area },
    });
  }

  // Finished sessions of your tracked areas.
  for (const l of data.sessions ?? []) {
    const a = p.areas.find((x) => x.id === l.areaId);
    add({ key: `sess:${l.id}`, kind: "session", title: a ? sessionTitle(a, l.n, l.variant) : l.areaId, date: l.date, status: "done", minutes: l.minutes, src: "recurring", areaId: l.areaId, item: { key: `sess:${l.id}`, title: a?.name ?? l.areaId, area: l.areaId, inherited: true } });
  }

  // Time you logged by typing.
  for (const w of data.worklog ?? []) {
    add({ key: `log:${w.id}`, kind: "logged", title: w.title, date: w.date, status: "done", minutes: w.minutes, src: "me", item: { key: `log:${w.id}`, title: w.title, sub: data.workSubs?.[`log:${w.id}`] ?? w.sub } });
  }

  // Calendar events (the phone's, and the ones you typed).
  for (const e of [...(data.events ?? []), ...(data.calendarEvents ?? [])]) {
    const [a, b] = e.start ? eventSpan(e) : [0, 30];
    const marked = data.eventMarks?.[eventMarkKey(e)];
    add({
      key: `event:${eventMarkKey(e)}`,
      kind: "event",
      title: e.title,
      date: e.date,
      time: e.start,
      status: marked?.done || e.date < today ? "done" : "upcoming",
      minutes: Math.max(5, b - a),
      src: eventSource(e),
      event: e,
      areaId: e.countsFor,
      item: catItemOfEvent(e),
    });
  }

  // What you learned, and notes about the app: searchable text.
  for (const l of data.learnings ?? []) add({ key: `learn:${l.id}`, kind: "learning", title: l.text, date: l.date, status: "done", minutes: 0, src: "me", item: { key: `learn:${l.id}`, title: l.text, area: l.areaId, inherited: true } });
  for (const n of data.notes ?? []) add({ key: `note:${n.id}`, kind: "note", title: n.text, date: n.date, status: "done", minutes: 0, src: "me", item: { key: `note:${n.id}`, title: n.text } });

  // History: what happened to things that nothing else still holds (bills, skipped or missed sessions, deleted tasks, older weeks).
  for (const [key, e] of latestByKey(data.history ?? [])) {
    const status = HIST_STATUS[e.kind];
    if (!status || seen.has(key) || (e.type === "session" && e.kind === "done")) continue;
    if (key.startsWith("log:") && seen.has(key)) continue;
    add({ key, kind: "history", title: e.title, date: e.kind === "missed" ? e.date : dayOf(e.at), status, minutes: 0, src: e.src ?? (e.createdByMe ? "me" : "recurring"), areaId: e.type === "session" ? e.area : undefined, cat: historyCategory(data, e) });
  }
  return out;
}
