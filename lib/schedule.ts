import { addDays, fromISO, toISO } from "./dates";
import { dayRules, fixedSpans, LATEST_END, overlapMinutes, planningBusy } from "./busy";
import { learnedSlots, orderSlots } from "./capacity";
import { countedByEvent } from "./fixed";
import { isOffDay, OFF_DAY_MAX_MIN } from "./offday";
import { toMin, withDefaults } from "./profile";
import { entryFor, nextNumber, sessionKey, sessionTitle, variantFor } from "./sessions";
import { weekStart } from "./stats";
import { withOccurrences } from "./series";
import type { Area, AppData, ISODate, Slot } from "./types";

/**
 * The week planner. For every area with a weekly target it works out which days and times this
 * week's remaining sessions go, spreading them out instead of piling them on one day.
 *
 *  - Sessions flow into your time-of-day slots (Before work / Evening / Build time).
 *  - At most one session per area per day, weekends only for areas that allow them, weekends kept light.
 *  - Anything already done counts towards the target; skipped days are avoided.
 *  - `busy` lets fixed events block time: sessions that no longer fit move to the next free day.
 * Pure: the same data always gives the same plan, so it re-flows automatically whenever data changes.
 */
export interface PlannedSession {
  key: string;
  areaId: string;
  date: ISODate;
  slotId: string;
  /** Minutes after midnight. */
  start: number;
  end: number;
  minutes: number;
  /** The session counter this one will get: "Power BI session 14". */
  n: number;
  variant?: string;
  title: string;
  done: boolean;
  /** A finished session: which log it is (so Undo takes back exactly this one). */
  logId?: string;
  /** A finished session beyond the planned one for that day (a second walk, an extra). */
  extra?: boolean;
}

export type BusyFn = (date: ISODate) => Array<[number, number]>;

/** An area whose weekly target could not be fully placed: "Power BI: 2 of 4 fit this week". Never dropped silently. */
export interface Shortfall {
  areaId: string;
  name: string;
  target: number;
  /** Done + already pending as a task + planned. */
  fit: number;
}

/** The relaxed pass may stack a day this high (minutes of sessions) and put this many of one area in a day. */
const RELAXED_WEEKDAY_CAP = 270;
const RELAXED_WEEKEND_CAP = 160;
const RELAXED_PER_DAY = 2;
/** The relaxed pass may fill an evening this much past its cap (the normal pass already allows a tenth); beyond it, tasks would have no room at all. */
const RELAXED_EVENING = 1.3;

/** The evening cap is "about" 2.5 h: weekly sessions may run a tenth over so a normal day of them still fits. */
export const SESSION_CAP_SLACK = 1.1;
const WEEKDAY_CAP = 210; // minutes of sessions per day
const WEEKEND_CAP = 100; // weekends stay light
const isWeekend = (date: ISODate) => [0, 6].includes(fromISO(date).getDay());
/** Most minutes of sessions on a day: weekends stay light. */
export const SESSION_CAP = (date: ISODate) => (isWeekend(date) ? WEEKEND_CAP : WEEKDAY_CAP);

interface Item {
  area: Area;
  minutes: number;
  order: number;
  at?: number;
}

interface Placed extends Item {
  start: number;
  end: number;
}

/** Free stretches of a slot on a day, after the clock (today) and fixed events are taken out. */
function windows(slot: Slot, date: ISODate, earliest: number, busy: BusyFn, shift = 0): Array<[number, number]> {
  // A routine block that ran long (data.blocks) pushes the evening later: the slot moves with it, but never past ~22:30.
  const end = shift ? Math.min(toMin(slot.end) + shift, Math.max(LATEST_END, toMin(slot.end))) : toMin(slot.end);
  let ws: Array<[number, number]> = [[Math.max(toMin(slot.start) + shift, earliest), end]];
  for (const [bs, be] of busy(date)) {
    ws = ws.flatMap(([s, e]) => (be <= s || bs >= e ? [[s, e] as [number, number]] : [[s, Math.min(e, bs)] as [number, number], [Math.max(s, be), e] as [number, number]]));
  }
  return ws.filter(([s, e]) => e - s >= 5);
}

