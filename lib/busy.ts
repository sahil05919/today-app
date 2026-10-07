import { fromISO } from "./dates";
import { allEvents, eventSpan } from "./fixed";
import { isOffDay } from "./offday";
import { toMin, withDefaults } from "./profile";
import type { AppData, ISODate, Task } from "./types";

/**
 * The rules of a realistic day, in one place. Both the weekly session planner (lib/schedule.ts) and the day timeline
 * (lib/timeline.ts) read these, so the screen, the notifications and the plan always agree.
 *
 *  - no overlaps, ever, with a buffer between planned items (default 10 min)
 *  - a protected tea / food break (17:00–18:00) on weekdays
 *  - the evening (after the break) holds about 2.5 hours of plans; office days are lighter
 *  - on an office day the commute is real time: before work and after it
 * Everything is minutes after midnight.
 */
export type Span = [number, number];

export interface DayRules {
  date: ISODate;
  dow: number;
  weekday: boolean;
  workDay: boolean;
  office: boolean;
  off: boolean;
  /** Work hours (null on days off). Work tasks may sit inside; everything else stays outside. */
  work: Span | null;
  commuteTo: Span | null;
  commuteFrom: Span | null;
  lunch: Span | null;
  /** The protected tea / food break. */
  tea: Span | null;
  /** The window flexible items may be placed in. */
  dayStart: number;
  dayEnd: number;
  /** The evening starts when the break ends. */
  eveningStart: number;
  /** Most minutes of plans in the evening. */
  eveningCap: number;
  buffer: number;
}

const ceil5 = (n: number) => Math.ceil(n / 5) * 5;
const LATEST_END = 22 * 60 + 30;

export function dayRules(data: AppData, date: ISODate): DayRules {
  const p = withDefaults(data.profile);
  const dow = fromISO(date).getDay();
  const weekday = dow >= 1 && dow <= 5;
  const office = p.officeDays.includes(dow);
  const workDay = p.workDays.includes(dow) || office;
  const off = isOffDay(data, date);

  const ws = toMin(p.workStart);
  const we = toMin(p.workEnd);
  const to = office ? p.officeCommuteMin : p.commuteToMin;
  const from = office ? p.officeCommuteMin : p.commuteFromMin;
  const work: Span | null = workDay ? [ws, we] : null;
  const commuteTo: Span | null = workDay && to > 0 ? [ws - to, ws] : null;
  const commuteFrom: Span | null = workDay && from > 0 ? [we, we + from] : null;
  const lunch: Span | null = workDay && p.lunchMin > 0 ? [toMin(p.lunchStart), toMin(p.lunchStart) + p.lunchMin] : null;

  const bs = toMin(p.breakStart);
  const be = toMin(p.breakEnd);
  let tea: Span | null = null;
  if (weekday && be > bs) {
    // After a commute home the break starts when you're back, and keeps its length.
    const start = commuteFrom ? Math.max(bs, commuteFrom[1]) : bs;
    tea = [start, start + (be - bs)];
  }

  const qs = toMin(p.quietStart);
  const qe = toMin(p.quietEnd);
  const dayStart = qs > qe ? qe : 7 * 60;
  const dayEnd = Math.min(qs > qe ? qs : 22 * 60, LATEST_END);

  const cap = off ? 60 : office ? Math.round(p.eveningCapMin * 0.6) : p.eveningCapMin;
  return {
    date,
    dow,
    weekday,
    workDay,
    office,
    off,
    work,
    commuteTo,
    commuteFrom,
    lunch,
    tea,
    dayStart,
    dayEnd,
    eveningStart: be,
    eveningCap: cap,
    buffer: p.bufferMin,
  };
}

/** How long a task with a fixed time takes on the clock (never less than 15 min). */
export const timedDuration = (t: Pick<Task, "estimateMin">) => Math.max(15, ceil5(t.estimateMin ?? 30));

/** Open tasks that have their own clock time on this day. */
export const timedTasksOn = (data: AppData, date: ISODate): Task[] =>
  data.tasks.filter((t) => t.status === "open" && t.due === date && !!t.dueTime);

const pad = (s: Span, by: number): Span => [Math.max(0, s[0] - by), Math.min(1440, s[1] + by)];

/**
 * Everything a session must stay clear of on a day: events (including the phone's calendar), timed tasks (all with a
 * buffer around them), the tea break and the office commute. Passed to the session planner as its "busy" function.
 */
export function planningBusy(data: AppData): (date: ISODate) => Span[] {
  const p = withDefaults(data.profile);
  const byDate = new Map<ISODate, Span[]>();
  const add = (d: ISODate, s: Span) => {
    const list = byDate.get(d);
    if (list) list.push(s);
    else byDate.set(d, [s]);
  };
  for (const e of allEvents(data)) {
    const span = eventSpan(e);
    add(e.date, e.start ? pad(span, p.bufferMin) : span);
  }
  for (const t of data.tasks) {
    if (t.status !== "open" || !t.due || !t.dueTime) continue;
    const s = toMin(t.dueTime);
    add(t.due, pad([s, s + timedDuration(t)], p.bufferMin));
  }
  const cache = new Map<ISODate, Span[]>();
  return (date) => {
    const hit = cache.get(date);
    if (hit) return hit;
    const r = dayRules(data, date);
    const extra: Span[] = [];
    if (r.tea) extra.push(r.tea);
    if (r.commuteTo) extra.push(r.commuteTo);
    if (r.commuteFrom) extra.push(r.commuteFrom);
    const out = [...(byDate.get(date) ?? []), ...extra];
    cache.set(date, out);
    return out;
  };
}

/** Minutes of `spans` that fall inside [from, to). Overlaps between spans are counted once. */
export function overlapMinutes(spans: Span[], from: number, to: number): number {
  const clipped = spans
    .map(([s, e]) => [Math.max(s, from), Math.min(e, to)] as Span)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [s, e] of clipped) {
    if (s > end) total += e - s;
    else if (e > end) total += e - end;
    end = Math.max(end, e);
  }
  return total;
}

/** The clock-time commitments on a day, exactly as they are (no buffers): events and timed tasks. For load counting. */
export function fixedSpans(data: AppData, date: ISODate): Span[] {
  const out: Span[] = [];
  for (const e of allEvents(data)) if (e.date === date && e.start) out.push(eventSpan(e));
  for (const t of timedTasksOn(data, date)) {
    const s = toMin(t.dueTime!);
    out.push([s, s + timedDuration(t)]);
  }
  return out;
}
