import { addDays, toISO } from "./dates";
import { firstOccurrence, isNthWeekday } from "./recur";
import { addLog, removeLog } from "./sessions";
import type { AppData, ISODate, Occurrence, Recurrence, Series, Step, Task } from "./types";

/**
 * Repeating tasks as SERIES + OCCURRENCES.
 *
 * A series holds the task (title, time, duration, area, steps…) and a rule. Occurrences are COMPUTED from the rule for
 * whatever dates are asked for, so nothing is ever generated ahead of time and finishing one never creates the next.
 * A small record (`Occurrence`) exists only when one occurrence differs: done, skipped, missed, rescheduled, time
 * override, or edited "this one only". Occurrence key = seriesId + the ORIGINAL day: "<seriesId>@2026-10-14".
 *
 * `getOccurrences(start, end)` is the ONE reader. The Calendar, Today, Coming up, the planner, the notifications and the
 * weekly review all get repeats from it (via `withOccurrences`, which adds them to `tasks` as ordinary-looking tasks).
 */
export const LOOKBACK_DAYS = 60;

export const occKey = (seriesId: string, date: ISODate) => `${seriesId}@${date}`;
const KEY_RE = /^(.+)@(\d{4}-\d{2}-\d{2})$/;
export function parseOccKey(id: string): { seriesId: string; date: ISODate } | null {
  const m = KEY_RE.exec(id);
  return m ? { seriesId: m[1], date: m[2] } : null;
}
export const isOccId = (id: string) => KEY_RE.test(id);

// ---- Rules -------------------------------------------------------------------------------------------------------

const mod = (a: number, n: number) => ((a % n) + n) % n;
const dayNum = (iso: ISODate) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};
/** Monday-based week index (1970-01-01 was a Thursday). */
const weekNum = (iso: ISODate) => Math.floor((dayNum(iso) + 3) / 7);
/** 0 = Sunday … 6 = Saturday, independent of the time zone. */
const dowOf = (iso: ISODate) => mod(dayNum(iso) + 4, 7);
const monthIdx = (iso: ISODate) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const lastDayOfMonth = (iso: ISODate) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();

/** Does the rule produce a day on `date`? Counting (every N days / weeks / months) starts at `anchor`. */
export function ruleHits(rule: Recurrence, anchor: ISODate, date: ISODate): boolean {
  const n = Math.max(1, Math.round(rule.interval || 1));
  if (rule.freq === "daily") return mod(dayNum(date) - dayNum(anchor), n) === 0;
  if (rule.freq === "weekly") {
    const days = rule.weekdays?.length ? rule.weekdays : [dowOf(anchor)];
    return days.includes(dowOf(date)) && mod(weekNum(date) - weekNum(anchor), n) === 0;
  }
  if (rule.weekdays?.length && rule.nth) return rule.weekdays.includes(dowOf(date)) && isNthWeekday(date, rule.nth) && mod(monthIdx(date) - monthIdx(anchor), n) === 0;
  const day = rule.monthDay ?? Number(anchor.slice(8, 10));
  return Number(date.slice(8, 10)) === Math.min(day, lastDayOfMonth(date)) && mod(monthIdx(date) - monthIdx(anchor), n) === 0;
}


const seriesAnchor = (s: Series) => s.anchor ?? s.startDate;

/** Does this series produce an occurrence on `date` (by its rule, ignoring any records)? */
export function seriesHas(s: Series, date: ISODate): boolean {
  return !s.off && date >= s.startDate && (!s.until || date <= s.until) && ruleHits(s.rule, seriesAnchor(s), date);
}

/** The days the rule produces within [from, to]. */
export function seriesDates(s: Series, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  if (s.off) return out;
  const a = from > s.startDate ? from : s.startDate;
  const b = s.until && s.until < to ? s.until : to;
  for (let d = a; d <= b; d = addDays(d, 1)) if (ruleHits(s.rule, seriesAnchor(s), d)) out.push(d);
  return out;
}

/** The first day after `date` the series happens (null if it has ended). */
export function nextDateAfter(s: Series, date: ISODate, horizon = 800): ISODate | null {
  for (let i = 1; i <= horizon; i++) {
    const d = addDays(date, i);
    if (s.until && d > s.until) return null;
    if (d >= s.startDate && ruleHits(s.rule, seriesAnchor(s), d)) return d;
  }
  return null;
}