/** Lays items out in order inside the free windows. null if they don't all fit. */
function layout(items: Item[], wins: Array<[number, number]>, buffer: number): Placed[] | null {
  const sorted = [...items].sort((a, b) => a.order - b.order || (a.at ?? 0) - (b.at ?? 0));
  const cursors = wins.map(([s]) => s);
  const out: Placed[] = [];
  for (const it of sorted) {
    let placed = false;
    // First try the preferred start time (the walk at ~19:30), then simply the next free spot.
    for (const useAt of it.at != null ? [true, false] : [false]) {
      for (let w = 0; w < wins.length && !placed; w++) {
        const start = useAt ? Math.max(cursors[w], it.at!) : cursors[w];
        if (start + it.minutes <= wins[w][1]) {
          out.push({ ...it, start, end: start + it.minutes });
          cursors[w] = start + it.minutes + buffer;
          placed = true;
        }
      }
      if (placed) break;
    }
    if (!placed) return null;
  }
  return out;
}

export function planSessions(raw: AppData, now: Date = new Date(), busyOverride?: BusyFn): PlannedSession[] {
  return planWeek(raw, now, busyOverride).sessions;
}

/**
 * The week plan, and what did not fit. Weekly targets are a hard rule: after the normal pass every area that is still short
 * gets its sessions in ANY free time left in the week (other slots, weekends, a fuller evening, two on a day), and only what
 * truly cannot be placed comes back in `short`, for the person to decide.
 */
