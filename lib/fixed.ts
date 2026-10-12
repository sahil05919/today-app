import { toMin, withDefaults } from "./profile";
import type { Area, AppData, EventMark, FixedEvent, ISODate } from "./types";

/**
 * Fixed events ("event Wednesday 6pm dinner", or anything read from the phone's calendar) are blocks that never move.
 * Sessions and tasks flow around them. An event with no time blocks the whole day for sessions.
 */
export const DEFAULT_EVENT_MINUTES = 120;

/** The key of an event's local marks: the phone's own event id (or ours) plus the day. Done is stored per event + start date. */
export const eventMarkKey = (e: Pick<FixedEvent, "id" | "calId" | "date">) => `${e.calId ?? e.id}@${e.date}`;

export const markOf = (data: AppData, e: Pick<FixedEvent, "id" | "calId" | "date">): EventMark | undefined => data.eventMarks?.[eventMarkKey(e)];
export const isEventDone = (data: AppData, e: Pick<FixedEvent, "id" | "calId" | "date">) => !!markOf(data, e)?.done;

/** Sets or clears the marks on one event (nothing is ever written to the phone's calendar: these live only here). */
export function withMark(data: AppData, key: string, patch: Partial<EventMark> | null): AppData {
  const blocks = { ...(data.eventMarks ?? {}) };
  const next: EventMark = patch ? { ...blocks[key], ...patch } : {};
  for (const k of Object.keys(next) as Array<keyof EventMark>) if (next[k] === undefined || next[k] === false) delete next[k];
  if (Object.keys(next).length) blocks[key] = next;
  else delete blocks[key];
  return { ...data, eventMarks: blocks };
}

/**
 * Your own events plus the read-only mirror of the phone's calendar, with your local marks applied: an event hidden for the
 * day is gone (it blocks nothing), and a local time override replaces the calendar's time here only.
 */
export const allEvents = (data: AppData): FixedEvent[] => {
  const all = [...(data.events ?? []), ...(data.calendarEvents ?? [])];
  const marks = data.eventMarks;
  if (!marks) return all;
  const out: FixedEvent[] = [];
  for (const e of all) {
    const m = marks[eventMarkKey(e)];
    if (m?.hidden) continue;
    if (m && (m.start || m.end) && e.start) {
      const was = e.end ? toMin(e.end) - toMin(e.start) : DEFAULT_EVENT_MINUTES;
      const start = m.start ?? e.start;
      const end = m.end ?? (m.start ? toHHMMLocal(toMin(start) + was) : e.end);
      out.push({ ...e, start, end });
    } else out.push(e);
  }
  return out;
};

const toHHMMLocal = (min: number) => `${String(Math.floor(Math.min(1439, min) / 60)).padStart(2, "0")}:${String(Math.min(1439, min) % 60).padStart(2, "0")}`;

export const eventsOn = (data: AppData, date: ISODate): FixedEvent[] =>
  allEvents(data)
    .filter((e) => e.date === date)
    .sort((a, b) => (a.start ?? "00:00").localeCompare(b.start ?? "00:00"));

/** [start, end) in minutes after midnight. */
export function eventSpan(e: FixedEvent): [number, number] {
  if (!e.start) return [0, 1440];
  const s = toMin(e.start);
  const end = e.end ? toMin(e.end) : s + DEFAULT_EVENT_MINUTES;
  return [s, Math.max(end, s + 15)];
}

/** What the planner treats as busy on each day (events only; see lib/busy.ts for the full set of day rules). */
export function eventBusy(data: AppData): (date: ISODate) => Array<[number, number]> {
  const byDate = new Map<ISODate, Array<[number, number]>>();
  for (const e of allEvents(data)) {
    const list = byDate.get(e.date) ?? [];
    list.push(eventSpan(e));
    byDate.set(e.date, list);
  }
  return (date) => byDate.get(date) ?? [];
}

/** Dates (this week or any) on which an event counts as a session for an area. */
export const countedByEvent = (data: AppData, areaId: string, date: ISODate) =>
  allEvents(data).some((e) => e.date === date && e.countsFor === areaId);

const COUNTS_AS: Array<[areaId: string, pattern: RegExp]> = [["walking", /\b(walk|walking|outing|hike|stroll|trek|park)\b/i]];

/** A weekend outing counts as the walk: guess which area an event stands in for, from its title. */
export function inferCountsFor(title: string, areas: Area[]): string | undefined {
  const have = new Set(areas.filter((a) => a.target).map((a) => a.id));
  for (const [id, re] of COUNTS_AS) if (have.has(id) && re.test(title)) return id;
  return undefined;
}

/** Minutes before an event to remind you. */
export const eventLead = (data: AppData) => withDefaults(data.profile).eventLeadMin;