// ---- Records -----------------------------------------------------------------------------------------------------

interface Index {
  byKey: Map<string, Occurrence>;
  bySeries: Map<string, Occurrence[]>;
}
const EMPTY: Occurrence[] = [];
const indexes = new WeakMap<Occurrence[], Index>();
function indexOf(data: AppData): Index {
  const list = data.occurrences ?? EMPTY;
  let ix = indexes.get(list);
  if (!ix) {
    ix = { byKey: new Map(), bySeries: new Map() };
    for (const r of list) {
      ix.byKey.set(r.key, r);
      const l = ix.bySeries.get(r.seriesId);
      if (l) l.push(r);
      else ix.bySeries.set(r.seriesId, [r]);
    }
    indexes.set(list, ix);
  }
  return ix;
}
export const recordOf = (data: AppData, key: string): Occurrence | undefined => indexOf(data).byKey.get(key);

const effTime = (s: Series, rec?: Occurrence) => (rec?.time !== undefined ? rec.time || undefined : s.time);

/** The occurrence as a task (the shape every screen already understands). Its id is the occurrence key. */
export function occTask(s: Series, date: ISODate, rec?: Occurrence): Task {
  const moved = rec?.movedTo;
  const over = rec?.over ?? {};
  const steps: Step[] = over.steps ?? s.steps.map((st) => ({ ...st, done: rec?.stepsDone?.includes(st.id) ?? false }));
  return {
    id: occKey(s.id, date),
    title: over.title ?? s.title,
    notes: over.notes ?? s.notes,
    due: moved?.date ?? date,
    dueTime: moved ? moved.time : effTime(s, rec),
    important: over.important ?? s.important,
    tags: over.tags ?? s.tags,
    estimateMin: over.estimateMin ?? s.estimateMin,
    steps,
    template: s.template,
    recur: s.rule,
    area: over.area ?? s.area,
    focus: rec?.focus ?? false,
    status: rec?.status === "done" ? "done" : "open",
    createdAt: s.createdAt,
    completedAt: rec?.doneAt,
    countsFor: s.countsFor,
    sessionLogId: rec?.sessionLogId,
    sessions: rec?.sessions,
    remindAt: rec?.remindAt,
    alarmAck: rec?.alarmAck,
    snoozeCount: rec?.snoozeCount,
    hideUntil: rec?.hideUntil,
    lastCheckIn: rec?.lastCheckIn,
    seriesId: s.id,
    occDate: date,
  };
}

export interface Occ {
  /** seriesId@originalDate */
  key: string;
  seriesId: string;
  /** The original day. */
  date: ISODate;
  /** The day it is on now (differs after Reschedule). */
  on: ISODate;
  time?: string;
  /** "missed" = an older unresolved one that did not carry forward (only the latest does). */
  status: "open" | "done" | "skipped" | "missed";
  /** Open, from an earlier day, and the latest such: it carries into "Still to do". */
  carried: boolean;
  series: Series;
  record?: Occurrence;
  task: Task;
}

/**
 * Every occurrence whose day (after any Reschedule) falls in [start, end], with its state.
 *
 * Carry rule: of a series' unresolved occurrences before `today`, only the LATEST carries forward (status "open",
 * `carried`); older ones are "missed". So a daily vitamin missed three days running shows once.
 */