export function planWeek(raw: AppData, now: Date = new Date(), busyOverride?: BusyFn): { sessions: PlannedSession[]; short: Shortfall[] } {
  const today = toISO(now);
  const monday = weekStart(today);
  const data = withOccurrences(raw, monday, addDays(monday, 6), today);
  const busy: BusyFn = busyOverride ?? planningBusy(data);
  const p = withDefaults(data.profile);
  const buffer = p.bufferMin;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart(today), i));
  const logs = data.sessions ?? [];
  const slots = new Map(p.slots.map((s) => [s.id, s]));
  const areas = p.areas.filter((a) => a.target);

  // A finished session, or a fixed event that stands in for it (a weekend outing counts as the walk).
  const doneOn = (a: Area, d: ISODate) => logs.some((l) => l.areaId === a.id && l.date === d) || countedByEvent(data, a.id, d);
  // A skipped day is avoided; a day whose session was already done early ("early") or moved elsewhere ("moved": it
  // carries on as a task, see lib/reschedule.ts) is used up the same way.
  const skipped = (a: Area, d: ISODate) => {
    const s = entryFor(data.log, sessionKey(a.id, d))?.status;
    return s === "skip" || s === "early" || s === "moved";
  };
  // A session that was rescheduled or carried over is a task that counts as that area's session: it is one of this
  // week's sessions already, so it is never planned twice.
  const pendingTasks = (a: Area) => data.tasks.filter((t) => t.status === "open" && t.countsFor === a.id && t.due != null && t.due >= week[0] && t.due <= week[6]).length;

  // Where an area's sessions really happen is offered first (within the slots he allowed; never over an exact time or a locked order).
  const learned = learnedSlots(data, today);
  const slotsFor = (a: Area, d: ISODate): Slot[] => {
    const ids = a.target!.slots.length ? orderSlots(a.target!.slots, learned.get(a.id)) : p.slots.map((s) => s.id);
    return ids
      .map((id) => slots.get(id))
      .filter((s): s is Slot => !!s && s.days.includes(fromISO(d).getDay()));
  };
  const earliest = (d: ISODate) => (d === today ? nowMin + 5 : 0);
  // How far a day's evening and night slots move because of a long routine block (0 on an ordinary day).
  const rules = new Map<ISODate, ReturnType<typeof dayRules>>();
  const rulesOf = (d: ISODate) => {
    let r = rules.get(d);
    if (!r) rules.set(d, (r = dayRules(data, d)));
    return r;
  };
  const shiftFor = (s: Slot, d: ISODate) => (toMin(s.start) >= rulesOf(d).eveningStart ? rulesOf(d).shift : 0);

  /** Days this area could still happen on this week. */
  const eligible = (a: Area): ISODate[] =>
    week.filter((d) => {
      if (d < today || doneOn(a, d) || skipped(a, d)) return false;
      if (!a.target!.weekends && isWeekend(d)) return false;
      // An off day keeps one SHORT session; anything longer waits for another day.
      if (isOffDay(data, d) && (a.target!.minutes > OFF_DAY_MAX_MIN || logs.some((l) => l.date === d))) return false;
      return slotsFor(a, d).some((s) => windows(s, d, earliest(d), busy, shiftFor(s, d)).some(([ws, we]) => we - ws >= a.target!.minutes));
    });

  // cell = one slot on one day
  const cells = new Map<string, Item[]>();
  const cellKey = (d: ISODate, s: Slot) => `${d}|${s.id}`;
  const dayMinutes = (d: ISODate) =>
    [...cells.entries()].filter(([k]) => k.startsWith(d)).reduce((n, [, items]) => n + items.reduce((m, i) => m + i.minutes, 0), 0);

  /** Minutes already planned in the evening of a day: sessions in evening slots plus clock-time commitments. */
  const eveningUsed = (d: ISODate, r: ReturnType<typeof dayRules>) =>
    [...cells.entries()]
      .filter(([k]) => k.startsWith(d) && toMin(slots.get(k.split("|")[1])?.start ?? "00:00") >= r.eveningStart)
      .reduce((n, [, items]) => n + items.reduce((m, i) => m + i.minutes, 0), 0) + overlapMinutes(fixedSpans(data, d), r.eveningStart, 1440);

  const itemsOn = (d: ISODate) => [...cells.entries()].filter(([k]) => k.startsWith(d)).reduce((n, [, items]) => n + items.length, 0);

  const tryPlace = (a: Area, d: ISODate): boolean => {
    // Off day: at most ONE session, and a short one. The rest of the week absorbs everything else.
    if (isOffDay(data, d) && (itemsOn(d) >= 1 || a.target!.minutes > OFF_DAY_MAX_MIN || logs.some((l) => l.date === d))) return false;
    const cap = isWeekend(d) ? WEEKEND_CAP : WEEKDAY_CAP;
    if (dayMinutes(d) + a.target!.minutes > cap) return false;
    const r = dayRules(data, d);
    for (const s of slotsFor(a, d)) {
      // The evening holds about 2.5 hours of plans (lighter on office days), counting fixed events in it too.
      // Sessions may use a little over ("about"); tasks added later only get what the cap itself leaves.
      if (toMin(s.start) >= r.eveningStart && eveningUsed(d, r) + a.target!.minutes > r.eveningCap * SESSION_CAP_SLACK) continue;
      const item: Item = { area: a, minutes: a.target!.minutes, order: a.target!.order ?? 5, at: a.target!.at ? toMin(a.target!.at) + shiftFor(s, d) : undefined };
      const existing = cells.get(cellKey(d, s)) ?? [];
      if (layout([...existing, item], windows(s, d, earliest(d), busy, shiftFor(s, d)), buffer)) {
        cells.set(cellKey(d, s), [...existing, item]);
        return true;
      }
    }
    return false;
  };

  const focus = new Set(data.settings.focus?.week === week[0] ? data.settings.focus.areas : []);

  // Plan the tightest areas first so flexible ones fill what's left.
  const needs = areas
    .map((a) => {
      const days = eligible(a);
      const done =
        logs.filter((l) => l.areaId === a.id && l.date >= week[0] && l.date <= week[6]).length +
        week.filter((d) => countedByEvent(data, a.id, d) && !logs.some((l) => l.areaId === a.id && l.date === d)).length;
      const remaining = Math.min(Math.max(0, a.target!.perWeek - done - pendingTasks(a)), days.length);
      return { a, days, remaining, tight: days.length ? remaining / days.length : 0 };
    })
    .filter((x) => x.remaining > 0)
    // "Apply focus" (Your week → Focus for next week): those areas are placed first, before the others fill the days.
    .sort((x, y) => Number(focus.has(y.a.id)) - Number(focus.has(x.a.id)) || y.tight - x.tight || (x.a.target!.order ?? 5) - (y.a.target!.order ?? 5));

  for (const { a, days, remaining } of needs) {
    // Evenly spaced picks across the days that are left, e.g. 4 of 5 weekdays, or Mon / Wed / Fri.
    // A focus area takes the earliest days of the week instead, so it is not left to the end.
    const picks = focus.has(a.id) ? days.slice(0, remaining) : Array.from({ length: remaining }, (_, i) => days[Math.floor(((i + 0.5) * days.length) / remaining)]);
    const used = new Set<ISODate>();
    for (const day of picks) {
      if (tryPlace(a, day)) {
        used.add(day);
        continue;
      }
      // Doesn't fit (an event, a full slot): shift to the nearest free day instead of dropping it.
      const near = days
        .filter((d) => !picks.includes(d) && !used.has(d))
        .sort((x, y) => Math.abs(days.indexOf(x) - days.indexOf(day)) - Math.abs(days.indexOf(y) - days.indexOf(day)));
      const alt = near.find((d) => tryPlace(a, d));
      if (alt) used.add(alt);
    }
  }

  // Turn the cells into dated, timed sessions and number them.
  const placed: Array<Placed & { date: ISODate; slot: Slot }> = [];
  for (const [k, items] of cells) {
    const [date, slotId] = k.split("|");
    const slot = slots.get(slotId)!;
    const laid = layout(items, windows(slot, date, earliest(date), busy, shiftFor(slot, date)), buffer);
    if (laid) placed.push(...laid.map((l) => ({ ...l, date, slot })));
  }
  placed.sort((x, y) => x.date.localeCompare(y.date) || x.start - y.start);

  // ---- The hard rule: every target session lands somewhere in the week -------------------------------------------------
  const short: Shortfall[] = [];
  const doneCount = (a: Area) =>
    logs.filter((l) => l.areaId === a.id && l.date >= week[0] && l.date <= week[6]).length +
    week.filter((d) => countedByEvent(data, a.id, d) && !logs.some((l) => l.areaId === a.id && l.date === d)).length;
  const spansOn = (d: ISODate): Array<[number, number]> => placed.filter((x) => x.date === d).map((x) => [Math.max(0, x.start - buffer), x.end + buffer]);
  const minutesOn = (d: ISODate) => placed.filter((x) => x.date === d).reduce((n, x) => n + x.minutes, 0) + logs.filter((l) => l.date === d).reduce((n, l) => n + l.minutes, 0);
  const subtract = (ws: Array<[number, number]>, taken: Array<[number, number]>) => {
    let out = ws;
    for (const [bs, be] of taken) out = out.flatMap(([s, e]) => (be <= s || bs >= e ? [[s, e] as [number, number]] : [[s, Math.min(e, bs)] as [number, number], [Math.max(s, be), e] as [number, number]]));
    return out.filter(([s, e]) => e - s >= 5);
  };
  /** Free stretches anywhere outside work hours on a day (level B), after events, the break, the commute and what is placed. */
  const freeWindows = (d: ISODate): Array<[number, number]> => {
    const r = rulesOf(d);
    const from = Math.max(isWeekend(d) ? 9 * 60 : r.dayStart, earliest(d));
    const to = Math.max(from, r.dayEnd);
    const taken: Array<[number, number]> = [...busy(d), ...spansOn(d)];
    if (r.work) taken.push(r.work);
    return subtract([[from, to]], taken);
  };
  /** Minutes already in a day's evening: sessions that start there plus clock-time commitments in it. */
  const eveningMinutes = (d: ISODate) => {
    const r = rulesOf(d);
    return placed.filter((x) => x.date === d && x.start >= r.eveningStart).reduce((n, x) => n + x.minutes, 0) + overlapMinutes(fixedSpans(data, d), r.eveningStart, 1440);
  };
  /** Where one more session of this area could start on this day. Level A: its own slots. Level B: any free time. Neither may overfill the day or its evening. */
  const relaxedSpot = (a: Area, d: ISODate, level: "A" | "B"): { start: number; slotId: string } | null => {
    const minutes = a.target!.minutes;
    if (isOffDay(data, d) && (minutes > OFF_DAY_MAX_MIN || logs.some((l) => l.date === d))) return null;
    if (minutesOn(d) + minutes > (isWeekend(d) ? RELAXED_WEEKEND_CAP : RELAXED_WEEKDAY_CAP)) return null;
    const r = rulesOf(d);
    const roomInEvening = eveningMinutes(d) + minutes <= r.eveningCap * RELAXED_EVENING;
    const ok = (ws: Array<[number, number]>) => ws.find(([s, e]) => e - s >= minutes && (s < r.eveningStart || roomInEvening));
    if (level === "A") {
      for (const s of slotsFor(a, d)) {
        const hit = ok(subtract(windows(s, d, earliest(d), busy, shiftFor(s, d)), spansOn(d)));
        if (hit) return { start: hit[0], slotId: s.id };
      }
      return null;
    }
    const hit = ok(freeWindows(d));
    return hit ? { start: Math.ceil(hit[0] / 5) * 5, slotId: "flex" } : null;
  };
  const countOf = (a: Area, d?: ISODate) => placed.filter((x) => x.area.id === a.id && (!d || x.date === d)).length;
  const have = (a: Area) => doneCount(a) + pendingTasks(a) + countOf(a);
  const mayUse = (a: Area, d: ISODate) => d >= today && !doneOn(a, d) && !skipped(a, d);

  // Your own priority order first (the lower `order`), then the area furthest from its target, so what matters most gets the free time.
  const gap = (a: Area) => (a.target!.perWeek - have(a)) / a.target!.perWeek;
  const byGap = [...areas].sort((x, y) => (x.target!.order ?? 5) - (y.target!.order ?? 5) || gap(y) - gap(x));
  const passes = [1, RELAXED_PER_DAY];
  /** One more session of this area, if any day can take it. */
  const placeOne = (a: Area, level: "A" | "B", perDay: number): boolean => {
    const days = week.filter((d) => mayUse(a, d) && countOf(a, d) < perDay).sort((x, y) => minutesOn(x) - minutesOn(y) || x.localeCompare(y));
    for (const d of days) {
      const spot = relaxedSpot(a, d, level);
      if (!spot) continue;
      const slot: Slot = slots.get(spot.slotId) ?? { id: spot.slotId, name: "Free time", start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6] };
      placed.push({ area: a, minutes: a.target!.minutes, order: a.target!.order ?? 5, start: spot.start, end: spot.start + a.target!.minutes, date: d, slot });
      return true;
    }
    return false;
  };
  // Round-robin, one session per area per round: a crowded week is shared out instead of one area taking all the free time.
  // In its turn an area tries its own slots first, then any free time (so an area with no slot on a weekend still gets one).
  for (const perDay of passes) {
    for (let moved = true; moved; ) {
      moved = false;
      for (const a of byGap) {
        // A daily habit (6+ a week) is never doubled up to catch up: it is reported instead.
        if (perDay > 1 && a.target!.perWeek > 5) continue;
        if (have(a) < a.target!.perWeek && (placeOne(a, "A", perDay) || placeOne(a, "B", perDay))) moved = true;
      }
    }
  }
  for (const a of byGap) if (have(a) < a.target!.perWeek) short.push({ areaId: a.id, name: a.name, target: a.target!.perWeek, fit: have(a) });
  placed.sort((x, y) => x.date.localeCompare(y.date) || x.start - y.start);

  const counters = new Map<string, number>();
  const out: PlannedSession[] = [];

  // Today's finished sessions stay on the list, so the day reads as one plan (every one of them, in order).
  const seen = new Set<string>();
  for (const l of logs.filter((x) => x.date === today).sort((x, y) => x.at - y.at)) {
    const a = areas.find((x) => x.id === l.areaId);
    if (!a) continue;
    const at = new Date(l.at);
    const start = at.getHours() * 60 + at.getMinutes();
    const extra = seen.has(a.id);
    seen.add(a.id);
    out.push({
      key: extra ? `${sessionKey(a.id, today)}#${l.id.slice(0, 8)}` : sessionKey(a.id, today),
      areaId: a.id,
      date: today,
      slotId: "",
      start,
      end: start + l.minutes,
      minutes: l.minutes,
      n: l.n,
      variant: l.variant,
      title: sessionTitle(a, l.n, l.variant),
      done: true,
      logId: l.id,
      extra: extra || undefined,
    });
  }
  for (const s of placed) {
    const n = counters.get(s.area.id) ?? nextNumber(logs, s.area.id, s.area.target?.startAt);
    counters.set(s.area.id, n + 1);
    const variant = variantFor(s.area, n);
    out.push({
      key: sessionKey(s.area.id, s.date),
      areaId: s.area.id,
      date: s.date,
      slotId: s.slot.id,
      start: s.start,
      end: s.end,
      minutes: s.minutes,
      n,
      variant,
      title: sessionTitle(s.area, n, variant),
      done: false,
    });
  }
  return { sessions: out.sort((x, y) => x.date.localeCompare(y.date) || x.start - y.start), short };
}

