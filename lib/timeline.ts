import { billsOnDay } from "./bills";
import { dayRules, planningBusy, timedDuration, type DayRules, type Span } from "./busy";
import { addDays, fromISO, toISO } from "./dates";
import { nextStep, remainingMinutes } from "./estimate";
import { eventSpan, eventsOn } from "./fixed";
import { toHHMM, toMin, withDefaults } from "./profile";
import { priorityScore } from "./rescue";
import { plannedForDay } from "./schedule";
import { choreKey, entryFor } from "./sessions";
import { buildDurationModel } from "./stats";
import type { AppData, ISODate, Task } from "./types";

/**
 * The day, as ONE chronological timeline.
 *
 *   fixed  : events (yours and the phone's calendar), tasks with their own time, commute, lunch, the tea break
 *   flexible: sessions, chores, bills, and tasks with no time. They are placed into the best free gap.
 *
 * Rules (see lib/busy.ts): no overlaps with a buffer between items, a protected tea/food break on weekdays, an evening
 * capped at about 2.5 hours (lighter on office days), a real commute on office days. Anything overdue is placed first
 * and marked "carried over". What can't fit in the evening comes back in `overflow` (see lib/settle.ts).
 *
 * Pure: the same data always gives the same timeline, so adding "fill form at 3pm" simply re-runs it, and the diff
 * between before and after is the "Moved Power BI to 18:30 to fit your form." note.
 */
export type ItemKind = "event" | "calendar" | "task" | "session" | "chore" | "bill" | "break" | "commute";

export interface TLItem {
  /** Stable across rebuilds: "task:<id>", "session:<areaId>", "chore:<id>", "bill:<id>:<offset>", "event:<id>"… */
  key: string;
  kind: ItemKind;
  title: string;
  emoji?: string;
  /** Minutes after midnight. */
  start: number;
  end: number;
  allDay?: boolean;
  /** Decided by the clock or by you: never moved. */
  fixed: boolean;
  done: boolean;
  skipped: boolean;
  /** Overdue from an earlier day. */
  carried?: boolean;
  /** Its planned time has passed and it isn't done. */
  late?: boolean;
  /** Only a first chunk of a long task was placed. */
  partial?: boolean;
  /** Breaks and commute: shown quietly, nothing to do. */
  muted?: boolean;
  taskId?: string;
  areaId?: string;
  /** Session / chore / bill identity for Done, Skip, Snooze. */
  sessionKey?: string;
  /** A finished session: which log it is, so Undo / Remove takes back exactly this one. */
  logId?: string;
  eventId?: string;
  choreId?: string;
  bill?: { id: string; due: ISODate; key: string; offset: number; label: string };
  /** Calendar event read from the phone. */
  fromCalendar?: boolean;
}

export interface Timeline {
  date: ISODate;
  rules: DayRules;
  items: TLItem[];
  /** Tasks that didn't fit today (the evening is full). Carried ones are flagged. */
  overflow: Array<{ task: Task; carried: boolean }>;
  /** Pairs of fixed items that overlap each other (two things you booked at once). */
  clashes: Array<[TLItem, TLItem]>;
  /** Counts for "Today: 5 of 6 done". */
  summary: { done: number; total: number };
}

const ceil5 = (n: number) => Math.ceil(n / 5) * 5;
const MAX_BLOCK = 90;
/** Minutes past the evening cap that overdue / important tasks may still use. */
const CARRIED_EXTRA = 45;
const IMPORTANT_EXTRA = 20;
/** Quick tasks (15 min or less) may slip a little past the cap: a short call shouldn't wait a week for room. */
const QUICK_EXTRA = 20;
const DEFAULT_CHORE_MIN = 20;
const DEFAULT_BILL_MIN = 10;
const RHYTHM_CHORE_MIN = 15;
const GROCERY_RUN_MIN = 60;