export function getOccurrences(data: AppData, start: ISODate, end: ISODate, today: ISODate = toISO(new Date())): Occ[] {
  const all = data.series ?? [];
  if (!all.length) return [];
  const ix = indexOf(data);
  const out: Occ[] = [];
  const scanFrom = start < addDays(today, -LOOKBACK_DAYS) ? start : addDays(today, -LOOKBACK_DAYS);
  const scanTo = end > addDays(today, -1) ? end : addDays(today, -1);

  for (const s of all) {
    if (s.off || s.startDate > scanTo) continue;
    const recs = ix.bySeries.get(s.id) ?? EMPTY;
    const dates = new Set(seriesDates(s, scanFrom, scanTo));
    // Records can add an occurrence the rule wouldn't give (an "extra"), keep history visible, or bring one in from elsewhere.
    for (const r of recs) {
      const keep = r.extra || r.status === "done" || dates.has(r.date) || seriesHas(s, r.date);
      if (!keep) continue;
      if ((r.date >= scanFrom && r.date <= scanTo) || (r.movedTo && r.movedTo.date >= start && r.movedTo.date <= end)) dates.add(r.date);
    }
    const entries: Occ[] = [];
    for (const date of dates) {
      const rec = ix.byKey.get(occKey(s.id, date));
      const on = rec?.movedTo?.date ?? date;
      const status: Occ["status"] = rec?.status === "done" ? "done" : rec?.status === "skipped" ? "skipped" : rec?.status === "missed" ? "missed" : "open";
      const task = occTask(s, date, rec);
      entries.push({ key: occKey(s.id, date), seriesId: s.id, date, on, time: task.dueTime, status, carried: false, series: s, record: rec, task });
    }
    const pastOpen = entries.filter((e) => e.status === "open" && e.on < today).sort((a, b) => a.on.localeCompare(b.on) || a.date.localeCompare(b.date));
    // Life admin rolls forward ONCE: yesterday's missed one is still to do today, an older one is dropped (and logged as missed).
    const oldest = s.lifeId ? addDays(today, -1) : "";
    pastOpen.forEach((e, i) => {
      if (e.on < oldest) e.status = "missed";
      else if (i === pastOpen.length - 1) e.carried = true;
      else e.status = "missed";
    });
    for (const e of entries) if (e.on >= start && e.on <= end) out.push(e);
  }
  return out.sort((a, b) => a.on.localeCompare(b.on) || (a.time ?? "").localeCompare(b.time ?? "") || a.key.localeCompare(b.key));
}

/** The open or done occurrences in a window, as tasks. */
export function occurrenceTasks(data: AppData, start: ISODate, end: ISODate, today: ISODate): Task[] {
  return getOccurrences(data, start, end, today)
    .filter((o) => o.status === "open" || o.status === "done")
    .map((o) => o.task);
}

const expandedCache = new WeakMap<AppData, Map<string, AppData>>();

/**
 * `data` with the repeats of [from, to] added to `tasks`, so the timeline, planner and notifications (which read
 * `tasks`) see them. Cached, and idempotent: data that was already expanded over the window comes back unchanged.
 */