/** Sessions still to do on a day (not done, not skipped). */
export const pendingOn = (plan: PlannedSession[], date: ISODate) => plan.filter((s) => s.date === date && !s.done);

/**
 * What was planned for one day, as seen from the start of that day. Unlike `planSessions` it doesn't forget
 * sessions whose slot has already passed, so "Did you do today's sessions?" and the Today list stay stable.
 * Sessions you've already logged that day come back as `done`.
 */
export function plannedForDay(data: AppData, date: ISODate, busyOverride?: BusyFn): PlannedSession[] {
  const busy: BusyFn = busyOverride ?? planningBusy(data);
  const logs = data.sessions ?? [];
  const mine = logs.filter((l) => l.date === date).sort((x, y) => x.at - y.at);
  const areaOf = (id: string) => withDefaults(data.profile).areas.find((a) => a.id === id);
  // Plan as if nothing was done that day yet, from midnight, then mark off what was.
  const fresh = planSessions({ ...data, sessions: logs.filter((l) => l.date !== date) }, fromISO(date), busy).filter((s) => s.date === date && !s.done);
  // The first session of an area that day fills the planned one; any others are extras of their own.
  const used = new Set<string>();
  const out: PlannedSession[] = fresh.map((s) => {
    const l = mine.find((x) => x.areaId === s.areaId);
    if (!l) return s;
    used.add(l.id);
    const a = areaOf(s.areaId);
    return { ...s, done: true, n: l.n, variant: l.variant, logId: l.id, title: a ? sessionTitle(a, l.n, l.variant) : s.title };
  });
  // Anything logged that wasn't the planned one (done early, an extra, a second walk) still shows.
  for (const l of mine) {
    if (used.has(l.id)) continue;
    const a = areaOf(l.areaId);
    if (!a) continue;
    const at = new Date(l.at);
    const start = at.getHours() * 60 + at.getMinutes();
    const extra = out.some((s) => s.areaId === l.areaId);
    out.push({
      key: extra ? `${sessionKey(a.id, date)}#${l.id.slice(0, 8)}` : sessionKey(a.id, date),
      areaId: a.id,
      date,
      slotId: "",
      start,
      end: start + l.minutes,
      minutes: l.minutes,
      n: l.n,
      variant: l.variant,
      title: sessionTitle(a, l.n, l.variant),
      done: true,
      logId: l.id,
      extra: extra || undefined,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}
