import { addDays, fromISO, toISO } from "./dates";
import { countedByEvent } from "./fixed";
import { withDefaults } from "./profile";
import { weekStart } from "./stats";
import type { Area, AppData, DayEntry, ISODate, SessionLog } from "./types";

/** Keys for the done / skipped / snoozed log. */
export const sessionKey = (areaId: string, date: ISODate) => `session:${areaId}:${date}`;
export const choreKey = (id: string, date: ISODate) => `chore:${id}:${date}`;
export const wrapKey = (date: ISODate) => `wrap:${date}`;

export const entryFor = (log: DayEntry[] | undefined, key: string) => log?.find((e) => e.key === key);

/** Areas that have a weekly session target. */
export const sessionAreas = (data: AppData): Area[] => withDefaults(data.profile).areas.filter((a) => a.target);

/**
 * The next session number for an area: "Power BI session 14" is 14. `startAt` (Settings → the area's "Next session is
 * number …") lets the count continue from an older history; once you're past it, counting goes on from your own logs.
 */
export function nextNumber(logs: SessionLog[] | undefined, areaId: string, startAt?: number): number {
  const logged = (logs ?? []).filter((l) => l.areaId === areaId).reduce((m, l) => Math.max(m, l.n), 0) + 1;
  return Math.max(logged, startAt && startAt > 0 ? Math.floor(startAt) : 1);
}

export const variantFor = (area: Area, n: number): string | undefined =>
  area.target?.variants?.length ? area.target.variants[(n - 1) % area.target.variants.length] : undefined;

export const sessionTitle = (area: Area, n: number, variant?: string) =>
  variant ? `${variant} · session ${n}` : `${area.name} session ${n}`;

/** Oldest first: by day, then by time of day. */
const byWhen = (a: SessionLog, b: SessionLog) => a.date.localeCompare(b.date) || a.at - b.at;

/**
 * Renumbers an area's logs by date then time, reusing the numbers it already has, so "session N" stays in order after a
 * backdated, early or removed session. `slots` = the numbers to hand out (default: the ones in use).
 */
export function renumber(logs: SessionLog[], area: Area | undefined, areaId: string, slots?: number[]): SessionLog[] {
  const mine = logs.filter((l) => l.areaId === areaId).sort(byWhen);
  const ns = slots ?? mine.map((l) => l.n).sort((a, b) => a - b);
  const next = new Map(mine.map((l, i) => [l.id, ns[i] ?? l.n]));
  return logs.map((l) => {
    const n = next.get(l.id);
    return n == null || n === l.n ? l : { ...l, n, variant: area ? variantFor(area, n) : l.variant };
  });
}

/**
 * Adds one session for an area on a day. Any number per day: each is its own numbered session.
 * A day before today is stamped at midday (so it sorts sensibly) and marked backdated.
 */
export function addLog(data: AppData, areaId: string, date: ISODate, source: SessionLog["source"], now: Date): { data: AppData; log: SessionLog } | null {
  const area = withDefaults(data.profile).areas.find((a) => a.id === areaId);
  if (!area?.target) return null;
  const logs = data.sessions ?? [];
  const backdated = date < toISO(now);
  const sameDay = logs.filter((l) => l.areaId === areaId && l.date === date).length;
  const n = nextNumber(logs, areaId, area.target.startAt);
  const raw: SessionLog = {
    id: crypto.randomUUID(),
    areaId,
    date,
    minutes: area.target.minutes,
    n,
    variant: variantFor(area, n),
    at: backdated ? fromISO(date).getTime() + (12 * 60 + sameDay) * 60_000 : now.getTime(),
    source,
    ...(backdated ? { via: "backdated" as const } : {}),
  };
  const sessions = renumber([...logs, raw], area, areaId);
  // Counting a session also clears any "skipped" or "snoozed" mark for that day.
  const log = (data.log ?? []).filter((e) => e.key !== sessionKey(areaId, date));
  return { data: { ...data, sessions, log }, log: sessions.find((l) => l.id === raw.id)! };
}

/** Takes back one specific session (never "the one on that day"). The numbers after it close up. */
export function removeLog(data: AppData, logId: string): AppData {
  const logs = data.sessions ?? [];
  const gone = logs.find((l) => l.id === logId);
  if (!gone) return data;
  const area = withDefaults(data.profile).areas.find((a) => a.id === gone.areaId);
  const ns = logs.filter((l) => l.areaId === gone.areaId).map((l) => l.n).sort((a, b) => a - b).slice(0, -1);
  return { ...data, sessions: renumber(logs.filter((l) => l.id !== logId), area, gone.areaId, ns) };
}

export interface ProgressRow {
  area: Area;
  done: number;
  target: number;
  /** The week's target is reached (sessions beyond it are extras: "7/6 ⭐"). */
  finished: boolean;
  /** Sessions beyond the target. */
  over: number;
  /** The day the target was reached, if it was. */
  finishedOn?: ISODate;
  minutes: number;
  /** Last day a session was logged, if any. */
  last?: ISODate;
  /** Days since the last session (null = never). */
  daysSince: number | null;
}

/** Weekly progress per area (Monday to Sunday). */
export function weekProgress(data: AppData, today: ISODate): ProgressRow[] {
  const start = weekStart(today);
  const end = addDays(start, 6);
  const logs = data.sessions ?? [];
  return sessionAreas(data).map((area) => {
    const mine = logs.filter((l) => l.areaId === area.id);
    const week = mine.filter((l) => l.date >= start && l.date <= end);
    // Events that stand in for a session count once their day has come (an outing counts as the walk).
    const eventDays = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((d) => d <= today && countedByEvent(data, area.id, d) && !week.some((l) => l.date === d));
    const counted = [...week.map((l) => l.date), ...eventDays].sort();
    const last = mine.reduce<ISODate | undefined>((m, l) => (!m || l.date > m ? l.date : m), undefined);
    const done = week.length + eventDays.length;
    const target = area.target!.perWeek;
    return {
      area,
      done,
      target,
      finished: done >= target,
      over: Math.max(0, done - target),
      finishedOn: done >= target ? counted[target - 1] : undefined,
      minutes: week.reduce((n, l) => n + l.minutes, 0) + eventDays.length * area.target!.minutes,
      last,
      daysSince: last ? Math.round((Date.parse(today) - Date.parse(last)) / 86_400_000) : null,
    };
  });
}