export function withOccurrences(data: AppData, from: ISODate, to: ISODate, today: ISODate): AppData {
  if (!data.series?.length) return data;
  if (data.expanded && data.expanded.from <= from && data.expanded.to >= to) return data;
  const key = `${from}|${to}|${today}`;
  let m = expandedCache.get(data);
  if (!m) expandedCache.set(data, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const base = data.expanded ? { ...data, tasks: data.tasks.filter((t) => !t.seriesId) } : data;
  const out: AppData = { ...base, tasks: [...base.tasks, ...occurrenceTasks(base, from, to, today)], expanded: { from, to } };
  m.set(key, out);
  return out;
}

/** The usual window for code that needs "the tasks": 60 days back (the carry-over lookback) to 3 weeks ahead. */
export const withRepeats = (data: AppData, today: ISODate): AppData => withOccurrences(data, addDays(today, -LOOKBACK_DAYS), addDays(today, 21), today);

/** The window the timeline of `date` needs: its whole week (the session planner works weekly), plus the carry-over lookback for today. */
export function windowFor(date: ISODate, today: ISODate): { from: ISODate; to: ISODate } {
  const monday = addDays(date, -mod(dowOf(date) + 6, 7));
  const from = date === today ? addDays(today, -LOOKBACK_DAYS) : monday;
  return { from: from < monday ? from : monday, to: addDays(monday, 6) };
}

/** A task by id: an ordinary task, or an occurrence (seriesId@date) of a repeating one. */
export function findTask(data: AppData, id: string): Task | undefined {
  const t = data.tasks.find((x) => x.id === id);
  if (t) return t;
  const o = parseOccKey(id);
  if (!o) return undefined;
  const s = (data.series ?? []).find((x) => x.id === o.seriesId);
  if (!s) return undefined;
  const rec = recordOf(data, id);
  if (!rec && !seriesHas(s, o.date)) return undefined;
  return occTask(s, o.date, rec);
}

export const seriesOf = (data: AppData, id: string): Series | undefined => {
  const o = parseOccKey(id);
  return o ? (data.series ?? []).find((s) => s.id === o.seriesId) : undefined;
};

// ---- Changing one occurrence -----------------------------------------------------------------------------------------

const sameSteps = (a: Step[], b: Step[]) => a.length === b.length && a.every((s, i) => s.id === b[i].id && s.title === b[i].title && s.estimateMin === b[i].estimateMin);
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A record with nothing in it that differs from the series is not kept. */
function meaningful(r: Occurrence): boolean {
  return !!(
    r.status || r.movedTo || r.time !== undefined || r.extra || (r.over && Object.keys(r.over).length) || r.stepsDone?.length || r.sessions?.length || r.sessionLogId ||
    r.remindAt || r.alarmAck || r.snoozeCount || r.hideUntil || r.focus || r.lastCheckIn
  );
}

function upsert(d: AppData, rec: Occurrence): AppData {
  const rest = (d.occurrences ?? []).filter((r) => r.key !== rec.key);
  return { ...d, occurrences: meaningful(rec) ? [...rest, rec] : rest };
}

/**
 * Applies the difference between an occurrence's task view before (`prev`) and after (`next`) to its record. This is how
 * every existing task action (done, set a time, steps, snooze…) keeps working on repeats: it changes THIS occurrence only.
 */
export function applyOccTask(d: AppData, id: string, prev: Task, next: Task): AppData {
  const o = parseOccKey(id);
  const s = o && (d.series ?? []).find((x) => x.id === o.seriesId);
  if (!o || !s) return d;
  const r: Occurrence = { ...(recordOf(d, id) ?? { key: id, seriesId: s.id, date: o.date }) };

  if (next.due !== prev.due || next.dueTime !== prev.dueTime) {
    const due = next.due ?? prev.due ?? o.date;
    if (due !== o.date) {
      r.movedTo = { date: due, time: next.dueTime };
      delete r.time;
    } else {
      delete r.movedTo;
      if ((next.dueTime ?? "") !== (s.time ?? "")) r.time = next.dueTime ?? "";
      else delete r.time;
    }
  }
  if (next.status !== prev.status || next.completedAt !== prev.completedAt) {
    if (next.status === "done") {
      r.status = "done";
      r.doneAt = next.completedAt ?? Date.now();
    } else {
      if (r.status === "done") delete r.status;
      delete r.doneAt;
    }
  }
  const over = { ...(r.over ?? {}) } as Record<string, unknown>;
  const series = s as unknown as Record<string, unknown>;
  for (const k of ["title", "notes", "estimateMin", "area", "tags", "important"] as const) {
    if (!eq(next[k], prev[k])) {
      if (eq(next[k], series[k])) delete over[k];
      else over[k] = next[k];
    }
  }
  if (sameSteps(next.steps, s.steps)) {
    delete over.steps;
    const ids = next.steps.filter((x) => x.done).map((x) => x.id);
    if (ids.length) r.stepsDone = ids;
    else delete r.stepsDone;
  } else {
    over.steps = next.steps;
    delete r.stepsDone;
  }
  r.over = Object.keys(over).length ? (over as Occurrence["over"]) : undefined;
  if (!r.over) delete r.over;
  const copy = <K extends "sessions" | "sessionLogId" | "remindAt" | "alarmAck" | "snoozeCount" | "hideUntil" | "focus" | "lastCheckIn">(k: K) => {
    if (!eq(next[k], prev[k])) {
      if (next[k] === undefined || next[k] === false) delete r[k];
      else (r as unknown as Record<string, unknown>)[k] = next[k];
    }
  };
  (["sessions", "sessionLogId", "remindAt", "alarmAck", "snoozeCount", "hideUntil", "focus", "lastCheckIn"] as const).forEach(copy);
  return upsert(d, r);
}

/** Done for this occurrence only. A series that counts as a session logs it. Returns null if it is already done. */
export function completeOcc(d: AppData, id: string, now: Date): AppData | null {
  const t = findTask(d, id);
  if (!t || t.status === "done") return null;
  let data = d;
  let sessionLogId: string | undefined;
  if (t.countsFor) {
    const r = addLog(d, t.countsFor, toISO(now), "manual", now);
    if (r) {
      data = r.data;
      sessionLogId = r.log.id;
    }
  }
  return applyOccTask(data, id, t, { ...t, status: "done", completedAt: now.getTime(), focus: false, sessionLogId });
}

export function reopenOcc(d: AppData, id: string): AppData | null {
  const t = findTask(d, id);
  if (!t || t.status !== "done") return null;
  const base = t.sessionLogId ? removeLog(d, t.sessionLogId) : d;
  return applyOccTask(base, id, t, { ...t, status: "open", completedAt: undefined, sessionLogId: undefined });
}

/** Skip this occurrence (it stays in the history as skipped; nothing carries forward). Pass false to bring it back. */
export function setOccSkipped(d: AppData, id: string, skipped: boolean): AppData {
  const o = parseOccKey(id);
  const s = o && (d.series ?? []).find((x) => x.id === o.seriesId);
  if (!o || !s) return d;
  const r: Occurrence = { ...(recordOf(d, id) ?? { key: id, seriesId: s.id, date: o.date }) };
  if (skipped) r.status = "skipped";
  else if (r.status === "skipped" || r.status === "missed") delete r.status;
  return upsert(d, r);
}

// ---- Changing the series -----------------------------------------------------------------------------------------------

export interface SeriesPatch {
  title?: string;
  notes?: string;
  /** null = no fixed time. */
  time?: string | null;
  estimateMin?: number;
  area?: string;
  tags?: string[];
  important?: boolean;
  steps?: Step[];
  /** null = stop repeating. */
  rule?: Recurrence | null;
}

const sameRule = (a: Recurrence, b: Recurrence) => eq({ ...a, weekdays: a.weekdays?.length ? [...a.weekdays].sort() : undefined }, { ...b, weekdays: b.weekdays?.length ? [...b.weekdays].sort() : undefined });

export function makeSeries(p: {
  id?: string;
  title: string;
  notes?: string;
  time?: string;
  estimateMin?: number;
  area?: string;
  tags?: string[];
  important?: boolean;
  steps?: Step[];
  template?: Series["template"];
  countsFor?: string;
  rule: Recurrence;
  from: ISODate;
  createdAt?: number;
}): Series {
  const startDate = firstOccurrence(p.rule, p.from);
  return {
    id: p.id ?? crypto.randomUUID(),
    title: p.title,
    notes: p.notes,
    time: p.time,
    estimateMin: p.estimateMin,
    area: p.area,
    tags: p.tags ?? [],
    important: !!p.important,
    steps: (p.steps ?? []).map((s) => ({ ...s, done: false })),
    template: p.template,
    countsFor: p.countsFor,
    rule: p.rule,
    startDate,
    anchor: startDate,
    createdAt: p.createdAt ?? Date.now(),
  };
}

/** Adds a series; the result's `first` is its first occurrence as a task. */
export function addSeries(d: AppData, s: Series): { data: AppData; first: Task } {
  return { data: { ...d, series: [...(d.series ?? []), s] }, first: occTask(s, s.startDate) };
}

/** A one-off task becomes the first occurrence of a new series (its id is kept as the series id). */
export function taskToSeries(d: AppData, taskId: string, rule: Recurrence, today: ISODate): { data: AppData; openId: string } | null {
  const t = d.tasks.find((x) => x.id === taskId);
  if (!t || t.status === "done") return null;
  const s = makeSeries({
    id: t.id,
    title: t.title,
    notes: t.notes,
    time: t.dueTime,
    estimateMin: t.estimateMin,
    area: t.area,
    tags: t.tags,
    important: t.important,
    steps: t.steps,
    template: t.template,
    countsFor: t.countsFor,
    rule,
    from: t.due ?? today,
    createdAt: t.createdAt,
  });
  const base = { ...d, tasks: d.tasks.filter((x) => x.id !== taskId) };
  let data: AppData = { ...base, series: [...(base.series ?? []), s] };
  const ticked = t.steps.filter((x) => x.done).map((x) => x.id);
  const first = occKey(s.id, s.startDate);
  if (ticked.length || t.focus) data = upsert(data, { key: first, seriesId: s.id, date: s.startDate, stepsDone: ticked.length ? ticked : undefined, focus: t.focus || undefined });
  return { data, openId: first };
}

/**
 * Edits a repeating task. "this" changes only that occurrence. "future" changes it and every later one (the series is
 * split: the old part ends the day before, history untouched). `rule: null` stops repeating: later occurrences and their
 * notifications go away, and this day's becomes an ordinary one-off task unless it is already done.
 */
export function editSeries(d: AppData, id: string, patch: SeriesPatch, scope: "this" | "future"): { data: AppData; openId: string } {
  const o = parseOccKey(id);
  const s = o && (d.series ?? []).find((x) => x.id === o.seriesId);
  if (!o || !s) return { data: d, openId: id };
  const cur = findTask(d, id)!;

  if (scope === "this") {
    const next: Task = { ...cur };
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.notes !== undefined) next.notes = patch.notes || undefined;
    if (patch.time !== undefined) next.dueTime = patch.time ?? undefined;
    if (patch.estimateMin !== undefined) next.estimateMin = patch.estimateMin || undefined;
    if (patch.area !== undefined) next.area = patch.area || undefined;
    if (patch.tags !== undefined) next.tags = patch.tags;
    if (patch.important !== undefined) next.important = patch.important;
    if (patch.steps !== undefined) next.steps = patch.steps;
    return { data: applyOccTask(d, id, cur, next), openId: id };
  }

  const date = o.date;
  const keepRecords = (list: Occurrence[], pred: (r: Occurrence) => boolean) => list.filter((r) => r.seriesId !== s.id || pred(r));

  if (patch.rule === null) {
    // Stop repeating: this and every later occurrence.
    const rec = recordOf(d, id);
    let data: AppData = {
      ...d,
      series: (d.series ?? []).map((x) => (x.id === s.id ? { ...x, until: addDays(date, -1) } : x)),
      // Later records go; done ones stay as history.
      occurrences: keepRecords(d.occurrences ?? [], (r) => r.date < date || r.status === "done"),
    };
    if (rec?.status !== "done" && cur.status === "open") {
      const one: Task = { ...cur, id: crypto.randomUUID(), recur: undefined, seriesId: undefined, occDate: undefined, due: cur.due, createdAt: cur.createdAt, steps: cur.steps.map((x) => ({ ...x, id: crypto.randomUUID() })) };
      data = { ...data, tasks: [one, ...data.tasks] };
      return { data: pruneEmpty(data, s.id), openId: one.id };
    }
    return { data: pruneEmpty(data, s.id), openId: id };
  }

  const apply = (base: Series): Series => ({
    ...base,
    title: patch.title ?? base.title,
    notes: patch.notes !== undefined ? patch.notes || undefined : base.notes,
    time: patch.time !== undefined ? (patch.time ?? undefined) : base.time,
    estimateMin: patch.estimateMin !== undefined ? patch.estimateMin || undefined : base.estimateMin,
    area: patch.area !== undefined ? patch.area || undefined : base.area,
    tags: patch.tags ?? base.tags,
    important: patch.important ?? base.important,
    steps: patch.steps ? patch.steps.map((x) => ({ ...x, done: false })) : base.steps,
    rule: patch.rule ?? base.rule,
  });
  const ruleChanged = !!patch.rule && !sameRule(patch.rule, s.rule);

  if (s.startDate >= date) {
    // The whole series from its very first day: change it in place.
    const next = apply(s);
    if (ruleChanged) next.anchor = date;
    const occurrences = (d.occurrences ?? []).map((r) => (r.seriesId === s.id && patch.time !== undefined && r.date >= date ? stripTime(r) : r));
    return { data: { ...d, series: (d.series ?? []).map((x) => (x.id === s.id ? next : x)), occurrences }, openId: id };
  }

  const fresh: Series = { ...apply(s), id: crypto.randomUUID(), startDate: date, anchor: ruleChanged ? date : seriesAnchor(s), until: s.until, createdAt: s.createdAt };
  const later = (r: Occurrence) => r.date >= date;
  const moved = (d.occurrences ?? []).filter((r) => r.seriesId === s.id && later(r)).map((r) => ({ ...(patch.time !== undefined ? stripTime(r) : r), seriesId: fresh.id, key: occKey(fresh.id, r.date) }));
  const data: AppData = {
    ...d,
    series: [...(d.series ?? []).map((x) => (x.id === s.id ? { ...x, until: addDays(date, -1) } : x)), fresh],
    occurrences: [...keepRecords(d.occurrences ?? [], (r) => !later(r)), ...moved],
  };
  return { data, openId: occKey(fresh.id, date) };
}

