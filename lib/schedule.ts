import { addDays, fromISO, toISO } from "./dates";
import { dayRules, fixedSpans, overlapMinutes, planningBusy } from "./busy";
import { countedByEvent } from "./fixed";
import { isOffDay, OFF_DAY_MAX_MIN } from "./offday";
import { toMin, withDefaults } from "./profile";
import { entryFor, nextNumber, sessionKey, sessionTitle, variantFor } from "./sessions";
import { weekStart } from "./stats";
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
}

export type BusyFn = (date: ISODate) => Array<[number, number]>;

/** The evening cap is "about" 2.5 h: weekly sessions may run a tenth over so a normal day of them still fits. */
export const SESSION_CAP_SLACK = 1.1;
const WEEKDAY_CAP = 210; // minutes of sessions per day
const WEEKEND_CAP = 100; // weekends stay light
const isWeekend = (date: ISODate) => [0, 6].includes(fromISO(date).getDay());

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
function windows(slot: Slot, date: ISODate, earliest: number, busy: BusyFn): Array<[number, number]> {
  let ws: Array<[number, number]> = [[Math.max(toMin(slot.start), earliest), toMin(slot.end)]];
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

export function planSessions(data: AppData, now: Date = new Date(), busyOverride?: BusyFn): PlannedSession[] {
  const busy: BusyFn = busyOverride ?? planningBusy(data);
  const p = withDefaults(data.profile);
  const buffer = p.bufferMin;
  const today = toISO(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart(today), i));
  const logs = data.sessions ?? [];
  const slots = new Map(p.slots.map((s) => [s.id, s]));
  const areas = p.areas.filter((a) => a.target);

  // A finished session, or a fixed event that stands in for it (a weekend outing counts as the walk).
  const doneOn = (a: Area, d: ISODate) => logs.some((l) => l.areaId === a.id && l.date === d) || countedByEvent(data, a.id, d);
  const skipped = (a: Area, d: ISODate) => entryFor(data.log, sessionKey(a.id, d))?.status === "skip";

  const slotsFor = (a: Area, d: ISODate): Slot[] => {
    const ids = a.target!.slots.length ? a.target!.slots : p.slots.map((s) => s.id);
    return ids
      .map((id) => slots.get(id))
      .filter((s): s is Slot => !!s && s.days.includes(fromISO(d).getDay()));
  };
  const earliest = (d: ISODate) => (d === today ? nowMin + 5 : 0);

  /** Days this area could still happen on this week. */
  const eligible = (a: Area): ISODate[] =>
    week.filter((d) => {
      if (d < today || doneOn(a, d) || skipped(a, d)) return false;
      if (!a.target!.weekends && isWeekend(d)) return false;
      // An off day keeps one SHORT session; anything longer waits for another day.
      if (isOffDay(data, d) && (a.target!.minutes > OFF_DAY_MAX_MIN || logs.some((l) => l.date === d))) return false;
      return slotsFor(a, d).some((s) => windows(s, d, earliest(d), busy).some(([ws, we]) => we - ws >= a.target!.minutes));
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
      const item: Item = { area: a, minutes: a.target!.minutes, order: a.target!.order ?? 5, at: a.target!.at ? toMin(a.target!.at) : undefined };
      const existing = cells.get(cellKey(d, s)) ?? [];
      if (layout([...existing, item], windows(s, d, earliest(d), busy), buffer)) {
        cells.set(cellKey(d, s), [...existing, item]);
        return true;
      }
    }
    return false;
  };

  // Plan the tightest areas first so flexible ones fill what's left.
  const needs = areas
    .map((a) => {
      const days = eligible(a);
      const done =
        logs.filter((l) => l.areaId === a.id && l.date >= week[0] && l.date <= week[6]).length +
        week.filter((d) => countedByEvent(data, a.id, d) && !logs.some((l) => l.areaId === a.id && l.date === d)).length;
      const remaining = Math.min(Math.max(0, a.target!.perWeek - done), days.length);
      return { a, days, remaining, tight: days.length ? remaining / days.length : 0 };
    })
    .filter((x) => x.remaining > 0)
    .sort((x, y) => y.tight - x.tight || (x.a.target!.order ?? 5) - (y.a.target!.order ?? 5));

  for (const { a, days, remaining } of needs) {
    // Evenly spaced picks across the days that are left, e.g. 4 of 5 weekdays, or Mon / Wed / Fri.
    const picks = Array.from({ length: remaining }, (_, i) => days[Math.floor(((i + 0.5) * days.length) / remaining)]);
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
    const laid = layout(items, windows(slot, date, earliest(date), busy), buffer);
    if (laid) placed.push(...laid.map((l) => ({ ...l, date, slot })));
  }
  placed.sort((x, y) => x.date.localeCompare(y.date) || x.start - y.start);

  const counters = new Map<string, number>();
  const out: PlannedSession[] = [];

  // Today's finished sessions stay on the list, so the day reads as one plan.
  for (const l of logs.filter((x) => x.date === today)) {
    const a = areas.find((x) => x.id === l.areaId);
    if (!a) continue;
    const at = new Date(l.at);
    const start = at.getHours() * 60 + at.getMinutes();
    out.push({
      key: sessionKey(a.id, today),
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
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.start - y.start);
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
  const mine = logs.filter((l) => l.date === date);
  // Plan as if nothing was done that day yet, from midnight, then mark off what was.
  const fresh = planSessions({ ...data, sessions: logs.filter((l) => l.date !== date) }, fromISO(date), busy).filter((s) => s.date === date && !s.done);
  const out: PlannedSession[] = fresh.map((s) => {
    const l = mine.find((x) => x.areaId === s.areaId);
    return l ? { ...s, done: true, n: l.n, variant: l.variant, title: s.title.replace(/\d+$/, String(l.n)) } : s;
  });
  // Anything logged that wasn't in the plan (done early, or an extra) still shows.
  for (const l of mine) {
    if (out.some((s) => s.areaId === l.areaId)) continue;
    const area = withDefaults(data.profile).areas.find((a) => a.id === l.areaId);
    if (!area) continue;
    const at = new Date(l.at);
    const start = at.getHours() * 60 + at.getMinutes();
    out.push({
      key: sessionKey(area.id, date),
      areaId: area.id,
      date,
      slotId: "",
      start,
      end: start + l.minutes,
      minutes: l.minutes,
      n: l.n,
      variant: l.variant,
      title: sessionTitle(area, l.n, l.variant),
      done: true,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}