/** Free stretches of `win` once `blocked` is taken out. */
function freeWithin(win: Span, blocked: Span[]): Span[] {
  let free: Span[] = [win];
  for (const [bs, be] of blocked) {
    free = free.flatMap(([s, e]) => (be <= s || bs >= e ? [[s, e] as Span] : [[s, Math.min(e, bs)] as Span, [Math.max(s, be), e] as Span]));
  }
  return free.filter(([s, e]) => e - s > 0);
}

/** How long a task takes as a block: its remaining estimate, capped; a long task gets its next step. */
export function taskBlock(t: Task, model: ReturnType<typeof buildDurationModel>): { minutes: number; partial: boolean } {
  const rem = Math.max(10, ceil5(remainingMinutes(t, model).minutes));
  if (rem <= MAX_BLOCK) return { minutes: rem, partial: false };
  const step = nextStep(t);
  return { minutes: Math.min(MAX_BLOCK, Math.max(15, ceil5(step?.estimateMin ?? 60))), partial: true };
}

export function buildTimeline(data: AppData, date: ISODate, now: Date = new Date()): Timeline {
  const p = withDefaults(data.profile);
  const r = dayRules(data, date);
  const todayIso = toISO(now);
  const isToday = date === todayIso;
  const isPast = date < todayIso;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const earliest = isToday ? ceil5(nowMin + 5) : 0;
  const model = buildDurationModel(data.tasks);
  const buffer = r.buffer;

  const items: TLItem[] = [];
  /** Space already taken (items padded with the buffer; breaks and commute as they are). */
  const blocked: Span[] = [];
  const take = (s: Span, pad = buffer) => blocked.push([Math.max(0, s[0] - pad), Math.min(1440, s[1] + pad)]);
  let eveningLoad = 0;
  const countEvening = (s: number, e: number) => {
    eveningLoad += Math.max(0, e - Math.max(s, r.eveningStart));
  };

  // ---- 1. Fixed: breaks, commute, events, timed tasks ---------------------------------------------------
  if (r.commuteTo) {
    items.push({ key: "commute:to", kind: "commute", title: "Commute to the office", emoji: "🚌", start: r.commuteTo[0], end: r.commuteTo[1], fixed: true, done: false, skipped: false, muted: true });
    take(r.commuteTo, 0);
  }
  if (r.commuteFrom) {
    items.push({ key: "commute:from", kind: "commute", title: "Commute home", emoji: "🚌", start: r.commuteFrom[0], end: r.commuteFrom[1], fixed: true, done: false, skipped: false, muted: true });
    take(r.commuteFrom, 0);
  }
  if (r.lunch) {
    items.push({ key: "break:lunch", kind: "break", title: "Lunch", emoji: "🍽️", start: r.lunch[0], end: r.lunch[1], fixed: true, done: false, skipped: false, muted: true });
    take(r.lunch, 0);
  }
  if (r.tea) {
    items.push({ key: "break:tea", kind: "break", title: "Tea & food break", emoji: "🍵", start: r.tea[0], end: r.tea[1], fixed: true, done: false, skipped: false, muted: true });
    take(r.tea, 0);
  }

  for (const e of eventsOn(data, date)) {
    const base = {
      key: `event:${e.id}`,
      kind: (e.source === "calendar" ? "calendar" : "event") as ItemKind,
      title: e.title,
      emoji: e.source === "calendar" ? "🗓️" : "📌",
      fixed: true,
      done: false,
      skipped: false,
      eventId: e.id,
      fromCalendar: e.source === "calendar",
    };
    if (!e.start) {
      items.push({ ...base, start: 0, end: 0, allDay: true });
      continue;
    }
    const [s, end] = eventSpan(e);
    items.push({ ...base, start: s, end });
    take([s, end]);
    if (!isPast) countEvening(s, end);
  }

  const timed = data.tasks.filter((t) => t.due === date && !!t.dueTime && (t.status === "open" || (t.completedAt && toISO(new Date(t.completedAt)) === date)));
  for (const t of timed) {
    const s = toMin(t.dueTime!);
    const e = s + timedDuration(t);
    const done = t.status === "done";
    items.push({ key: `task:${t.id}`, kind: "task", title: t.title, start: s, end: e, fixed: true, done, skipped: false, taskId: t.id, areaId: t.area });
    if (!done) {
      take([s, e]);
      countEvening(s, e);
    }
  }

  // ---- 2. Sessions (the weekly planner decides the day; their times respect the same rules) -------------
  const busy = planningBusy(data);
  const sessions = plannedForDay(data, date, busy);
  const snoozedSessions: typeof sessions = [];
  for (const s of sessions) {
    const area = p.areas.find((a) => a.id === s.areaId);
    const entry = entryFor(data.log, s.key);
    const skipped = entry?.status === "skip";
    // "Snooze" on a session: it comes back later today (placed below), not at its original time.
    if (isToday && !s.done && entry?.status === "snooze" && entry.until && entry.until > now.getTime()) {
      snoozedSessions.push(s);
      continue;
    }
    items.push({ key: s.extra ? s.key : `session:${s.areaId}`, kind: "session", title: s.title, emoji: area?.emoji, start: s.start, end: s.end, fixed: false, done: s.done, skipped, areaId: s.areaId, sessionKey: s.key.replace(/#.*$/, ""), logId: s.logId });
    if (!s.done && !skipped) take([s.start, s.end]);
    if (!skipped) countEvening(s.start, s.end);
  }

  // ---- window helpers for placing flexible items ----------------------------------------------------------
  type Win = { span: Span; evening: boolean; work?: boolean };
  const wins = (opts: { work: boolean }): Win[] => {
    const out: Win[] = [];
    if (r.workDay && r.work) {
      if (opts.work) out.push({ span: r.work, evening: false, work: true });
      out.push({ span: [r.dayStart, Math.min(r.commuteTo?.[0] ?? r.work[0], r.work[0])], evening: false });
      out.push({ span: [Math.max(r.eveningStart, r.commuteFrom?.[1] ?? 0, r.work[1]), r.dayEnd], evening: true });
    } else {
      out.push({ span: [Math.max(r.dayStart, 9 * 60), r.eveningStart], evening: false });
      out.push({ span: [r.eveningStart, r.dayEnd], evening: true });
    }
    return out.filter((w) => w.span[1] > w.span[0]);
  };

  /**
   * The earliest free spot of `minutes` at or after `from` in these windows (first window first).
   * `capped`: respect the evening cap. Returns null if nothing fits.
   */
  const findSpot = (minutes: number, windows: Win[], from: number, capped: boolean, capExtra = 0): number | null => {
    for (const w of windows) {
      if (capped && w.evening && eveningLoad + minutes > r.eveningCap + capExtra) continue;
      for (const [a, b] of freeWithin(w.span, blocked)) {
        const start = ceil5(Math.max(a, from, earliest));
        if (start + minutes <= b) return start;
      }
    }
    return null;
  };
  /** The latest free spot at or before `pref` (no more than 3 hours earlier): the nearest alternative to a preferred time. */
  const spotBefore = (minutes: number, windows: Win[], pref: number, capped = false): number | null => {
    let best: number | null = null;
    for (const w of windows) {
      if (capped && w.evening && eveningLoad + minutes > r.eveningCap) continue;
      for (const [a, b] of freeWithin(w.span, blocked)) {
        const start = Math.floor(Math.min(pref, b - minutes) / 5) * 5;
        if (start >= Math.max(a, earliest, pref - 180) && start + minutes <= b && (best == null || start > best)) best = start;
      }
    }
    return best;
  };
  const place = (item: TLItem, pad = buffer) => {
    items.push(item);
    take([item.start, item.end], pad);
    countEvening(item.start, item.end);
  };

  for (const s of snoozedSessions) {
    const until = entryFor(data.log, s.key)!.until!;
    const from = new Date(until).getHours() * 60 + new Date(until).getMinutes();
    const minutes = s.end - s.start;
    const spot = findSpot(minutes, wins({ work: false }), from, false);
    // No room left today: it simply drops off today's list and the week re-plans around it.
    if (spot == null) continue;
    const area = p.areas.find((a) => a.id === s.areaId);
    place({ key: `session:${s.areaId}`, kind: "session", title: s.title, emoji: area?.emoji, start: spot, end: spot + minutes, fixed: false, done: false, skipped: false, areaId: s.areaId, sessionKey: s.key });
  }

  // ---- 3. Bills and chores: they have a time they'd like -------------------------------------------------
  const logEntry = (key: string) => entryFor(data.log, key);
  const placeFlexible = (build: (start: number) => TLItem, minutes: number, pref: number, done: boolean, skipped: boolean, mustPlace = true) => {
    if (done || skipped || isPast) {
      // Finished or skipped items sit at their preferred time and take no space.
      items.push(build(pref));
      return;
    }
    const nonWork = wins({ work: false });
    if (!mustPlace) {
      // A chore respects the evening limit like everything else: no room today means it simply waits (it stays due).
      const at = findSpot(minutes, nonWork, pref, true) ?? spotBefore(minutes, nonWork, pref, true);
      if (at != null) place(build(at));
      return;
    }
    // If the evening is packed, a bill may run a little later, but never past the point you go quiet.
    const late: Win[] = [{ span: [r.dayStart, Math.max(r.dayEnd, toMin(p.quietStart) - 15)], evening: false }];
    const any: Win[] = [{ span: [0, 1440], evening: false }];
    // Nearest to the time it likes: just after it, else just before it, else a late slot, else anywhere at all.
    const start =
      findSpot(minutes, nonWork, pref, false) ?? spotBefore(minutes, nonWork, pref) ?? findSpot(minutes, late, pref, false) ?? findSpot(minutes, late, 0, false) ?? findSpot(minutes, any, 0, false);
    if (start == null) return;
    place(build(start));
  };

  for (const b of billsOnDay(data, date, todayIso)) {
    const minutes = b.bill.groceries ? GROCERY_RUN_MIN : b.bill.kind === "chore" ? DEFAULT_CHORE_MIN : DEFAULT_BILL_MIN;
    const key = `bill:${b.bill.id}:${b.offset}`;
    placeFlexible(
      (start) => ({ key, kind: "bill", title: b.bill.name, emoji: b.bill.kind === "chore" ? "🧹" : "💳", start, end: start + minutes, fixed: false, done: false, skipped: logEntry(b.key)?.status === "skip", bill: { id: b.bill.id, due: b.due, key: b.key, offset: b.offset, label: b.label } }),
      minutes,
      toMin(b.bill.time),
      false,
      logEntry(b.key)?.status === "skip",
      b.bill.kind === "bill",
    );
  }
  // Bills / chores finished today stay on the list as ticked rows.
  for (const b of data.bills ?? []) {
    if (!b.enabled || b.autopay || b.lastDone !== date) continue;
    if (items.some((x) => x.kind === "bill" && x.bill?.id === b.id)) continue;
    const t = toMin(b.time);
    items.push({ key: `bill:${b.id}:done`, kind: "bill", title: b.name, emoji: b.kind === "chore" ? "🧹" : "💳", start: t, end: t + DEFAULT_BILL_MIN, fixed: false, done: true, skipped: false, bill: { id: b.id, due: date, key: `bill:${b.id}:${date}`, offset: 0, label: "Done" } });
  }
  if (!r.off) {
    for (const c of p.rhythm) {
      if (!c.enabled || c.kind !== "chore" || !c.days.includes(r.dow)) continue;
      const e = logEntry(choreKey(c.id, date));
      const done = e?.status === "done";
      const skipped = e?.status === "skip";
      placeFlexible(
        (start) => ({ key: `chore:${c.id}`, kind: "chore", title: c.label, emoji: "✉️", start, end: start + RHYTHM_CHORE_MIN, fixed: false, done, skipped, choreId: c.id }),
        RHYTHM_CHORE_MIN,
        toMin(c.time),
        done,
        skipped,
        false,
      );
    }
  }

  // ---- 4. Tasks: carried-over first, then today's, each into the best free gap ------------------------------
  const overflow: Timeline["overflow"] = [];
  const isWorkTask = (t: Task) => !!t.area && !!p.areas.find((a) => a.id === t.area)?.isWork;

  const doneUntimed = data.tasks.filter((t) => t.status === "done" && !t.dueTime && t.completedAt && toISO(new Date(t.completedAt)) === date);
  for (const t of doneUntimed) {
    const at = new Date(t.completedAt!);
    const end = at.getHours() * 60 + at.getMinutes();
    items.push({ key: `task:${t.id}`, kind: "task", title: t.title, start: Math.max(0, end - 10), end, fixed: true, done: true, skipped: false, taskId: t.id, areaId: t.area });
  }

  if (!isPast) {
    const open = data.tasks.filter((t) => t.status === "open");
    const carried = isToday ? open.filter((t) => t.due != null && t.due < date) : [];
    const todays = open.filter((t) => t.due === date && !t.dueTime);
    const order = (a: Task, b: Task) => priorityScore(b, date) - priorityScore(a, date) || a.createdAt - b.createdAt;
    const queue = [...carried.sort(order).map((t) => ({ t, carried: true })), ...todays.sort(order).map((t) => ({ t, carried: false }))];

    for (const { t, carried: isCarried } of queue) {
      // Parked by "Adjust my day": it waits until that day.
      if (t.hideUntil && t.hideUntil > date) continue;
      const { minutes, partial } = taskBlock(t, model);
      const windows = wins({ work: isWorkTask(t) });
      // A snoozed task ("in an hour") doesn't start before then.
      const notBefore = isToday && t.remindAt && t.remindAt > now.getTime() && toISO(new Date(t.remindAt)) === date ? new Date(t.remindAt).getHours() * 60 + new Date(t.remindAt).getMinutes() : 0;
      const sizes = [minutes, ...[60, 45, 30, 20].filter((m) => m < minutes && minutes >= 30)];
      let placedAt: number | null = null;
      let used = minutes;
      let cut = false;
      for (const m of sizes) {
        // Overdue things may use a little of the evening beyond the cap: carried-over work must not pile up.
        placedAt = findSpot(m, windows, notBefore, true, isCarried ? CARRIED_EXTRA : t.important ? IMPORTANT_EXTRA : m <= 15 ? QUICK_EXTRA : 0);
        if (placedAt != null) {
          used = m;
          cut = m < minutes;
          break;
        }
      }
      if (placedAt == null) {
        overflow.push({ task: t, carried: isCarried });
        continue;
      }
      place({ key: `task:${t.id}`, kind: "task", title: t.title, start: placedAt, end: placedAt + used, fixed: false, done: false, skipped: false, carried: isCarried || undefined, partial: partial || cut || undefined, taskId: t.id, areaId: t.area });
    }
  }

  // ---- 5. Tidy up ------------------------------------------------------------------------------------------
  items.sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start - b.start || Number(b.fixed) - Number(a.fixed) || a.end - b.end);
  if (isToday) {
    for (const it of items) if (!it.done && !it.skipped && !it.muted && !it.allDay && it.end <= nowMin && (it.fixed || it.kind === "session")) it.late = true;
  }

  const live = items.filter((x) => x.fixed && !x.done && !x.skipped && !x.muted && !x.allDay);
  const clashes: Timeline["clashes"] = [];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) if (live[i].start < live[j].end && live[j].start < live[i].end) clashes.push([live[i], live[j]]);

  const counted = items.filter((x) => (x.kind === "task" || x.kind === "session" || x.kind === "chore" || x.kind === "bill") && !x.skipped);
  const summary = { done: counted.filter((x) => x.done).length, total: counted.length + overflow.length };
  return { date, rules: r, items, overflow, clashes, summary };
}

/** Items you can act on (not breaks, commute or all-day banners). */
export const actionable = (it: TLItem) => !it.muted && !it.allDay;

/**
 * "Next up": what's happening now, else the next thing ahead, else something you missed earlier.
 * Events count (so you see what's coming) but only things you can act on can be "Next up".
 */
export function nextUp(tl: Timeline, nowMin: number): TLItem | null {
  const open = tl.items.filter((x) => actionable(x) && !x.done && !x.skipped);
  const current = open.find((x) => x.start <= nowMin && nowMin < x.end);
  if (current) return current;
  const ahead = open.find((x) => x.start > nowMin);
  if (ahead) return ahead;
  return open.find((x) => x.end <= nowMin) ?? null;
}

/** The identity of an item across rebuilds. */
export const itemKey = (it: TLItem) => it.key;

/**
 * One line about what had to move when something was added: "Moved Power BI to 18:30 to fit your form."
 * `before` and `after` are the same day's timelines. Only flexible items that were already there count.
 */
export function movedNote(before: Timeline, after: Timeline, addedTitle?: string): string | null {
  const was = new Map(before.items.filter((x) => !x.fixed && !x.done).map((x) => [x.key, x]));
  const moved = after.items.filter((x) => {
    const old = was.get(x.key);
    return !!old && !x.fixed && !x.done && old.start !== x.start;
  });
  const sendOff = before.items.filter((x) => !x.fixed && !x.done && x.kind !== "bill" && !after.items.some((y) => y.key === x.key));
  const label = (t: string) => t.replace(/ · session \d+$| session \d+$/, "");
  const fit = addedTitle ? ` to fit “${addedTitle.length > 28 ? addedTitle.slice(0, 27) + "…" : addedTitle}”` : "";
  if (moved.length) {
    const first = moved[0];
    const more = moved.length > 1 ? ` (and ${moved.length - 1} more)` : "";
    return `Moved ${label(first.title)} to ${toHHMM(first.start)}${fit}${more}.`;
  }
  if (sendOff.length) return `${label(sendOff[0].title)} moves to another day${fit}.`;
  return null;
}

/** Whether it's night: from `sleepStart` until `wakeTime`. */
export function isNight(now: Date, p: { sleepStart: string; wakeTime: string }): boolean {
  const m = now.getHours() * 60 + now.getMinutes();
  const sleep = toMin(p.sleepStart);
  const wake = toMin(p.wakeTime);
  if (sleep === wake) return false;
  return sleep > wake ? m >= sleep || m < wake : m >= sleep && m < wake;
}

/** What tomorrow starts with (or today, if it's after midnight and you're still up): the first thing to do. */
export function firstThing(data: AppData, now: Date): { item: TLItem | null; date: ISODate; isTomorrow: boolean } {
  const p = withDefaults(data.profile);
  const m = now.getHours() * 60 + now.getMinutes();
  const afterMidnight = m < toMin(p.wakeTime) && toMin(p.sleepStart) > toMin(p.wakeTime);
  const date = afterMidnight ? toISO(now) : addDays(toISO(now), 1);
  const startOfDay = fromISO(date);
  const tl = buildTimeline(data, date, startOfDay);
  const item = tl.items.find((x) => actionable(x) && !x.done && !x.skipped && x.kind !== "calendar") ?? tl.items.find((x) => actionable(x) && !x.done && !x.skipped) ?? null;
  return { item, date, isTomorrow: !afterMidnight };
}