function stripTime(r: Occurrence): Occurrence {
  const { time, ...rest } = r;
  void time;
  return rest;
}

/** A series that now has no days and no history is removed. */
function pruneEmpty(d: AppData, seriesId: string): AppData {
  const s = (d.series ?? []).find((x) => x.id === seriesId);
  if (!s || !s.until || s.until >= s.startDate) return d;
  if ((d.occurrences ?? []).some((r) => r.seriesId === seriesId)) return d;
  return { ...d, series: (d.series ?? []).filter((x) => x.id !== seriesId) };
}

/**
 * Edits the whole series in place (Settings → Repeating tasks): title, time, steps… and the rule. Done / skipped records stay.
 */
export function updateSeriesWhole(d: AppData, seriesId: string, patch: SeriesPatch): AppData {
  const s = (d.series ?? []).find((x) => x.id === seriesId);
  if (!s) return d;
  return editSeries(d, occKey(s.id, s.startDate), { ...patch, rule: patch.rule === null ? undefined : patch.rule }, "future").data;
}

/** Deletes the whole series and its records (the history log keeps what was done). */
export function deleteSeriesWhole(d: AppData, seriesId: string): AppData {
  return { ...d, series: (d.series ?? []).filter((s) => s.id !== seriesId), occurrences: (d.occurrences ?? []).filter((r) => r.seriesId !== seriesId) };
}

/** Deletes this and every later occurrence (history stays). */
export function endSeries(d: AppData, id: string): AppData {
  return editSeries(d, id, { rule: null }, "future").data;
}

export interface SeriesSnapshot {
  series: Series[];
  records: Occurrence[];
}
/** Everything stored about the series of this occurrence, so Undo can put it back exactly. */
export function snapshotOf(d: AppData, id: string): SeriesSnapshot {
  const o = parseOccKey(id);
  const sid = o?.seriesId;
  return { series: (d.series ?? []).filter((s) => s.id === sid), records: (d.occurrences ?? []).filter((r) => r.seriesId === sid) };
}
export function restoreSnapshot(d: AppData, snap: SeriesSnapshot): AppData {
  const sid = new Set(snap.series.map((s) => s.id));
  return {
    ...d,
    series: [...(d.series ?? []).filter((s) => !sid.has(s.id)), ...snap.series],
    occurrences: [...(d.occurrences ?? []).filter((r) => !sid.has(r.seriesId)), ...snap.records],
  };
}

// ---- Housekeeping --------------------------------------------------------------------------------------------------------

/**
 * Older unresolved occurrences become "missed" records (only the latest carries forward), and records that only held
 * short-lived state (an alarm seen, a snooze) are dropped once their day is well past. Returns the same object when there
 * is nothing to do.
 */
export function sweepMissed(d: AppData, today: ISODate): AppData {
  if (!d.series?.length) return d;
  const from = addDays(today, -LOOKBACK_DAYS);
  const to = addDays(today, -1);
  let data = d;
  const marks: Occurrence[] = [];
  for (const o of getOccurrences(d, from, to, today)) {
    if (o.status === "missed" && o.record?.status !== "missed") marks.push({ ...(o.record ?? { key: o.key, seriesId: o.seriesId, date: o.date }), status: "missed" });
  }
  if (marks.length) {
    const keys = new Set(marks.map((m) => m.key));
    data = { ...data, occurrences: [...(data.occurrences ?? []).filter((r) => !keys.has(r.key)), ...marks] };
  }
  const old = addDays(today, -3);
  const kept = (data.occurrences ?? []).filter((r) => !(r.date < old && !r.status && !r.movedTo && !r.time && !r.extra && !r.over && !r.sessions?.length && !r.stepsDone?.length && !r.sessionLogId));
  if (kept.length !== (data.occurrences ?? []).length) data = { ...data, occurrences: kept };
  return data;
}

// ---- Migration: old "finishing it creates the next one" tasks → series ------------------------------------------------------

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Converts tasks that had a `recur` (and the copies the old model generated) into series + records. Lossless: every copy
 * keeps its title, time, done state and steps as an occurrence; nothing is duplicated. Idempotent: afterwards no task has
 * `recur`, so running it again changes nothing.
 */
export function upgradeRecurring(d: AppData): AppData {
  const repeating = d.tasks.filter((t) => t.recur);
  if (!repeating.length) return d;

  const groups = new Map<string, Task[]>();
  for (const t of repeating) {
    const k = [norm(t.title), JSON.stringify(t.recur), t.dueTime ?? "", t.area ?? ""].join("|");
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }

  const series = [...(d.series ?? [])];
  const records = [...(d.occurrences ?? [])];
  const remap = new Map<string, string>();
  const stamp = (t: Task) => toISO(new Date(t.createdAt));

  for (const members of groups.values()) {
    const opens = members.filter((t) => t.status === "open").sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.createdAt - b.createdAt);
    const dones = members.filter((t) => t.status === "done").sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
    const head = opens[0] ?? dones[dones.length - 1];
    const rule = head.recur!;
    const dateOf = (t: Task) => t.due ?? stamp(t);
    const startDate = members.map(dateOf).sort()[0];
    const anchor = opens[0] ? dateOf(opens[0]) : startDate;
    const s: Series = {
      id: head.id,
      title: head.title,
      notes: head.notes,
      time: head.dueTime,
      estimateMin: head.estimateMin,
      area: head.area,
      tags: head.tags,
      important: head.important,
      steps: head.steps.map((x) => ({ ...x, done: false })),
      template: head.template,
      countsFor: head.countsFor,
      rule,
      startDate,
      anchor,
      createdAt: Math.min(...members.map((t) => t.createdAt)),
    };
    series.push(s);

    const seen = new Set<string>();
    for (const t of [...dones, ...opens]) {
      const date = dateOf(t);
      const key = occKey(s.id, date);
      if (seen.has(key)) continue;
      seen.add(key);
      const rec: Occurrence = { key, seriesId: s.id, date };
      if (!ruleHits(rule, anchor, date)) rec.extra = true;
      if ((t.dueTime ?? "") !== (s.time ?? "")) rec.time = t.dueTime ?? "";
      if (t.status === "done") {
        rec.status = "done";
        rec.doneAt = t.completedAt;
        rec.sessionLogId = t.sessionLogId;
      } else {
        remap.set(t.id, key);
        if (t.remindAt) rec.remindAt = t.remindAt;
        if (t.alarmAck) rec.alarmAck = t.alarmAck;
        if (t.snoozeCount) rec.snoozeCount = t.snoozeCount;
        if (t.focus) rec.focus = true;
        if (t.lastCheckIn) rec.lastCheckIn = t.lastCheckIn;
      }
      if (t.sessions?.length) rec.sessions = t.sessions;
      const doneTitles = new Set(t.steps.filter((x) => x.done).map((x) => norm(x.title)));
      const ticked = s.steps.filter((x) => doneTitles.has(norm(x.title))).map((x) => x.id);
      if (ticked.length) rec.stepsDone = ticked;
      if (norm(t.title) !== norm(s.title)) rec.over = { title: t.title };
      if (meaningful(rec)) records.push(rec);
    }
  }

  const gone = new Set(repeating.map((t) => t.id));
  const timer = d.settings.timer;
  const timerTask = timer?.taskId && remap.get(timer.taskId);
  return {
    ...d,
    tasks: d.tasks.filter((t) => !gone.has(t.id)),
    series,
    occurrences: records,
    settings: timerTask ? { ...d.settings, timer: { ...timer!, taskId: timerTask } } : d.settings,
  };
}
